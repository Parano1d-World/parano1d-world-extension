// Encrypted wallet vault: master secrets never leave this browser and are never stored in plaintext.
//
//  profile  = { format, kdf: PBKDF2-SHA256, iterations: 600000, salt }      (one device password)
//  wallet   = { id, nickname, role, keyId, addresses[], created, iv, ciphertext }   AES-256-GCM(master, AAD=format|id)
//  pinBox   = { iv, ciphertext }   AES-256-GCM({ salt, hash }) — the PIN verifier is itself encrypted, so it
//             can only be attacked after the password is known. 5 wrong PINs lock the vault.
//
// Persistence: localStorage AND IndexedDB (each repairs the other), navigator.storage.persist(), and an
// encrypted backup file the player can download. Unlocked keys live only in memory and are wiped on lock,
// on idle (15 min) and on reload.
import { deriveAddress, keyId, newMaster, hexToMaster, masterToHex } from '../engine/noid-keys.js';

export const FORMAT = 'parano1d-world/vault-v1';
export const ITERATIONS = 600_000, PIN_ITERATIONS = 210_000, MIN_PASSWORD = 12, MAX_WALLETS = 8, MAX_PIN_TRIES = 5, IDLE_MS = 15 * 60_000;
const LS_KEY = 'parano1d_world_vault_v1', IDB = 'parano1d-world-vault', te = new TextEncoder(), td = new TextDecoder();
const b64 = u => btoa(String.fromCharCode(...u)), unb64 = (s, n) => { const u = Uint8Array.from(atob(String(s)), c => c.charCodeAt(0)); if (n && u.length !== n) throw new Error('Damaged vault'); return u; };
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const hex = u => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');

let session = null; // { key: CryptoKey, masters: Map<id, Uint8Array>, pinTries, timer }
// Short unlocked session across page loads (game <-> wallet redirects): the password-derived AES key is stored
// in IndexedDB as a NON-EXTRACTABLE CryptoKey (scripts can use it, nobody can read its bytes) with a 15-minute
// idle expiry. Lock clears it. The password is never stored; the PIN is still required for every action.
let resuming = null, lastSessionWrite = 0;
const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(f => { try { f(state()); } catch {} });

// ---------- storage (localStorage + IndexedDB mirror) ----------
let mem = null; // tests / storage-less browsers
export function setStorageForTests(s) { mem = s; }
function idb(mode, fn) {
  return new Promise(resolve => {
    try { const r = indexedDB.open(IDB, 1); r.onupgradeneeded = () => r.result.createObjectStore('v'); r.onerror = () => resolve(null);
      r.onsuccess = () => { try { const tx = r.result.transaction('v', mode); const q = fn(tx.objectStore('v')); tx.oncomplete = () => resolve(q?.result ?? null); tx.onerror = () => resolve(null); } catch { resolve(null); } };
    } catch { resolve(null); }
  });
}
function readLocal() { try { return JSON.parse((mem ? mem.getItem(LS_KEY) : localStorage.getItem(LS_KEY)) || 'null'); } catch { return null; } }
async function write(v) {
  const s = JSON.stringify(v);
  try { mem ? mem.setItem(LS_KEY, s) : localStorage.setItem(LS_KEY, s); } catch {}
  if (!mem) await idb('readwrite', st => st.put(s, 'vault'));
  if (!mem) try { await navigator.storage?.persist?.(); } catch {}
}
/** Load, validating shape; repair a missing copy from the other store. */
export async function load() {
  let v = readLocal();
  if (!mem) { const raw = await idb('readonly', st => st.get('vault')); let i = null; try { i = raw ? JSON.parse(raw) : null; } catch {}
    if (!valid(v) && valid(i)) { v = i; try { localStorage.setItem(LS_KEY, raw); } catch {} }
    else if (valid(v) && !valid(i)) await idb('readwrite', st => st.put(JSON.stringify(v), 'vault'));
    else if (valid(v) && valid(i) && (i.updated || 0) > (v.updated || 0)) { v = i; try { localStorage.setItem(LS_KEY, raw); } catch {} } }
  return valid(v) ? v : null;
}
export function valid(v) {
  return Boolean(v && v.format === FORMAT && v.kdf === 'PBKDF2-SHA256' && v.iterations === ITERATIONS && typeof v.salt === 'string' && v.pinBox && Array.isArray(v.wallets) && v.wallets.length <= MAX_WALLETS
    && v.wallets.every(w => /^[a-f0-9]{16}$/.test(w.id) && typeof w.iv === 'string' && typeof w.ciphertext === 'string' && Array.isArray(w.addresses) && ['main', 'game', 'mining', 'other'].includes(w.role)));
}
export const exists = async () => Boolean(await load());
async function saveSession(key) { if (mem) return; lastSessionWrite = Date.now(); await idb('readwrite', st => st.put({ key, expires: Date.now() + IDLE_MS }, 'session')); }
async function clearSession() { if (mem) return; await idb('readwrite', st => st.delete('session')); }
function resume() { if (!resuming) resuming = doResume(); return resuming; }
async function doResume() {
  if (session || mem) return;
  const rec = await idb('readonly', st => st.get('session'));
  if (!rec || !(rec.key instanceof CryptoKey) || !(rec.expires > Date.now())) { if (rec) await clearSession(); return; }
  const v = await load(); if (!v) return;
  const masters = new Map();
  try { await open(rec.key, v.pinBox, FORMAT + '|pin'); for (const w of v.wallets) masters.set(w.id, await open(rec.key, w, FORMAT + '|' + w.id)); }
  catch { for (const m of masters.values()) m.fill(0); await clearSession(); return; }
  session = { key: rec.key, masters, pinTries: 0, timer: null }; touch(); emit();
}

// ---------- crypto ----------
async function passwordKey(password, salt) {
  const pw = te.encode(password);
  try { const m = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
  finally { pw.fill(0); }
}
async function seal(key, bytes, aad) { const iv = rnd(12); const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, bytes)); return { iv: b64(iv), ciphertext: b64(c) }; }
async function open(key, box, aad) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv, 12), additionalData: te.encode(aad) }, key, unb64(box.ciphertext))); }
async function pinHash(pin, salt) {
  const m = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PIN_ITERATIONS }, m, 256));
}
const sameBytes = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

// ---------- policy ----------
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 256) return 'Password must be at most 256 characters.';
  if (/^(.)\1+$/.test(pw) || /^(0123456789|123456789012|password|qwertyuiop)/i.test(pw)) return 'Too easy to guess. Use a passphrase of several words.';
  if (/^[0-9a-f]{64}$/i.test(pw.replace(/\s/g, ''))) return 'Never use your master key as the password.';
  return '';
}
/** PIN: 4 or 6 digits, like the iPhone app (6 recommended). `digits` pins the expected length when given. */
export function pinProblem(pin, digits = null) {
  pin = String(pin);
  if (digits && !new RegExp(`^\\d{${digits}}$`).test(pin)) return `The PIN must be exactly ${digits} digits.`;
  if (!/^(\d{4}|\d{6})$/.test(pin)) return 'The PIN must be 4 or 6 digits.';
  if (/^(\d)\1+$/.test(pin) || '01234567890123456789'.includes(pin) || '98765432109876543210'.includes(pin) || ['1212', '121212', '1122', '112233'].includes(pin)) return 'Choose a less predictable PIN: no repeated or sequential digits.';
  return '';
}
/** How many digits this device's PIN has (4 or 6). Not secret: the PIN screen shows that many dots. */
export async function pinDigits() { const v = await load(); return v && v.pinDigits === 4 ? 4 : 6; }
const nickOk = n => /^[\p{L}\p{N} ._'-]{1,40}$/u.test(String(n || '').trim());

// ---------- public API ----------
export function state() { return { unlocked: Boolean(session), pinTriesLeft: session ? MAX_PIN_TRIES - session.pinTries : null }; }
export async function wallets() { await resume(); const v = await load(); return v ? v.wallets.map(({ iv, ciphertext, ...pub }) => pub) : []; }
function touch() { if (!session) return; clearTimeout(session.timer); session.timer = setTimeout(lock, IDLE_MS); if (Date.now() - lastSessionWrite > 30_000) saveSession(session.key); }
/** Activity keeps an unlocked wallet open (idle auto-lock after 15 minutes). */
export function keepAlive() { touch(); }
// ---------- unlock method: password (default) or PIN quick unlock ----------
// With PIN chosen in Settings, locking keeps the non-extractable session key in IndexedDB for up to 12 hours,
// behind the PIN (5 tries). After 12 hours, 5 wrong PINs, clearing site data or switching back to password,
// the password is needed again. The password itself is never stored.
export const QUICK_MS = 12 * 3600_000; const METHOD_KEY = 'parano1d_world_unlock_method_v1';
const PASSKEY_KEY = 'parano1d_world_passkey_v1';
export function unlockMethod() { try { const m = mem ? mem.getItem(METHOD_KEY) : localStorage.getItem(METHOD_KEY); return m === 'pin' ? 'pin' : m === 'passkey' && passkeyId() ? 'passkey' : 'password'; } catch { return 'password'; } }
export async function setUnlockMethod(m) { const v = m === 'pin' ? 'pin' : m === 'passkey' ? 'passkey' : 'password'; if (v === 'passkey' && !passkeyId()) throw new Error('Set up a passkey first.'); try { mem ? mem.setItem(METHOD_KEY, v) : localStorage.setItem(METHOD_KEY, v); } catch {} if (v === 'password') await clearQuick(); emit(); }
// ---------- passkey quick unlock (Face ID, Touch ID, Windows Hello…) ----------
// Same model as PIN quick unlock: a locked wallet keeps its non-extractable session key in IndexedDB for up to 12 hours,
// and the passkey (with user verification) is what reopens it. Nothing about the passkey can decrypt the wallet on its own;
// after 12 hours, clearing site data or switching to password, the password is needed again.
function passkeyId() { try { return (mem ? mem.getItem(PASSKEY_KEY) : localStorage.getItem(PASSKEY_KEY)) || ''; } catch { return ''; } }
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export async function passkeySupported() { try { return Boolean(globalThis.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; } }
export const hasPasskey = () => Boolean(passkeyId());
/** Register a platform passkey for quick unlock. Needs the wallet unlocked (proves it is the owner). */
export async function registerPasskey() {
  if (!session) throw new Error('Unlock first.');
  if (!(await passkeySupported())) throw new Error('This browser or device has no built-in passkey (Face ID, Touch ID or Windows Hello).');
  const cred = await navigator.credentials.create({ publicKey: { challenge: rnd(32), rp: { name: 'Parano1d World', id: location.hostname },
    user: { id: rnd(16), name: 'Parano1d World wallet', displayName: 'Parano1d World wallet' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000, attestation: 'none' } });
  if (!cred) throw new Error('Passkey was not created.');
  try { mem ? mem.setItem(PASSKEY_KEY, b64u(cred.rawId)) : localStorage.setItem(PASSKEY_KEY, b64u(cred.rawId)); } catch {}
  await setUnlockMethod('passkey'); return true;
}
export async function removePasskey() { try { mem ? mem.removeItem(PASSKEY_KEY) : localStorage.removeItem(PASSKEY_KEY); } catch {} if (unlockMethod() === 'password') await clearQuick(); await setUnlockMethod('password'); }
/** Reopen a locked wallet with the passkey (user verification required). */
export async function unlockWithPasskey() {
  const r = await readQuick(); if (!r || unlockMethod() !== 'passkey') { await clearQuick(); throw new Error('Unlock with your password.'); }
  const a = await navigator.credentials.get({ publicKey: { challenge: rnd(32), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: unb64u(passkeyId()) }], userVerification: 'required', timeout: 60000 } });
  const flags = a ? new Uint8Array(a.response.authenticatorData)[32] : 0;
  if (!a || b64u(a.rawId) !== passkeyId() || !(flags & 0x04)) throw new Error('Passkey not verified. Use your password.');
  return openQuick(r);
}
async function openQuick(r) {
  const v = await load(); if (!v) throw new Error('No wallet on this device yet.');
  const masters = new Map();
  try { for (const w of v.wallets) masters.set(w.id, await open(r.key, w, FORMAT + '|' + w.id)); } catch { for (const m of masters.values()) m.fill(0); await clearQuick(); throw new Error('Unlock with your password.'); }
  if (session) lock({ full: true });
  session = { key: r.key, masters, pinTries: 0, timer: null }; lastSessionWrite = 0; await clearQuick(); touch(); emit(); return true;
}
async function clearQuick() { if (mem) { quickMem = null; return; } await idb('readwrite', st => st.delete('quick')); }
let quickMem = null; // tests
async function readQuick() { const r = mem ? quickMem : await idb('readonly', st => st.get('quick')); return r && r.key instanceof Object && r.expires > Date.now() && r.tries < MAX_PIN_TRIES ? r : null; }
async function writeQuick(r) { if (mem) quickMem = r; else await idb('readwrite', st => st.put(r, 'quick')); }
/** True when the wallet can be reopened with the PIN instead of the password. */
export async function hasQuickUnlock() { if (unlockMethod() === 'password') return false; const r = await readQuick(); if (!r) { await clearQuick(); return false; } return true; }
/** Reopen a PIN-locked wallet. 5 wrong PINs remove PIN unlock until the password is used. */
export async function unlockWithPin(pin) {
  const r = await readQuick(); if (!r || unlockMethod() !== 'pin') { await clearQuick(); throw new Error('Unlock with your password.'); }
  const v = await load(); if (!v) throw new Error('No wallet on this device yet.');
  const box = JSON.parse(td.decode(await open(r.key, v.pinBox, FORMAT + '|pin')));
  if (!sameBytes(await pinHash(String(pin), unb64(box.salt, 16)), unb64(box.hash, 32))) {
    const tries = (r.tries || 0) + 1, left = MAX_PIN_TRIES - tries;
    if (left <= 0) { await clearQuick(); emit(); throw new Error('Too many wrong PINs. Unlock with your password.'); }
    await writeQuick({ ...r, tries }); throw new Error(`Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before the password is needed.`);
  }
  const masters = new Map();
  try { for (const w of v.wallets) masters.set(w.id, await open(r.key, w, FORMAT + '|' + w.id)); } catch { for (const m of masters.values()) m.fill(0); await clearQuick(); throw new Error('Unlock with your password.'); }
  if (session) lock({ full: true });
  session = { key: r.key, masters, pinTries: 0, timer: null }; lastSessionWrite = 0; await clearQuick(); touch(); emit(); return true;
}
export function lock({ full = false } = {}) {
  clearSession(); if (!session) { if (full) clearQuick(); return; }
  if (!full && unlockMethod() !== 'password') writeQuick({ key: session.key, expires: Date.now() + QUICK_MS, tries: 0 }); else clearQuick();
  for (const m of session.masters.values()) m.fill(0); clearTimeout(session.timer); session = null; emit();
}

async function buildWallet(key, master, { nickname, role }) {
  const id = hex(rnd(8)), addresses = [0, 1, 2].map(i => ({ index: i, address: deriveAddress(master, i) }));
  return { id, nickname: String(nickname).trim(), role, keyId: keyId(master), addresses, created: Date.now(), ...(await seal(key, master, FORMAT + '|' + id)) };
}
/**
 * First-time setup: creates the vault with a password, a 4- or 6-digit PIN and the first wallet (new or imported).
 * Returns { wallet, masterHex } — masterHex is shown ONCE for the backup step and must not be stored by callers.
 */
export async function setup({ password, pin, nickname = 'Main wallet', role = 'main', importHex = null }) {
  if (!['main', 'game', 'mining'].includes(role)) role = 'main';
  if (await load()) throw new Error('A wallet already exists on this device. Unlock it instead.');
  const p = passwordProblem(password) || pinProblem(pin); if (p) throw new Error(p);
  if (!nickOk(nickname)) throw new Error('Wallet name: 1–40 letters, numbers, spaces, . _ \' -');
  const master = importHex ? hexToMaster(importHex) : newMaster();
  try {
    const salt = rnd(16), key = await passwordKey(password, salt), pinSalt = rnd(16);
    const pinBox = await seal(key, te.encode(JSON.stringify({ salt: b64(pinSalt), hash: b64(await pinHash(pin, pinSalt)) })), FORMAT + '|pin');
    const w = await buildWallet(key, master, { nickname, role });
    await write({ format: FORMAT, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), pinBox, pinDigits: String(pin).length, wallets: [w], updated: Date.now() });
    session = { key, masters: new Map([[w.id, master.slice()]]), pinTries: 0, timer: null }; lastSessionWrite = 0; touch(); emit();
    const { iv, ciphertext, ...pub } = w; return { wallet: pub, masterHex: masterToHex(master) };
  } finally { master.fill(0); }
}
export async function unlock(password) {
  const v = await load(); if (!v) throw new Error('No wallet on this device yet.');
  const key = await passwordKey(String(password), unb64(v.salt, 16)), masters = new Map();
  try { await open(key, v.pinBox, FORMAT + '|pin'); for (const w of v.wallets) masters.set(w.id, await open(key, w, FORMAT + '|' + w.id)); }
  catch { for (const m of masters.values()) m.fill(0); throw new Error('Incorrect password.'); }
  for (const w of v.wallets) { const m = masters.get(w.id); if (deriveAddress(m, 0) !== w.addresses[0]?.address) { lock({ full: true }); throw new Error('Vault integrity check failed. Restore from your master key.'); } }
  if (session) lock({ full: true });
  session = { key, masters, pinTries: 0, timer: null }; lastSessionWrite = 0; await clearQuick(); touch(); emit(); return true;
}
/** Every money-moving or linking action calls this. 5 wrong PINs lock the vault (password needed again). */
export async function confirmPin(pin) {
  if (!session) throw new Error('Wallet is locked.');
  const v = await load(); const box = JSON.parse(td.decode(await open(session.key, v.pinBox, FORMAT + '|pin')));
  const ok = sameBytes(await pinHash(String(pin), unb64(box.salt, 16)), unb64(box.hash, 32));
  if (ok) { session.pinTries = 0; touch(); emit(); return true; }
  session.pinTries++; const left = MAX_PIN_TRIES - session.pinTries;
  if (left <= 0) { lock({ full: true }); throw new Error('Too many wrong PINs. The wallet is locked; unlock with your password.'); }
  emit(); throw new Error(`Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before the wallet locks.`);
}
/** Change the PIN (and its length) after confirming the current one. The new PIN is checked like at setup. */
export async function changePin(currentPin, newPin) {
  if (!session) throw new Error('Unlock first.');
  const p = pinProblem(newPin); if (p) throw new Error(p);
  await confirmPin(currentPin);
  const v = await load(), pinSalt = rnd(16);
  v.pinBox = await seal(session.key, te.encode(JSON.stringify({ salt: b64(pinSalt), hash: b64(await pinHash(String(newPin), pinSalt)) })), FORMAT + '|pin');
  v.pinDigits = String(newPin).length; v.updated = Date.now(); await write(v); await clearQuick(); touch(); emit(); return true;
}
/** Add another wallet (new or imported) under the same password. Requires an unlocked vault and the PIN. */
export async function addWallet({ pin, nickname, role = 'game', importHex = null }) {
  if (!session) throw new Error('Unlock first.'); await confirmPin(pin);
  if (!nickOk(nickname)) throw new Error('Wallet name: 1–40 letters, numbers, spaces, . _ \' -');
  const v = await load(); if (v.wallets.length >= MAX_WALLETS) throw new Error(`Up to ${MAX_WALLETS} wallets.`);
  if (role === 'main' && v.wallets.some(w => w.role === 'main')) role = 'other';
  const master = importHex ? hexToMaster(importHex) : newMaster();
  try {
    const kid = keyId(master); if (v.wallets.some(w => w.keyId === kid)) throw new Error('This key is already in your wallet.');
    const w = await buildWallet(session.key, master, { nickname, role });
    v.wallets.push(w); v.updated = Date.now(); await write(v); session.masters.set(w.id, master.slice()); emit();
    const { iv, ciphertext, ...pub } = w; return { wallet: pub, masterHex: masterToHex(master) };
  } finally { master.fill(0); }
}
/** Authorize a reviewed payment or native operation with one wallet's key, in the wallet engine (WebAssembly).
 *  The PIN must have been confirmed for exactly this operation by the caller (confirmWithPin). */
export async function authorizeOperation(id, operation, expectedTxid) {
  if (!session) throw new Error('Unlock your wallet first.');
  const m = session.masters.get(id); if (!m) throw new Error('Wallet not found.');
  touch(); const { engine } = await import('../engine/engine.js');
  const r = await engine({ op: 'authorize', master_hex: Array.from(m, b => b.toString(16).padStart(2, '0')).join(''), operation, expected_txid: expectedTxid });
  if (!r.ok) throw new Error(r.error || 'Authorization failed. Nothing was sent.');
  return r;
}
/** The private-chat identity of one wallet (derived from its master inside this module; needs the wallet unlocked).
 *  Returns non-extractable keys plus the public id / box key; the master secret never leaves here. */
export async function chatIdentityOf(id) {
  if (!session) throw new Error('Unlock your wallet to use private chat.');
  const m = session.masters.get(id); if (!m) throw new Error('Wallet not found.');
  touch(); const { chatIdentity } = await import('./chat-keys.js'); return chatIdentity(m);
}
/** Show a wallet's backup key: requires the PASSWORD again (not just an unlocked session). */
export async function revealBackup(id, password) {
  const v = await load(); const w = v?.wallets.find(x => x.id === id); if (!w) throw new Error('Wallet not found.');
  const key = await passwordKey(String(password), unb64(v.salt, 16));
  let m; try { m = await open(key, w, FORMAT + '|' + w.id); } catch { throw new Error('Incorrect password.'); }
  try { return { masterHex: masterToHex(m), keyId: keyId(m) }; } finally { m.fill(0); touch(); }
}
/** Rename a wallet (the nickname is a label outside the encrypted key; no unlock needed, like the app). */
export async function renameWallet(id, nickname) {
  if (!nickOk(nickname)) throw new Error('Wallet name: 1–40 letters, numbers, spaces, . _ \' -');
  const v = await load(); const w = v?.wallets.find(x => x.id === id); if (!w) throw new Error('Wallet not found.');
  w.nickname = String(nickname).trim(); v.updated = Date.now(); await write(v); emit();
}
/** Put a wallet in a custom category ('' = its default group: Main, Gaming, Mining, Other). Label only, outside the key. */
export async function setWalletCategory(id, category) {
  const c = String(category ?? '').trim();
  if (c && !nickOk(c)) throw new Error('Category: 1–24 letters, numbers, spaces, . _ \' -');
  const v = await load(); const w = v?.wallets.find(x => x.id === id); if (!w) throw new Error('Wallet not found.');
  if (c) w.category = c; else delete w.category; v.updated = Date.now(); await write(v); emit();
}
/** Move a wallet up (-1) or down (+1) in the list. */
export async function moveWallet(id, dir) {
  const v = await load(); const i = v?.wallets.findIndex(x => x.id === id) ?? -1, j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= v.wallets.length) return; [v.wallets[i], v.wallets[j]] = [v.wallets[j], v.wallets[i]]; v.updated = Date.now(); await write(v); emit();
}
/** Remove a wallet: password + typed nickname confirmation. The vault is never left empty. */
export async function removeWallet(id, password) {
  const v = await load(); if (v.wallets.length <= 1) throw new Error('Your only wallet cannot be removed.');
  await revealBackup(id, password); v.wallets = v.wallets.filter(w => w.id !== id); v.updated = Date.now(); await write(v);
  session?.masters.get(id)?.fill(0); session?.masters.delete(id); emit();
}
/** Encrypted backup file (no plaintext keys). Restorable on any browser with the same password. */
export async function exportFile() { const v = await load(); if (!v) throw new Error('No wallet to back up.'); return JSON.stringify({ ...v, exported: new Date().toISOString(), note: 'Encrypted Parano1d World wallet backup. Needs your device password. Keep your 64-character master keys as well.' }, null, 2); }
export async function importFile(text, password) {
  let v; try { v = JSON.parse(text); delete v.exported; delete v.note; } catch { throw new Error('Not a Parano1d World backup file.'); }
  if (!valid(v)) throw new Error('Not a Parano1d World backup file.');
  if (await load()) throw new Error('A wallet already exists here. Remove browser data for this site first, or restore from master keys.');
  const key = await passwordKey(String(password), unb64(v.salt, 16));
  try { await open(key, v.pinBox, FORMAT + '|pin'); for (const w of v.wallets) (await open(key, w, FORMAT + '|' + w.id)).fill(0); } catch { throw new Error('Incorrect password for this backup.'); }
  v.updated = Date.now(); await write(v); return unlock(password);
}
/** Public addresses only (for watch-only views, game linking, receive). */
export async function addressesOf(id) { const w = (await wallets()).find(x => x.id === id); return w ? w.addresses : []; }
