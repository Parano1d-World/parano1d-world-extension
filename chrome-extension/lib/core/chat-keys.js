// Private chat keys and NaCl box for the website wallet, matching the app's courier (Vendor/paramo1d/courier):
//   HKDF-SHA256(salt "Paramo1d/Courier/1", ikm = wallet master secret)
//     "message authentication"   -> Ed25519 signing seed  (public key = contact id)
//     "direct-message encryption" -> X25519 secret         (public key = box_key)
//   Direct messages: crypto_box (X25519 + HSalsa20 + XSalsa20-Poly1305), tag || ciphertext, as SalsaBox does.
// The master secret only ever exists inside an unlocked website wallet; nothing here stores or sends it.
import { edPublicKey, edSign, x25519 } from './ed25519.js';
const te = new TextEncoder();
const PK8_ED = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const PK8_X = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
export const toHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
export const fromHex = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const jwkX = async k => b64u((await crypto.subtle.exportKey('jwk', k)).x);
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

async function hkdf(seed, info) {
  const k = await crypto.subtle.importKey('raw', seed, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('Paramo1d/Courier/1'), info: te.encode(info) }, k, 256));
}
/** The chat identity for one wallet master secret (32 bytes). Keys are non-extractable once made. */
export async function chatIdentity(master) {
  if (!(master instanceof Uint8Array) || master.length !== 32) throw new Error('Wallet secret unavailable');
  const auth = await hkdf(master, 'message authentication'), enc = await hkdf(master, 'direct-message encryption');
  try {
    const edTmp = await crypto.subtle.importKey('pkcs8', cat(PK8_ED, auth), { name: 'Ed25519' }, true, ['sign']);
    const xTmp = await crypto.subtle.importKey('pkcs8', cat(PK8_X, enc), { name: 'X25519' }, true, ['deriveBits']);
    const id = toHex(await jwkX(edTmp)), boxKey = toHex(await jwkX(xTmp));
    const sign = await crypto.subtle.importKey('pkcs8', cat(PK8_ED, auth), { name: 'Ed25519' }, false, ['sign']);
    const box = await crypto.subtle.importKey('pkcs8', cat(PK8_X, enc), { name: 'X25519' }, false, ['deriveBits']);
    auth.fill(0); enc.fill(0);
    return { id, boxKey, sign, box };
  } catch {
    // This browser's WebCrypto lacks Ed25519/X25519 (some Safari / iOS versions): same keys with the built-in JS
    // curves. The secrets stay inside this identity object in this tab only, and are wiped when the wallet locks.
    const id = toHex(await edPublicKey(auth)), boxKey = toHex(x25519(enc));
    return { id, boxKey, sign: { js: auth }, box: { js: enc } };
  }
}
export async function signBytes(identity, bytes) {
  if (identity.sign?.js) return toHex(await edSign(identity.sign.js, bytes));
  return toHex(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, identity.sign, bytes)));
}
/** Wipe a JS-fallback identity's secrets (WebCrypto keys are non-extractable and need nothing). */
export function forgetIdentity(identity) { identity?.sign?.js?.fill(0); identity?.box?.js?.fill(0); }

// ---------- Salsa20 / HSalsa20 / Poly1305 (NaCl), small and constant-time enough for message sizes here ----------
const SIGMA = te.encode('expand 32-byte k');
const u32 = (b, i) => (b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24) >>> 0;
const R = (x, n) => (x << n | x >>> (32 - n)) >>> 0;
function core(key, n16, hsalsa) {
  const x = new Uint32Array(16);
  x[0] = u32(SIGMA, 0); x[5] = u32(SIGMA, 4); x[10] = u32(SIGMA, 8); x[15] = u32(SIGMA, 12);
  for (let i = 0; i < 4; i++) { x[1 + i] = u32(key, 4 * i); x[11 + i] = u32(key, 16 + 4 * i); x[6 + i] = u32(n16, 4 * i); }
  const j = x.slice();
  for (let r = 0; r < 20; r += 2) {
    x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
    x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
    x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
    x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
    x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
    x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
    x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
    x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
  }
  const out = new Uint8Array(hsalsa ? 32 : 64), put = (o, v) => { out[o] = v; out[o + 1] = v >>> 8; out[o + 2] = v >>> 16; out[o + 3] = v >>> 24; };
  if (hsalsa) [0, 5, 10, 15, 6, 7, 8, 9].forEach((k, i) => put(4 * i, x[k]));
  else for (let i = 0; i < 16; i++) put(4 * i, (x[i] + j[i]) >>> 0);
  return out;
}
export const hsalsa20 = (key, n16) => core(key, n16, true);
function xsalsaStream(key, nonce24, len) {
  const sub = hsalsa20(key, nonce24.subarray(0, 16)), out = new Uint8Array(len), n = new Uint8Array(16);
  n.set(nonce24.subarray(16, 24));
  for (let pos = 0, ctr = 0; pos < len; pos += 64, ctr++) {
    let c = ctr; for (let i = 8; i < 16; i++) { n[i] = c & 255; c = Math.floor(c / 256); }
    out.set(core(sub, n, false).subarray(0, Math.min(64, len - pos)), pos);
  }
  sub.fill(0); return out;
}
function poly1305(key, msg) {
  const r = BigInt('0x' + toHex(key.slice(0, 16).reverse())) & 0x0ffffffc0ffffffc0ffffffc0fffffffn, s = BigInt('0x' + toHex(key.slice(16, 32).reverse()));
  const p = (1n << 130n) - 5n; let h = 0n;
  for (let i = 0; i < msg.length; i += 16) { const blk = msg.slice(i, i + 16); const n = BigInt('0x' + toHex(cat(blk, [1]).reverse())); h = (h + n) * r % p; }
  h = (h + s) & ((1n << 128n) - 1n);
  const out = new Uint8Array(16); for (let i = 0; i < 16; i++) { out[i] = Number(h & 255n); h >>= 8n; } return out;
}
const eq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

async function boxKeyFor(identity, theirBoxHex) {
  let shared;
  if (identity.box?.js) shared = x25519(identity.box.js, fromHex(theirBoxHex));
  else { const pub = await crypto.subtle.importKey('raw', fromHex(theirBoxHex), { name: 'X25519' }, false, []); shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: pub }, identity.box, 256)); }
  if (shared.every(b => b === 0)) throw new Error('Invalid contact key');
  const k = hsalsa20(shared, new Uint8Array(16)); shared.fill(0); return k;
}
/** crypto_box seal: returns tag || ciphertext (SalsaBox / NaCl crypto_box_easy layout). */
export async function boxSeal(identity, theirBoxHex, nonce24, plain) {
  const k = await boxKeyFor(identity, theirBoxHex), ks = xsalsaStream(k, nonce24, plain.length + 32); k.fill(0);
  const c = new Uint8Array(plain.length); for (let i = 0; i < plain.length; i++) c[i] = plain[i] ^ ks[32 + i];
  return cat(poly1305(ks.subarray(0, 32), c), c);
}
export async function boxOpen(identity, theirBoxHex, nonce24, sealed) {
  if (sealed.length < 16) throw new Error('Message authentication failed');
  const k = await boxKeyFor(identity, theirBoxHex), tag = sealed.subarray(0, 16), c = sealed.subarray(16), ks = xsalsaStream(k, nonce24, c.length + 32); k.fill(0);
  if (!eq(poly1305(ks.subarray(0, 32), c), tag)) throw new Error('Message authentication failed');
  const m = new Uint8Array(c.length); for (let i = 0; i < c.length; i++) m[i] = c[i] ^ ks[32 + i]; return m;
}
