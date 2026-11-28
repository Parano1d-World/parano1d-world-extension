// Parano1d World extension: a full wallet in Chrome's side panel (default), popup-sized or expanded tab (?view=full).
// Wallets are created or restored here and encrypted on this device with the same vault as the website
// (lib/core/vault.js, kept identical by a test). Website wallets can also be linked as public addresses.
// Balances, tokens, markets and the chain come from the Parano1d World node; the NOID price from its feed.
// Builds all DOM with createElement/textContent — no HTML strings from data.
import { shortAddr, formatMicro } from './common.js';
import { SITE, SITE_TRADES } from './config.js';
import * as V from './lib/core/vault.js';
import { keyGrid, keyDisplay, pinEntry, pinChooser } from './lib/core/secret-entry.js';
import { configurePrice, watchPrice, lastPrice, sourceLine } from './lib/core/price.js';

const full = new URLSearchParams(location.search).get('view') === 'full', panel = new URLSearchParams(location.search).get('view') === 'panel';
document.body.classList.toggle('full', full); document.body.classList.toggle('panel', panel);
const $ = id => document.getElementById(id);
const h = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n[k] = v; else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat(9)) if (c !== null && c !== undefined && c !== false) n.append(c); return n; };
const ROLE = { main: 'Main', game: 'Game wallet', other: 'Wallet' };
let st = { site: null, accounts: [], active: null }, vaultWallets = [], view = 'wallet', tab = 'tokens', sendState = null;
const base = () => st.site || SITE;
const api = async path => { const r = await fetch(base() + path, { credentials: 'omit', cache: 'no-store', headers: { accept: 'application/json' } }); const j = await r.json().catch(() => null); if (!r.ok || !j?.ok) throw new Error(String(j?.error || `HTTP ${r.status}`).slice(0, 140)); return j; };
const open = url => chrome.tabs.create({ url });
const MICRO = 1_000_000n;

$('expand').onclick = () => open(chrome.runtime.getURL('popup.html?view=full'));
if (full) $('expand').hidden = true;

// ---- Appearance: System / Dark / Light / Cyber / Parano1d World (same choices as the website) ----
const mq = window.matchMedia('(prefers-color-scheme: light)');
const choice = () => { try { return localStorage.getItem('p1w-theme') || 'system'; } catch { return 'system'; } };
const paranoidOn = () => { try { return localStorage.getItem('p1w-paranoid') === 'on'; } catch { return false; } };
function applyTheme(c = choice()) {
  const r = document.documentElement, mode = (c === 'cyber' || c === 'world') ? c : (c === 'dark' || (c === 'system' && !mq.matches)) ? 'dark' : 'light';
  r.dataset.theme = mode; r.dataset.themeChoice = c; if (mode === 'cyber' || mode === 'world') r.dataset.mono = ''; else delete r.dataset.mono; if (paranoidOn()) r.dataset.paranoid = 'on'; else delete r.dataset.paranoid;
  document.querySelectorAll('[data-theme-choice]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themeChoice === c)));
  document.querySelectorAll('#paranoid,#set-paranoid').forEach(b => b.setAttribute('aria-checked', String(paranoidOn())));
}
async function adoptSiteAppearance() {
  const { appearance, appearanceSeen } = await chrome.storage.local.get(['appearance', 'appearanceSeen']);
  if (!appearance || appearanceSeen === JSON.stringify(appearance)) return;
  try { localStorage.setItem('p1w-theme', appearance.theme); localStorage.setItem('p1w-paranoid', appearance.paranoid ? 'on' : 'off'); } catch {}
  await chrome.storage.local.set({ appearanceSeen: JSON.stringify(appearance) }); applyTheme();
}
mq.addEventListener?.('change', () => applyTheme());
const menu = $('theme-menu');
const setTheme = c => { try { localStorage.setItem('p1w-theme', c); } catch {} applyTheme(); };
const toggleParanoid = () => { try { localStorage.setItem('p1w-paranoid', paranoidOn() ? 'off' : 'on'); } catch {} applyTheme(); };
$('theme').onclick = () => { menu.hidden = !menu.hidden; $('theme').setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('[aria-checked=true]')?.focus(); };
$('paranoid').onclick = toggleParanoid;
menu.querySelectorAll('[data-theme-choice]').forEach(b => b.onclick = () => { setTheme(b.dataset.themeChoice); menu.hidden = true; $('theme').setAttribute('aria-expanded', 'false'); $('theme').focus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!menu.hidden) { menu.hidden = true; $('theme').setAttribute('aria-expanded', 'false'); $('theme').focus(); } else closeSheet(); } });
applyTheme();

// ---- Live NOID price (our node's feed first; backup never in Paranoid mode; saved ≤30 min; else hidden) ----
configurePrice({ base: SITE, isParanoid: paranoidOn });
watchPrice(p => {
  const chip = $('pchip'); if (!chip) return;
  chip.dataset.state = !p ? 'none' : p.via;
  $('pchip-val').textContent = p ? '$' + Number(p.usd).toFixed(Number(p.usd) < 1 ? 4 : 2) : '—';
  chip.title = p ? `${sourceLine(p)} · updated ${new Date(p.updated).toLocaleTimeString()}` : 'Price unavailable: no fresh source';
  chip.setAttribute('aria-label', p ? `NOID price $${p.usd}, ${sourceLine(p)}` : 'NOID price unavailable');
  document.querySelectorAll('[data-usd-micro]').forEach(n => { n.textContent = usdText(n.dataset.usdMicro); });
  if (view === 'markets') renderSoon();
});
$('pchip').onclick = () => go('markets');
const usdText = micro => { const p = lastPrice(); if (!p || micro == null || !/^\d+$/.test(String(micro))) return p ? '—' : 'USD hidden · no fresh price'; const v = Number(BigInt(micro)) / 1e6 * Number(p.usd); return '≈ ' + v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: v < 1 ? 4 : 2 }); };

// ---- small helpers ----
const hue = hex => (parseInt(String(hex).replace(/[^0-9a-f]/gi, '').slice(0, 6) || '0', 16) % 360);
const paint = (el, id, sat = 62) => { const h1 = hue(id), h2 = (h1 + 48) % 360; el.style.background = `linear-gradient(135deg,hsl(${h1} ${sat}% 38%),hsl(${h2} ${sat}% 24%))`; return el; };
const highlight = addr => h('div', { class: 'addr' }, h('b', {}, addr.slice(0, 7)), h('span', {}, addr.slice(7, -5)), h('b', {}, addr.slice(-5)));
const svgPath = d => { const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); for (const x of [].concat(d)) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', x); s.append(p); } return s; };
const ICONS = { send: 'M12 19V6M6 12l6-6 6 6', receive: 'M12 5v13M6 12l6 6 6-6', swap: ['M7 7h11l-3-3', 'M17 17H6l3 3'], tokens: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', nfts: ['M4 5h16v14H4z', 'M4 15l4-4 4 4 3-3 5 5'], activity: ['M12 7v5l3 2', 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z'],
  wallet: ['M4 7h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4z', 'M4 7l12-3v3', 'M16 13h.01'], markets: ['M4 19V9', 'M10 19V5', 'M16 19v-7', 'M22 19H2'], explorer: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M8 12h8'], settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.1 1.2L10 21h4l.5-2.6a7 7 0 0 0 2.1-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z'], lock: ['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3'], back: 'M15 6l-6 6 6 6' };
const num = v => Number(v).toLocaleString(undefined, { maximumSignificantDigits: 6 });
const pct = v => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`);
const copyExpiring = async text => { await navigator.clipboard.writeText(text); setTimeout(() => { if (document.hasFocus()) navigator.clipboard.writeText('').catch(() => {}); }, 120000); };
const spark = (vals, cls = '') => { const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 80 26'); s.setAttribute('class', 'spark ' + cls); s.setAttribute('aria-hidden', 'true');
  const v = (vals || []).filter(Number.isFinite); if (v.length < 2) return s; const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  const p = document.createElementNS(ns, 'polyline'); p.setAttribute('points', v.map((x, i) => `${(i / (v.length - 1) * 80).toFixed(1)},${(24 - (x - lo) / r * 22).toFixed(1)}`).join(' ')); s.append(p); return s; };
const ago = s => { s = Math.max(0, Math.round(s)); return s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
let soon = 0; const renderSoon = () => { clearTimeout(soon); soon = setTimeout(render, 60); };

function qrSvg(text) {
  const q = new window.LocalQRCode(0, window.LocalQRErrorLevel.M); q.addData(text); q.make();
  const n = q.getModuleCount(), ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n + 8} ${n + 8}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code of the address');
  const bg = document.createElementNS(ns, 'rect'); bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#fff'); svg.append(bg);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) { const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', x + 4); r.setAttribute('y', y + 4); r.setAttribute('width', 1); r.setAttribute('height', 1); r.setAttribute('fill', '#03100a'); svg.append(r); }
  return svg;
}

// ---- accounts: wallets in this extension's vault + wallets linked from the website (public addresses) ----
function accounts() {
  const out = vaultWallets.map(w => ({ address: w.addresses[0].address, nickname: w.nickname, role: w.role, keyId: w.keyId, source: 'vault', id: w.id }));
  for (const a of st.accounts || []) if (!out.some(x => x.address === a.address)) out.push({ ...a, source: 'linked' });
  return out;
}
async function load() {
  st = { site: null, accounts: [], active: null, ...(await chrome.storage.local.get(['site', 'accounts', 'active'])) };
  try { vaultWallets = await V.wallets(); } catch { vaultWallets = []; }
  await adoptSiteAppearance(); render();
}

// ---- sheets (modal dialogs) ----
let lastFocus = null;
function sheet(title, ...body) {
  closeSheet(); lastFocus = document.activeElement;
  const s = h('div', { class: 'sheet-wrap', id: 'sheet', onclick: e => { if (e.target.id === 'sheet') closeSheet(); } },
    h('section', { class: 'sheet card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
      h('div', { class: 'sheet-head' }, h('h2', { id: 'sheet-title' }, title), h('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onclick: closeSheet }, '✕')), ...body));
  document.body.append(s); s.querySelector('input,textarea,button.primary')?.focus(); return s;
}
function closeSheet() { const s = $('sheet'); if (s) { s.remove(); lastFocus?.focus?.(); } }
const field = (id, label, props = {}) => h('div', { class: 'field' }, h('label', { for: id }, label), props.rows ? h('textarea', { id, autocomplete: 'off', spellcheck: 'false', ...props }) : h('input', { id, autocomplete: 'off', spellcheck: 'false', ...props }));
const errBox = () => h('p', { class: 'err', id: 'sheet-err', role: 'alert' });
const busy = async (btn, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = 'Working…'; try { await fn(); } catch (e) { $('sheet-err') && ($('sheet-err').textContent = e.message); } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = t; } } };

/** First open, Import: the key on its own screen ("Restore your wallet."), then "Protect this device." (iOS §2–§3). */
function importKeyFlow() {
  let grid = null; const keyId = h('p', { class: 'help', 'aria-live': 'polite' });
  const go_ = h('button', { class: 'primary pill', type: 'submit', disabled: true }, 'Restore wallet');
  grid = keyGrid({ firstId: 'w-key', onChange: async (v, full) => { go_.disabled = !full; keyId.textContent = full ? 'Key ID ' + (await import('./lib/engine/noid-keys.js')).keyId(Uint8Array.from(v.match(/../g), x => parseInt(x, 16))) + ' · check it matches your backup' : ''; } });
  sheet('Restore your wallet.', h('p', { class: 'muted' }, 'Restore the 64-character hexadecimal master key exported by the official Parano1d wallet.'),
    h('form', { novalidate: true, onsubmit: e => { e.preventDefault(); const v = grid.value(); if (v.length !== 64) { $('sheet-err').textContent = `The master key has 64 characters; ${v.length} entered. Fill all 16 groups.`; return; }
      const nick = $('w-nick').value.trim(); grid.clear(); createFlow(false, { importHex: v, nickname: nick }); } },
      h('div', { class: 'field keypanel' }, h('label', { for: 'w-key' }, 'Parano1d master key'), h('p', { class: 'help' }, '16 groups of 4 hex characters. Paste the full 64-character key into the first box to fill all groups.'), grid.root, keyId),
      field('w-nick', 'Wallet name (optional)', { maxlength: 40, placeholder: 'Personal' }),
      h('p', { class: 'help' }, 'Compare the restored address with your desktop wallet before receiving or sending funds. Your key stays on this device.'),
      errBox(), h('div', { class: 'stack' }, go_, h('button', { class: 'link', type: 'button', onclick: closeSheet }, 'Cancel and return to wallet choices'), h('button', { class: 'link', type: 'button', onclick: fileFlow }, 'Have a backup file instead?'))));
}
function createFlow(restore = false, pre = null) {
  const has = vaultWallets.length > 0;
  if (restore && !has) return importKeyFlow();
  let digits = 6, grid = null, pin1 = null, pin2 = null;
  const go_ = h('button', { class: 'primary', type: 'submit' }, pre ? 'Finish and open wallet' : restore ? 'Restore wallet' : 'Create wallet');
  const keyId = h('p', { class: 'help', 'aria-live': 'polite' });
  if (restore) grid = keyGrid({ firstId: 'w-key', onChange: async (v, full) => { keyId.textContent = full ? 'Key ID ' + (await import('./lib/engine/noid-keys.js')).keyId(Uint8Array.from(v.match(/../g), x => parseInt(x, 16))) + ' · check it matches your backup' : ''; } });
  const pwHint = h('p', { class: 'help', id: 'w-pw-hint' }, 'Must be at least 12 characters.');
  const form = h('form', { novalidate: true, onsubmit: e => { e.preventDefault(); busy(go_, async () => {
      const nickname = pre?.nickname || $('w-nick')?.value.trim() || (has ? 'Wallet' : 'Main wallet'), pin = $('w-pin').value, importHex = restore ? grid.value() : pre?.importHex || null;
      if (restore && importHex.length !== 64) throw new Error(`The master key has 64 characters; ${importHex.length} entered. Fill all 16 groups.`);
      if (has) {
        if (!V.state().unlocked) await V.unlock($('w-pw').value);
        const r = await V.addWallet({ pin, nickname, role: has ? 'other' : 'main', importHex });
        grid?.clear(); pin1.clear();
        await load(); await chrome.storage.local.set({ active: r.wallet.addresses[0].address });
        restore || pre ? closeSheet() : showBackup(r.masterHex, r.wallet.nickname, r.wallet.keyId);
      } else {
        const pp = V.passwordProblem($('w-pw').value); if (pp) throw new Error(pp);
        if ($('w-pw').value !== $('w-pw2').value) throw new Error('The two passwords do not match.');
        const pinP = V.pinProblem(pin, digits); if (pinP) throw new Error(pinP);
        if (pin !== $('w-pin2').value) throw new Error('The two PINs do not match. Enter the same PIN again.');
        const r = await V.setup({ password: $('w-pw').value, pin, nickname, importHex });
        grid?.clear(); $('w-pw').value = $('w-pw2').value = ''; pin1.clear(); pin2.clear();
        await load(); await chrome.storage.local.set({ active: r.wallet.addresses[0].address });
        restore || pre ? closeSheet() : showBackup(r.masterHex, r.wallet.nickname, r.wallet.keyId);
      }
    }); } },
    restore ? h('p', { class: 'muted' }, 'Restore the 64-character hexadecimal master key exported by the official Parano1d wallet.') : null,
    restore ? h('div', { class: 'field keypanel' }, h('label', { for: 'w-key' }, 'Parano1d master key'), h('p', { class: 'help' }, '16 groups of 4 hex characters. Paste the full 64-character key into the first box to fill all groups.'), grid.root, keyId) : null,
    restore ? h('p', { class: 'help' }, 'Compare the restored address with your desktop wallet before receiving or sending funds. Your key stays on this device.') : null,
    pre ? null : field('w-nick', 'Wallet name', { maxlength: 40, value: has ? '' : 'Main wallet' }),
    field('w-pw', has ? 'Device password' : 'Password (at least 12 characters)', { type: 'password', autocomplete: has ? 'current-password' : 'new-password' }),
    has ? null : pwHint,
    has ? null : field('w-pw2', 'Enter the same password again', { type: 'password', autocomplete: 'new-password' }),
    has ? null : h('p', { class: 'help' }, 'Wallet PIN: you enter it to approve every payment and new wallet. It is separate from your password and never leaves this device.'),
    h('div', { class: 'field', id: 'w-pinwrap' }),
    errBox(), h('div', { class: 'row' }, go_), restore && !has ? h('button', { class: 'link', type: 'button', onclick: fileFlow }, 'Have a backup file instead?') : null);
  sheet(pre ? 'Protect this device.' : restore ? 'Restore your wallet.' : (has ? 'Add a wallet' : 'Create your wallet'),
    h('p', { class: 'muted' }, pre ? 'Your key is encrypted on this device with a password. You\'ll use your wallet PIN to approve payments.' : 'Your wallet is encrypted on this device with your password. Every payment and backup needs your PIN. Nothing is sent to Parano1d World.'), form);
  const wrap = $('w-pinwrap');
  (async () => {
    if (has) { pin1 = pinEntry({ id: 'w-pin', digits: await V.pinDigits(), label: 'Wallet PIN' }); wrap.append(h('label', { for: 'w-pin' }, 'Enter your wallet PIN'), pin1.root); return; }
    pin1 = pinEntry({ id: 'w-pin', digits: 6, label: 'New PIN' }); pin2 = pinEntry({ id: 'w-pin2', digits: 6, label: 'Same PIN again' });
    const c = pinChooser(n => { digits = n; pin1.setDigits(n); pin2.setDigits(n); });
    wrap.append(c.root, h('label', { for: 'w-pin' }, 'Create your PIN'), pin1.root, h('label', { for: 'w-pin2' }, 'Enter the same PIN again'), pin2.root);
    $('w-pw').oninput = () => { const n = $('w-pw').value.length; pwHint.textContent = n >= 12 ? '✓ Long enough.' : `Must be at least 12 characters (${n} of 12).`; };
  })();
}
/** Back up like the iPhone app: 16 numbered groups to write down, then enter all 16 again to verify. */
function showBackup(hex, name, keyIdText = '') {
  let k = hex; const finish = () => { k = ''; closeSheet(); };
  const writeDown = () => {
    const ok = h('input', { type: 'checkbox', id: 'bk-ok' }), next = h('button', { class: 'primary', disabled: true }, 'Next · verify backup');
    const box = h('div', { id: 'bk-key' }, keyDisplay(k));
    const hide = h('button', { class: 'ghost', type: 'button', onclick: () => { box.replaceChildren(); hide.disabled = true; } }, 'Hide key now');
    ok.onchange = () => { next.disabled = !ok.checked; }; next.onclick = verify;
    sheet('Back up ' + name, h('p', { class: 'warn' }, 'Write all 16 groups down, in order, on paper. Anyone with this key controls the wallet. It works in every official Parano1d wallet.'),
      box, keyIdText ? h('p', { class: 'help' }, 'Key ID ' + keyIdText + ' · check it matches when you restore.') : null,
      h('label', { class: 'check' }, ok, ' I wrote down all 16 groups in order'), h('div', { class: 'row' }, hide, next));
  };
  const verify = () => {
    const done = h('button', { class: 'primary', disabled: true, onclick: () => { g.clear(); finish(); } }, 'Verify backup'), msg = h('p', { class: 'err', role: 'alert' });
    const g = keyGrid({ firstId: 'bk-verify', label: 'Your written master key', onChange: (v, full) => { done.disabled = !(full && v === k); msg.textContent = full && v !== k ? 'This does not match. Check each group against your paper; tap Edit to fix a group.' : ''; } });
    sheet('Verify your backup', h('p', { class: 'muted' }, 'Enter all 16 groups from your written copy.'), g.root, msg,
      h('div', { class: 'row' }, h('button', { class: 'ghost', type: 'button', onclick: () => { g.clear(); writeDown(); } }, 'Review my master key'), done));
  };
  writeDown();
}
function viewBackup(hex, name, keyIdText = '') {
  const box = h('div', { id: 'bk-key' }, keyDisplay(hex)); let left = 180;
  const t = h('p', { class: 'help' }, 'Hides in 180 s.');
  const timer = setInterval(() => { left--; if (!t.isConnected || left <= 0) { clearInterval(timer); closeSheet(); return; } t.textContent = `Hides in ${left} s.`; }, 1000);
  sheet('Master key · ' + name, h('p', { class: 'muted' }, '16 groups of 4 characters, in order. Make sure nobody can see your screen.'), box,
    keyIdText ? h('p', { class: 'help' }, 'Key ID ' + keyIdText) : null, t, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { clearInterval(timer); closeSheet(); } }, 'Hide key now')));
}
function fileFlow() {
  const file = h('input', { type: 'file', id: 'w-file', accept: 'application/json,.json' }), go_ = h('button', { class: 'primary', type: 'submit' }, 'Restore');
  sheet('Restore backup file', h('form', { novalidate: true, onsubmit: e => { e.preventDefault(); busy(go_, async () => {
    const f = file.files[0]; if (!f || f.size > 200000) throw new Error('Choose your Parano1d World backup file.');
    await V.importFile(await f.text(), $('w-pw').value); $('w-pw').value = ''; await load(); closeSheet(); }); } },
    h('div', { class: 'field' }, h('label', { for: 'w-file' }, 'Backup file (from the website or this extension)'), file), field('w-pw', 'Device password the backup was made with', { type: 'password' }), errBox(), h('div', { class: 'row' }, go_)));
}
function passwordSheet(title, label, run) {
  const go_ = h('button', { class: 'primary', type: 'submit' }, label);
  sheet(title, h('form', { novalidate: true, onsubmit: e => { e.preventDefault(); busy(go_, async () => { const pw = $('w-pw').value; $('w-pw').value = ''; await run(pw); }); } },
    field('w-pw', 'Device password', { type: 'password', autocomplete: 'current-password' }), errBox(), h('div', { class: 'row' }, go_)));
}

function unlockSheet() {
  const go_ = h('button', { class: 'primary', type: 'submit' }, 'Unlock');
  let mode = 'password';
  const pinF = h('div', { class: 'field' }, h('label', { for: 'w-upin' }, 'Wallet PIN')), pwF = field('w-pw', 'Device password', { type: 'password', autocomplete: 'current-password' });
  const swap = h('button', { class: 'link', type: 'button', onclick: () => setMode('password') }, 'Use password instead');
  const setMode = m => { mode = m; pinF.hidden = swap.hidden = m !== 'pin'; pwF.hidden = m === 'pin'; ($(m === 'pin' ? 'w-upin' : 'w-pw'))?.focus(); };
  sheet('Unlock wallet', h('form', { novalidate: true, onsubmit: e => { e.preventDefault(); busy(go_, async () => {
    const f = $(mode === 'pin' ? 'w-upin' : 'w-pw'), v = f.value; f.value = '';
    try { mode === 'pin' ? await V.unlockWithPin(v) : await V.unlock(v); } catch (x) { if (mode === 'pin' && !(await V.hasQuickUnlock())) setMode('password'); throw x; }
    closeSheet(); render(); }); } }, pinF, swap, pwF, errBox(), h('div', { class: 'row' }, go_)));
  V.pinDigits().then(n => { const p = pinEntry({ id: 'w-upin', digits: n, label: 'Wallet PIN' }); pinF.append(p.root); });
  setMode('password'); V.hasQuickUnlock().then(q => q && setMode('pin'));
}

// ---- onboarding ----
function onboarding() {
  // The iPhone app's welcome, sized for the side panel.
  return h('section', { class: 'card onboard welcome' }, h('img', { class: 'wlogo', src: 'icons/world-logo.png', alt: 'Parano1d World', width: 140, height: 140 }),
    h('h2', { class: 'whead' }, 'Your world.', h('br'), 'Your wallet.'),
    h('p', { class: 'muted' }, 'Create your Parano1d wallet or bring back an existing one. Your master key stays on this device.'),
    h('div', { class: 'stack' }, h('button', { class: 'primary pill', id: 'create', onclick: () => createFlow(false) }, 'Create a new wallet'),
      h('button', { class: 'ghost pill', id: 'restore', onclick: () => createFlow(true) }, 'Import an existing wallet'),
      h('button', { class: 'link', id: 'link', onclick: () => open(base() + '/#ExtensionLink') }, 'Link your website wallet (watch only)')),
    h('p', { class: 'foot' }, 'Never share your master key. We cannot restore it for you.'));
}

// ---- wallet view ----
function accountList(list, active) {
  return h('section', { class: 'card acct-card' }, h('div', { class: 'label' }, 'Wallets'), h('div', { class: 'accts' }, list.map(a =>
    h('button', { class: 'acct' + (a.address === active.address ? ' on' : ''), 'aria-pressed': String(a.address === active.address), onclick: async () => { await chrome.storage.local.set({ active: a.address }); load(); } },
      paint(h('span', { class: 'dot', 'aria-hidden': 'true' }, a.nickname ? a.nickname.slice(0, 1).toUpperCase() : svgPath(ICONS.wallet)), a.address.slice(2)), // no name: a wallet icon, never "?"
      h('span', { class: 'who' }, h('b', {}, a.nickname), h('span', { class: 'mono' }, shortAddr(a.address))),
      h('span', { class: 'badge ' + a.role }, a.source === 'linked' ? (a.watchOnly ? 'Watch-only' : 'Linked') : ROLE[a.role])))));
}
const ACTIONS = [['send', 'Send'], ['receive', 'Receive'], ['swap', 'Markets'], ['nfts', 'NFTs'], ['activity', 'Activity']];
function hero(a) {
  const bal = h('div', { class: 'bal', id: 'bal' }, '…'), usd = h('div', { class: 'usd', id: 'usd' }, ' '), prov = h('div', { class: 'prov', id: 'prov' }, ' ');
  const actions = h('div', { class: 'actions', role: 'tablist', 'aria-label': 'Wallet actions' }, ACTIONS.map(([k, l]) => h('button', { class: 'act' + (tab === k ? ' on' : ''), role: 'tab', 'aria-selected': String(tab === k), id: 'tab-' + k, type: 'button',
    onclick: () => { if (k === 'swap') { go('markets'); return; } tab = tab === k ? 'tokens' : k; sendState = null; render(); } }, h('span', { class: 'ic' }, svgPath(ICONS[k])), h('span', {}, l))));
  const top = h('div', { class: 'hero-top' }, h('div', {}, h('div', { class: 'label' }, a.nickname + (a.source === 'linked' ? ' · linked' : '')), a.keyId ? h('div', { class: 'keyid' }, 'Key ID ', h('b', { class: 'mono' }, a.keyId)) : null),
    h('button', { class: 'chipbtn mono', type: 'button', title: 'Copy address', onclick: async e => { try { await copyExpiring(a.address); e.currentTarget.textContent = 'Copied'; } catch {} } }, shortAddr(a.address)));
  api('/api/explorer/address?id=' + a.address).then(r => {
    bal.replaceChildren(r.balanceMicro === null ? '—' : formatMicro(r.balanceMicro) + ' ', r.balanceMicro === null ? '' : h('small', {}, h('img', { class: 'noid-ico', src: 'icons/noid-coin-128.png', alt: '', width: '16', height: '16' }), 'NOID'));
    usd.dataset.usdMicro = r.balanceMicro ?? ''; usd.textContent = r.balanceMicro === null ? ' ' : usdText(r.balanceMicro);
    const ok = r.balanceProvenance === 'node-verified'; prov.className = 'prov' + (ok ? '' : ' unk');
    prov.replaceChildren(h('i'), ok ? 'Verified by the Parano1d World node' : r.balanceProvenance === 'public-endpoint' ? 'From a public node endpoint (your node is offline)' : 'Source unknown');
    if (tab === 'send' && sendState) sendState.balanceMicro = r.balanceMicro;
    a._history = r.history || []; if (tab === 'activity') fillActivity(a, $('tabbody'));
    window.__balance = r.balanceMicro;
  }).catch(e => { bal.textContent = '—'; prov.className = 'prov unk'; prov.replaceChildren(h('i'), 'Balance unavailable: ' + e.message); });
  return h('section', { class: 'card hero' }, top, bal, usd, prov, actions);
}
// Assets and NFTs like the iPhone app: NOID, Tokens (count, collapsible), NFT collections with FLOOR (exact), each
// collection's NFTs in a grid, artwork and official names (hash-checked by the site). The last inventory is kept in
// extension storage and shown at once (labelled "Last saved inventory") while a refresh runs.
let artOn = true; chrome.storage.local.get('artwork').then(r => { artOn = r.artwork !== 'off'; }); // unset = on
const setArt = async on => { artOn = on; await chrome.storage.local.set({ artwork: on ? 'on' : 'off' }); };
const metaCache = new Map();
// At most 6 artwork lookups at a time (one per distinct hash, cached for the session).
let metaActive = 0; const metaQueue = [];
const metaSlot = () => new Promise(res => { if (metaActive < 6) { metaActive++; res(); } else metaQueue.push(res); });
const metaDone = () => { const n = metaQueue.shift(); if (n) n(); else metaActive--; };
const meta = hash => { if (!/^[a-f0-9]{64}$/.test(hash || '')) return Promise.resolve(null); if (!metaCache.has(hash)) metaCache.set(hash, metaSlot().then(() => api('/api/nft/meta?h=' + hash)).catch(() => null).finally(metaDone)); return metaCache.get(hash); };
const exact = m => (m == null || !/^\d{1,30}$/.test(String(m)) ? null : formatMicro(String(m)));
function artBox(hash, label, cls = 'art') {
  const box = paint(h('div', { class: cls, 'aria-hidden': 'true' }, label), hash || label, 62);
  if (artOn) meta(hash).then(m => { if (!m?.image?.hash) return; const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', src: `${base()}/api/nft/image?h=${m.image.hash}&w=${m.image.width}&ht=${m.image.height}&b=${m.image.bytes}` }); img.onerror = () => img.remove(); box.replaceChildren(img); });
  return box;
}
function nameEl(tag, hash, fallback) { const e = h(tag, {}, fallback); meta(hash).then(m => { if (m?.name) e.textContent = m.name; }); return e; }
const openNft = x => open(`${base()}/#NFTs/${x.collectionId}/${x.serial}`);
async function tokensTab(a, body, only) {
  artOn = (await chrome.storage.local.get('artwork')).artwork !== 'off';
  const key = 'holdings:' + a.address, saved = (await chrome.storage.local.get(key))[key];
  const draw = (r, savedAt) => {
    if (tab !== (only === 'nfts' ? 'nfts' : 'tokens')) return;
    body.replaceChildren();
    const toks = r.assets.filter(t => t.type === 'token'), nfts = r.assets.filter(t => t.type === 'nft' && t.collectionId);
    body.append(h('p', { class: 'foot inv' }, savedAt ? `Last saved inventory · block ${r.height ?? '—'} · ${new Date(savedAt).toLocaleString()}` : `Verified inventory · block ${r.height ?? '—'}`));
    if (only !== 'nfts') {
      body.append(h('div', { class: 'sect' }, 'Tokens ', h('span', { class: 'cnt' }, String(toks.length))));
      if (!toks.length) body.append(h('p', { class: 'empty' }, 'No native tokens at this address.'));
      for (const t of toks) body.append(h('button', { class: 'tok', type: 'button', onclick: () => open(`${base()}/#Explorer/token/${t.assetId}`) },
        artBox(t.metadataHash, t.assetId.slice(0, 2).toUpperCase(), 'av'),
        h('div', { class: 'mid' }, nameEl('b', t.metadataHash, 'Token ' + t.assetId.slice(0, 8) + '…'), h('span', {}, t.priceNoid == null ? 'Native token · no pool price' : `${num(t.priceNoid)} NOID each`)),
        h('div', { class: 'right' }, h('b', {}, formatMicro(t.units)), h('span', {}, t.valueNoid == null ? '—' : `≈ ${num(t.valueNoid)} NOID`))));
    }
    if (only !== 'tokens') {
      const groups = new Map(); for (const x of nfts) { if (!groups.has(x.collectionId)) groups.set(x.collectionId, []); groups.get(x.collectionId).push(x); }
      body.append(h('div', { class: 'sect' }, 'NFT collections ', h('span', { class: 'cnt' }, String(groups.size))));
      if (!groups.size) body.append(h('p', { class: 'empty' }, 'No NFTs at this address.'));
      for (const [id, items] of groups) {
        items.sort((p, q) => Number(p.serial) - Number(q.serial));
        const fl = exact(items[0].floorMicro), grid = h('div', { class: 'nfts' }, items.map(x => h('button', { type: 'button', class: 'nft' + (x.reserved ? ' locked' : ''), onclick: () => openNft(x), 'aria-label': `NFT #${x.serial}${x.reserved ? ', locked: pending transfer' : ''}` },
          artBox(x.metadataHash, '#' + x.serial), h('div', { class: 'meta' }, h('b', {}, 'NFT #' + x.serial), x.reserved ? h('small', { class: 'lockt' }, '🔒 Pending transfer') : null))));
        const head = h('button', { type: 'button', class: 'coll', 'aria-expanded': 'true', onclick: () => { grid.hidden = !grid.hidden; head.setAttribute('aria-expanded', String(!grid.hidden)); chev.textContent = grid.hidden ? '▸' : '▾'; } },
          artBox(items[0].metadataHash, '✦', 'av'), h('div', { class: 'mid' }, nameEl('b', items[0].collectionMetadataHash || items[0].metadataHash, 'Collection ' + id.slice(0, 8) + '…'), h('span', {}, `${items.length} NFT${items.length === 1 ? '' : 's'}`)),
          h('div', { class: 'right floor' }, h('small', {}, 'FLOOR'), h('b', {}, fl ? fl + ' NOID' : '—')), h('span', { class: 'chev', 'aria-hidden': 'true' }));
        const chev = head.lastChild; chev.textContent = '▾';
        body.append(head, grid);
      }
      const listed = (r.listed || []).filter(x => x && x.collectionId && /^\d{1,30}$/.test(String(x.askMicro ?? ''))).sort((p, q) => { try { const d = BigInt(p.serial) - BigInt(q.serial); return d < 0n ? -1 : d > 0n ? 1 : 0; } catch { return 0; } }); // below your wallet's NFTs, by number
      if (listed.length) {
        body.append(h('div', { class: 'sect' }, 'For sale ', h('span', { class: 'cnt' }, String(listed.length))));
        for (const x of listed) body.append(h('button', { type: 'button', class: 'coll', onclick: () => openNft(x) }, artBox(x.metadataHash, '#' + x.serial, 'av'),
          h('div', { class: 'mid' }, h('b', {}, 'NFT #' + x.serial), nameEl('span', x.collectionMetadataHash || x.metadataHash, 'Collection ' + x.collectionId.slice(0, 8) + '…')),
          h('div', { class: 'right floor' }, h('small', {}, 'LISTED AT'), h('b', {}, formatMicro(String(x.askMicro)) + ' NOID'))));
      }
      if (groups.size) body.append(h('button', { class: 'link', type: 'button', onclick: () => open(`${base()}/#NFTs`) }, 'Open the full NFT gallery ↗'));
    }
    if (r.unreadable) body.append(h('p', { class: 'warn' }, `${r.unreadable} record${r.unreadable === 1 ? '' : 's'} couldn't be verified and ${r.unreadable === 1 ? 'is' : 'are'} not shown.`));
  };
  if (saved?.r?.assets) draw(saved.r, saved.at); else body.append(h('div', { class: 'skel' }), h('div', { class: 'skel' }));
  api('/api/explorer/holdings?id=' + a.address).then(async r => {
    if (!Array.isArray(r.assets)) throw new Error('not available from the node right now');
    await chrome.storage.local.set({ [key]: { r, at: Date.now() } }); draw(r, null);
  }).catch(e => { if (saved?.r?.assets) body.prepend(h('p', { class: 'warn' }, 'Refresh failed: ' + e.message + '. Showing the last saved inventory.')); else body.replaceChildren(h('p', { class: 'empty' }, 'Tokens and NFTs unavailable: ' + e.message)); });
}
let histFor = null, histShown = 5;
function fillActivity(a, body) {
  if (!body || tab !== 'activity') return; body.replaceChildren();
  const rows = a._history; if (!rows) { body.append(h('div', { class: 'skel' }), h('div', { class: 'skel' })); return; }
  if (!rows.length) { body.append(h('p', { class: 'empty' }, 'No activity at this address yet.')); return; }
  // The 5 most recent, then "Show more · N older" adds 20. Back to 5 when the account changes.
  if (histFor !== a.address) { histFor = a.address; histShown = 5; }
  const shownRows = rows.slice(0, histShown), older = rows.length - shownRows.length;
  for (const r of shownRows) {
    const net = BigInt(r.receivedMicro || 0) - BigInt(r.spentMicro || 0), inn = net >= 0n;
    body.append(h('button', { class: 'txrow', type: 'button', onclick: () => open(`${base()}/#Explorer/tx/${r.txid}`) },
      h('span', { class: 'txic ' + (inn ? 'in' : 'out'), 'aria-hidden': 'true' }, svgPath(inn ? ICONS.receive : ICONS.send)),
      h('div', { class: 'mid' }, h('b', {}, r.coinbase ? 'Mining reward' : inn ? 'Received' : 'Sent'), h('span', { class: 'mono' }, `Block #${Number(r.height).toLocaleString()} · ${r.confirmations >= 18 ? 'final' : (r.confirmations ?? 0) + '/18'}`)),
      h('div', { class: 'right' }, h('b', { class: inn ? 'pos' : 'neg' }, (inn ? '+' : '−') + formatMicro((inn ? net : -net).toString()) + ' NOID'), h('span', {}, r.txid.slice(0, 8) + '…'))));
  }  if (older > 0) body.append(h('button', { class: 'more', type: 'button', id: 'tx-more', onclick: () => { histShown += 20; fillActivity(a, body); } }, `Show more · ${older.toLocaleString()} older`));
}
function receiveTab(a, body) {
  const status = h('p', { class: 'muted', role: 'status' }, 'Share this address to receive NOID, tokens or NFTs.');
  const copy = h('button', { class: 'primary', onclick: async () => { try { await copyExpiring(a.address); status.textContent = 'Copied. It clears from the clipboard in 2 minutes.'; } catch { status.textContent = 'Copy blocked. Select the address instead.'; } } }, 'Copy address');
  body.append(h('div', { class: 'qrbox' }, h('div', { class: 'qr', id: 'qr' }, qrSvg(a.address)), highlight(a.address), status), h('div', { class: 'row' }, copy));
}
function sendTab(a, body) {
  if (sendState?.review) return sendReview(a, body);
  const to = h('input', { id: 'to', placeholder: 'o1…', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'send-err', value: sendState?.to || '' });
  const amt = h('input', { id: 'amount', placeholder: '0.00', inputmode: 'decimal', autocomplete: 'off', value: sendState?.amount || '' });
  const usd = h('span', { class: 'help', id: 'amt-usd' }, ' ');
  amt.oninput = () => { const m = amt.value.trim(); usd.textContent = /^\d{1,14}(\.\d{1,6})?$/.test(m) ? usdText((BigInt(m.split('.')[0]) * MICRO + BigInt((m.split('.')[1] || '').padEnd(6, '0'))).toString()) : ' '; };
  const max = h('button', { class: 'mini', type: 'button', onclick: () => { const b = window.__balance; if (!/^\d+$/.test(String(b ?? ''))) return; const v = BigInt(b) - 1000n; if (v <= 0n) return; amt.value = formatMicro(v.toString()).replace(/,/g, ''); amt.oninput(); } }, 'Max');
  const err = h('p', { class: 'err', id: 'send-err', role: 'alert' });
  body.append(h('p', { class: 'muted' }, a.source === 'vault' ? 'Check the address and amount. You review everything before your PIN.' : 'You check the address and amount, then confirm with your PIN in your Parano1d World wallet. The extension never holds keys for linked wallets.'),
    h('div', { class: 'field' }, h('label', { for: 'to' }, 'Recipient address'), to), h('div', { class: 'field' }, h('label', { for: 'amount' }, 'Amount · NOID'), h('div', { class: 'amt' }, amt, max), usd), err,
    h('div', { class: 'row' }, h('button', { class: 'primary', id: 'send', onclick: () => {
      const t = to.value.trim().toLowerCase(), m = amt.value.trim();
      if (/^[0-9a-f]{64}$/i.test(t.replace(/\s/g, '')) || t.split(/\s+/).length >= 12) { to.value = ''; err.textContent = 'That looks like a secret key. It was cleared. Never paste secrets.'; return; }
      if (!/^o1[a-z0-9]{20,140}$/.test(t)) { err.textContent = 'Enter a valid o1… address.'; return; }
      if (!/^\d{1,14}(\.\d{1,6})?$/.test(m) || /^0+(\.0+)?$/.test(m)) { err.textContent = 'Enter an amount with up to 6 decimals.'; return; }
      if (t === a.address) { err.textContent = 'That is this wallet\'s own address.'; return; }
      if (a.source !== 'vault') { open(`${base()}/#Send?to=${encodeURIComponent(t)}&amount=${encodeURIComponent(m)}`); return; }
      sendState = { to: t, amount: m, review: true }; render();
    } }, a.source === 'vault' ? 'Review payment' : 'Review in wallet')));
}
// iOS-style recipient checks: lookalike of a known address (blocked until the last 5 are retyped), a first payment
// to an address not in this extension, and a payment over a quarter of the balance.
function knownAddrs() { const out = new Set(); vaultWallets.forEach(w => (w.addresses || []).forEach(x => out.add(x.address))); accounts().forEach(x => out.add(x.address)); return [...out]; }
function lookalikeOf(to) { return knownAddrs().find(k => k !== to && k.length === to.length && k.slice(0, 7) === to.slice(0, 7) && k.slice(-5) === to.slice(-5)) || null; }
function safetyNotes(a, to, micro) {
  const out = [], look = lookalikeOf(to), bal = /^\d+$/.test(String(window.__balance ?? '')) ? BigInt(window.__balance) : null;
  if (look) {
    const inp = h('input', { id: 'la-type', maxlength: '5', autocomplete: 'off', placeholder: 'last 5', 'aria-label': 'Retype the last 5 characters of the new address' });
    out.push(h('div', { class: 'warn', role: 'alert', id: 'la-warn' }, h('b', {}, 'This address starts and ends like one you already know.'), h('p', {}, 'Known: ' + look.slice(0, 10) + '…' + look.slice(-8)), h('p', {}, 'New: ' + to.slice(0, 10) + '…' + to.slice(-8)), h('p', {}, 'Scammers send dust from lookalike addresses. To continue anyway, retype the last 5 characters of the new address.'), inp));
    setTimeout(() => { const b = document.getElementById('send-site'); if (!b) return; b.disabled = true; inp.oninput = () => { b.disabled = inp.value.trim().toLowerCase() !== to.slice(-5); }; }, 0);
  } else if (!knownAddrs().includes(to)) out.push(h('div', { class: 'warn', role: 'note' }, h('b', {}, 'First payment to this address from here.'), ' Check every character with the person you are paying.'));
  if (bal === null || bal <= 0n) out.push(h('div', { class: 'warn', role: 'note' }, h('b', {}, 'Balance not checked: '), 'this wallet\'s balance couldn\'t be read, so the payment size can\'t be compared with it. Check the amount carefully.'));
  else if (BigInt(micro) * 4n > bal) out.push(h('div', { class: 'warn', role: 'note' }, h('b', {}, 'Large payment: '), `about ${Number(BigInt(micro) * 100n / bal)}% of this wallet's balance.`));
  return out;
}
function sendReview(a, body) {
  const { to, amount } = sendState, micro = (BigInt(amount.split('.')[0]) * MICRO + BigInt((amount.split('.')[1] || '').padEnd(6, '0'))).toString(), fee = '1000', total = (BigInt(micro) + 1000n).toString();
  const line = (k, v, extra) => h('div', { class: 'kv' }, h('span', {}, k), h('b', { class: extra || '' }, v));
  body.append(h('div', { class: 'review' }, h('div', { class: 'label' }, 'Review payment'),
    line('From', a.nickname + ' · ' + shortAddr(a.address)), h('div', { class: 'kv col' }, h('span', {}, 'To'), highlight(to)),
    line('Amount', formatMicro(micro) + ' NOID'), h('div', { class: 'kv' }, h('span', {}, ''), h('span', { class: 'help', 'data-usd-micro': micro }, usdText(micro))),
    line('Network fee', formatMicro(fee) + ' NOID (fee floor)'), line('Total', formatMicro(total) + ' NOID', 'big')),
    ...safetyNotes(a, to, micro),
    h('div', { class: 'gate', role: 'note' }, h('b', {}, 'Sign in your website wallet.'), ' It opens with this payment filled in: our node prepares it, you check the exact fee and approve with your PIN, and it is signed in your browser and sent.'),
    h('div', { class: 'row' }, h('button', { class: 'primary', id: 'send-site', onclick: () => open(`${base()}/#Send?to=${encodeURIComponent(to)}&amount=${encodeURIComponent(amount)}`) }, 'Sign & send in website wallet')),
    h('button', { class: 'linkbtn', onclick: () => { sendState = { to, amount }; render(); } }, '← Edit'));
}
function walletView() {
  const list = accounts();
  if (!list.length) return [onboarding()];
  const a = list.find(x => x.address === st.active) || list[0];
  const body = h('div', { id: 'tabbody', role: 'tabpanel', 'aria-labelledby': 'tab-' + tab });
  if (tab === 'tokens') tokensTab(a, body); else if (tab === 'nfts') tokensTab(a, body, 'nfts'); else if (tab === 'receive') receiveTab(a, body); else if (tab === 'send') sendTab(a, body); else if (tab === 'activity') { a._history = null; body.append(h('div', { class: 'skel' })); setTimeout(() => fillActivity(a, body), 0); }
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' }, [['tokens', 'Assets'], ['nfts', 'NFTs'], ['activity', 'Activity']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(tab === k), onclick: () => { tab = k; render(); } }, l)));
  const out = [hero(a), h('section', { class: 'card list' }, ['tokens', 'nfts', 'activity'].includes(tab) ? seg : h('div', { class: 'label' }, tab === 'send' ? 'Send NOID' : 'Receive'), body)];
  const actions = h('section', { class: 'row tools' },
    h('button', { class: 'ghost', onclick: () => open(base() + '/#Wallet') }, 'Open website wallet'),
    st.site ? h('button', { class: 'ghost', id: 'relink', onclick: () => open(st.site + '/#ExtensionLink') }, 'Relink') : null,
    st.site ? h('button', { class: 'ghost', id: 'unlink', onclick: async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(['site', 'accounts', 'active', 'linkedAt', 'appearance', 'appearanceSeen', ...Object.keys(all).filter(k => k.startsWith('holdings:'))]); load(); } }, 'Unlink') : null);
  if (full) return [h('div', { class: 'side' }, accountList(list, a), actions), h('div', { class: 'main' }, ...out)];
  return [list.length > 1 ? accountList(list, a) : null, ...out, actions];
}

// ---- markets view: NOID price (our node's feed) + native token markets from the node ----
function marketsView() {
  const p = lastPrice();
  const noid = h('section', { class: 'card noid' }, h('div', { class: 'hero-top' }, h('div', { class: 'label' }, 'NOID · US dollar'), h('span', { class: 'src ' + (p ? p.via : 'none') }, h('i'), p ? sourceLine(p) : 'No fresh price')),
    h('div', { class: 'bal' }, p ? '$' + Number(p.usd).toFixed(Number(p.usd) < 1 ? 6 : 4) : '—'),
    p ? h('div', { class: 'venues' },
      h('div', { class: 'kv' }, h('span', {}, '24h change'), h('b', { class: Number.isFinite(p.change24h) ? (p.change24h > 0 ? 'up' : p.change24h < 0 ? 'down' : '') : '' }, Number.isFinite(p.change24h) ? (p.change24h > 0 ? '+' : '') + p.change24h.toFixed(2) + '%' : '—')),
      h('div', { class: 'kv' }, h('span', {}, '24h volume'), h('b', {}, Number.isFinite(p.volume24h) ? '$' + Math.round(p.volume24h).toLocaleString('en-US') : '—'))) : null,
    h('p', { class: 'foot' }, p ? `Updated ${new Date(p.updated).toLocaleTimeString()}. Refreshed every minute; hidden if no source is fresher than 30 minutes.` : 'No source answered with a price from the last 30 minutes, so no price is shown.'));
  const list = h('div', { class: 'mlist' }, h('div', { class: 'skel' }), h('div', { class: 'skel' }), h('div', { class: 'skel' }));
  api('/api/explorer/markets?limit=40&sort=liquidity').then(r => {
    list.replaceChildren(); const usd = lastPrice() ? Number(lastPrice().usd) : null;
    if (!r.markets?.length) { list.append(h('p', { class: 'empty' }, 'No native markets yet.')); return; }
    for (const m of r.markets) { const up = (m.change24h ?? 0) >= 0;
      list.append(h('div', { class: 'mrow' }, paint(h('span', { class: 'av', 'aria-hidden': 'true' }, (m.label || m.assetId).slice(0, 2).toUpperCase()), m.assetId),
        h('button', { class: 'mid', type: 'button', onclick: () => open(`${base()}/#Explorer/token/${m.assetId}`) }, h('b', {}, m.label || m.assetId.slice(0, 8) + '…'), h('span', { class: 'stage' }, m.stage === 'pool' ? 'Pool' : 'Launch curve')),
        spark(m.spark, up ? 'up' : 'down'),
        h('div', { class: 'right' }, h('b', { class: 'mono' }, m.price == null ? '—' : num(m.price) + ' NOID'), h('span', { class: up ? 'pos' : 'neg' }, pct(m.change24h) + (usd && m.price != null ? ` · $${(m.price * usd).toPrecision(3)}` : '')))
        )); }
    list.append(h('p', { class: 'foot' }, 'Prices from the Parano1d network, each record checked against its on-chain root. Market data is information only, not advice. Parano1d World doesn\'t operate an exchange.'));
  }).catch(e => list.replaceChildren(h('p', { class: 'empty' }, 'Markets unavailable: ' + e.message)));
  return [noid, h('section', { class: 'card list' }, h('div', { class: 'label' }, 'Native tokens'), list)];
}

// ---- explorer view: live chain from our node ----
function explorerView() {
  const q = h('input', { id: 'xq', placeholder: 'Block · tx ID · o1… address', autocomplete: 'off', spellcheck: 'false' }), err = h('p', { class: 'err', role: 'alert' });
  const search = h('form', { class: 'xsearch', novalidate: true, onsubmit: e => { e.preventDefault(); const v = q.value.trim().toLowerCase();
    const path = /^\d{1,12}$/.test(v) ? 'block/' + v : /^o1[a-z0-9]{20,140}$/.test(v) ? 'address/' + v : /^[0-9a-f]{64}$/.test(v) ? 'search/' + v : null;
    if (!path) { err.textContent = 'Enter a block height, a 64-character ID or an o1… address.'; return; } open(`${base()}/#Explorer/${path}`); } }, q, h('button', { class: 'primary', type: 'submit' }, 'Search'));
  const stats = h('div', { class: 'stats' }, h('div', { class: 'skel' })), blocks = h('div', { class: 'blist' }, h('div', { class: 'skel' }), h('div', { class: 'skel' }));
  const stat = (k, v, s) => h('div', { class: 'stat' }, h('span', {}, k), h('b', {}, v), s ? h('small', {}, s) : null);
  api('/api/explorer/status').then(s => { stats.replaceChildren(stat('Height', s.chain ? Number(s.chain.height).toLocaleString() : '—', s.node?.synced ? 'Synced' : 'Syncing'), stat('Peers', s.peers ?? '—'), stat('Mempool', s.mempool ? `${s.mempool.size} tx` : '—', s.mempool ? `floor ${formatMicro(String(s.mempool.feeFloorMicro ?? ''))} NOID` : null), stat('Node', s.nodeOnline ? 'Online' : 'Offline', 'Parano1d World')); })
    .catch(e => stats.replaceChildren(h('p', { class: 'empty' }, 'Node unavailable: ' + e.message)));
  api('/api/explorer/blocks?limit=8').then(r => { blocks.replaceChildren(...r.blocks.map(b => h('button', { class: 'brow', type: 'button', onclick: () => open(`${base()}/#Explorer/block/${b.height}`) },
    h('b', { class: 'mono' }, '#' + Number(b.height).toLocaleString()), h('span', {}, `${b.txCount ?? '—'} tx`), h('span', { class: 'muted' }, b.timestamp ? ago(Date.now() / 1000 - b.timestamp) : ''), h('span', { class: 'fin ' + (b.finality || '') }, b.finality === 'final' ? 'Final' : 'Confirming')))); })
    .catch(e => blocks.replaceChildren(h('p', { class: 'empty' }, 'Blocks unavailable: ' + e.message)));
  // Verify receipt: checked by our node (block, confirmations, final at 18). Never called "verified on this device".
  const rq = h('input', { id: 'rq', placeholder: '64-character transaction ID', autocomplete: 'off', spellcheck: 'false' }), rout = h('div', { 'aria-live': 'polite' });
  const rform = h('form', { class: 'xsearch', novalidate: true, onsubmit: async e => { e.preventDefault(); const v = (rq.value.trim().toLowerCase().match(/[0-9a-f]{64}/) || [])[0];
    if (!v) { rout.replaceChildren(h('p', { class: 'err' }, 'Enter the 64-character transaction ID.')); return; }
    rout.replaceChildren(h('p', { class: 'muted' }, 'Checking with our node…'));
    try { const r = await api('/api/explorer/tx?id=' + v); const t = r.tx, c = t?.confirmations;
      const st = r.pending ? ['In the mempool · not confirmed', ''] : !t ? ['Not found by our node', 'This does not mean it failed.'] : c >= 18 ? ['✓ Final', `Block ${Number(t.height).toLocaleString()} · ${c} confirmations`] : ['Included · awaiting finality', `Block ${Number(t.height).toLocaleString()} · ${c ?? '—'} confirmations`];
      rout.replaceChildren(h('p', {}, h('b', {}, st[0])), st[1] ? h('p', { class: 'muted' }, st[1]) : null, h('p', { class: 'foot' }, 'Checked by the Parano1d World node, not on this device.'), h('button', { class: 'link', type: 'button', onclick: () => open(`${base()}/#Receipts/${v}`) }, 'Open in Receipts ↗'));
    } catch (x) { rout.replaceChildren(h('p', { class: 'err' }, /not found/i.test(x.message) ? 'Not found by our node. This does not mean it failed.' : 'Could not check right now: ' + x.message)); } } }, rq, h('button', { class: 'primary', type: 'submit' }, 'Check'));
  return [h('section', { class: 'card' }, h('div', { class: 'label' }, 'NOID Explorer · our node'), search, err, stats), h('section', { class: 'card' }, h('div', { class: 'label' }, 'Verify receipt'), rform, rout), h('section', { class: 'card list' }, h('div', { class: 'label' }, 'Latest blocks'), blocks),
    h('div', { class: 'row tools' }, h('button', { class: 'ghost', onclick: () => open(base() + '/#Explorer') }, 'Open full explorer'))];
}

// ---- settings: home with the Parano1d switch on top, the wallet card and category rows;
// each category opens its own page with a header card, section titles and an icon on every row. ----
let setPage = null;
const SI = { // outline icons (24-unit grid, paths only)
  wallet: ICONS.wallet, nfts: ICONS.nfts, network: ['M12 3.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM5.5 15.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM18.5 15.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z', 'M10.9 7.4 6.6 15.6M13.1 7.4l4.3 8.2M7.7 17.5h8.6'],
  palette: ['M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.8-1 1.4-2l-.5-1.1c-.5-1.1.3-2.4 1.5-2.4H17a3.5 3.5 0 0 0 3.5-3.5c0-4.4-3.8-8-8.5-8z', 'M8 11h.01M11.5 7.8h.01M15.5 9h.01'],
  info: ['M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z', 'M12 11v5.5', 'M12 7.8h.01'], shield: 'M12 3 5 6v5.5c0 4.6 3 8.3 7 9.5 4-1.2 7-4.9 7-9.5V6z',
  paranoid: ['M12 3 5 6v5.5c0 4.6 3 8.3 7 9.5 4-1.2 7-4.9 7-9.5V6z', 'M12 8.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z', 'M12 13.2v3'],
  lock: ['M5 10.5h14v10H5z', 'M8 10.5V7.5a4 4 0 0 1 8 0v3', 'M12 14.5v2.5'], key: ['M8 11.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z', 'm10.8 12.2 8.2-8.2', 'm16 7 2.5 2.5', 'm14 9 2 2'],
  download: ['M12 4v11', 'm7.5 10.5 4.5 4.5 4.5-4.5', 'M5 19.5h14'], plus: ['M12 5v14', 'M5 12h14'], file: ['M6 3.5h8.5L18.5 7.5v13H6z', 'M14.5 3.5v4h4'],
  trash: ['M4.5 7h15', 'M9.5 7V4.5h5V7', 'M6.5 7l1 13h9l1-13'], link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2'],
  globe: ['M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z', 'M3.5 12h17', 'M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5z'],
  mail: ['M3.5 5.5h17v13h-17z', 'm4 7 8 6 8-6'], monitor: ['M3.5 4.5h17V16h-17z', 'M8.5 20h7M12 16v4'], moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  sun: ['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4'],
  grid: 'M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z',
  game: ['M8 7.5h8a5 5 0 0 1 0 10H8a5 5 0 0 1 0-10z', 'M8 10.5v4M6 12.5h4', 'M15.5 11.5h.01M17.5 13.5h.01'],
};
const sIc = (k, cls = '') => h('span', { class: 'st-ic' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, svgPath(SI[k]));
const sSec = (title, ...rows) => [h('div', { class: 'st-sec' }, title), h('section', { class: 'card st-list' }, ...rows.filter(Boolean))];
const sRow = (k, title, desc, control, { danger = false, id } = {}) => h('div', { class: 'st-row' + (danger ? ' st-danger' : ''), id }, sIc(k), h('span', { class: 'st-txt' }, h('b', {}, title), desc ? h('small', {}, desc) : null), control || null);
const sLink = (k, title, desc, onclick) => h('button', { type: 'button', class: 'st-row st-link', onclick }, sIc(k), h('span', { class: 'st-txt' }, h('b', {}, title), desc ? h('small', {}, desc) : null), h('span', { class: 'st-chev', 'aria-hidden': 'true' }, '›'));
const sSwitch = (id, k, title, desc, on, onclick) => h('div', { class: 'st-row' }, sIc(k), h('span', { class: 'st-txt' }, h('b', { id: id + '-l' }, title), h('small', {}, desc)), h('button', { type: 'button', class: 'st-switch', id, role: 'switch', 'aria-checked': String(on), 'aria-labelledby': id + '-l', onclick }, h('span', {})));
const sHead = (k, title, line) => [h('button', { type: 'button', class: 'st-back', onclick: () => { setPage = null; render(); } }, '‹ Settings'), h('header', { class: 'st-head' }, sIc(k, 'st-head-ic'), h('div', {}, h('h2', {}, title), h('p', {}, line)))];
/** Until an avatar is chosen, a wallet icon in a soft accent circle, never "?". */
const walletAvatar = (cls = '') => h('span', { class: 'st-avatar' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, svgPath(ICONS.wallet));
const PAGES = {
  wallet: ['wallet', 'Wallet', 'Keep your wallet locked, backed up and organized.', 'Lock, backup and your accounts'],
  nfts: ['nfts', 'NFTs', 'Every picture is checked against the blockchain.', 'Show or hide NFT pictures'],
  sites: ['globe', 'Connected sites', 'Sites you let see your public addresses.', 'Who can see your addresses'],
  network: ['network', 'Network', 'How this extension connects and checks the blockchain.', 'Your website wallet and our node'],
  appearance: ['palette', 'Appearance', 'Tap a look to see it right away.', 'Pick a look'],
  about: ['info', 'About', 'Version, privacy and help.', 'Version, privacy and help'],
};
const LOOKS = [['system', 'System', 'monitor', "Follows your computer's light or dark setting"], ['dark', 'Dark', 'moon', 'Always dark'], ['light', 'Light', 'sun', 'Always light'], ['cyber', 'Cyber', 'grid', 'Pixel headings and outlined panels'], ['world', 'Parano1d World', 'game', 'Lime on black, like the game']];
const paraDesc = on => on ? 'On: uses only our node, never backup sites' : 'Most private setting. Turns the app orange.';
function settingsView() {
  const unlocked = V.state().unlocked, page = PAGES[setPage] ? setPage : null;
  if (!page) {
    const w = vaultWallets[0], watch = !w && accounts()[0];
    return [
      h('section', { class: 'card st-list' }, sSwitch('set-paranoid', 'paranoid', 'Parano1d mode', paraDesc(paranoidOn()), paranoidOn(), () => { toggleParanoid(); render(); })),
      h('section', { class: 'card st-wallet' }, walletAvatar(), h('span', { class: 'st-txt' }, h('b', {}, w ? w.nickname : watch ? watch.nickname || 'Watched address' : 'No wallet yet'), h('small', { class: 'mono' }, w ? w.addresses[0].address.slice(0, 8) + '…' + w.addresses[0].address.slice(-6) : watch ? watch.address.slice(0, 8) + '…' + watch.address.slice(-6) : 'Create or restore one under Wallet')),
        w || watch ? h('span', { class: 'st-wstatus', 'data-state': w ? (unlocked ? 'on' : 'off') : 'watch' }, w ? (unlocked ? 'Unlocked on this device' : 'Locked') : 'Watch-only') : null),
      ...sSec('Settings', ...Object.entries(PAGES).map(([k, [ic, t, , d]]) => sLink(ic, t, d, () => { setPage = k; render(); $('app').scrollTop = 0; }))),
      ...sSec('Help and legal', sLink('mail', 'Contact support', 'support@koajent.com · never send your master key, password or PIN', () => open('mailto:support@koajent.com')), sLink('shield', 'Privacy policy', 'What the extension stores and sends', () => open(base() + '/privacy'))),
      h('p', { class: 'foot center' }, 'Parano1d World extension v' + chrome.runtime.getManifest().version)];
  }
  const [ic, title, line] = PAGES[page], head = sHead(ic, title, line);
  if (page === 'appearance') return [...head, ...sSec('Look', ...LOOKS.map(([k, l, i, d]) => h('button', { type: 'button', class: 'st-row st-look', role: 'radio', 'aria-checked': String(choice() === k), 'data-theme-choice': k,
    onclick: () => { setTheme(k); document.querySelectorAll('.st-look').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themeChoice === k))); } }, sIc(i), h('span', { class: 'st-txt' }, h('b', {}, l), h('small', {}, d)), h('span', { class: 'st-check', 'aria-hidden': 'true' }, '✓'))))];
  if (page === 'nfts') return [...head, ...sSec('Pictures', sSwitch('set-artwork', 'nfts', 'Show NFT and token artwork', 'Each image is checked against its on-chain metadata hash. On by default; turn it off here.', artOn, async () => { await setArt(!artOn); render(); }))];
  if (page === 'sites') return [...head, connectedSites()];
  if (page === 'network') return [...head, ...sSec('Privacy', sRow('paranoid', 'Parano1d mode', 'Switch it at the top of Settings. On: only our node is used, no backup sites for prices or lookups.')),
    ...sSec('Website wallet', sRow('link', st.site ? 'Linked to ' + new URL(st.site).host : 'Not linked', st.site ? `${st.accounts.length} public address${st.accounts.length === 1 ? '' : 'es'}. Linking sends this extension public addresses only.` : 'Linking sends this extension public addresses only.',
      h('button', { class: 'mini', onclick: () => open(base() + '/#ExtensionLink') }, st.site ? 'Relink' : 'Link')))];
  if (page === 'about') return [...head, ...sSec('This build', sRow('info', 'Version', 'v' + chrome.runtime.getManifest().version + ' · data from the Parano1d World node')),
    ...sSec('Help', sLink('mail', 'Contact support', 'Never send your master key, password or PIN, including to support.', () => open('mailto:support@koajent.com')), sLink('shield', 'Privacy policy', 'What the extension stores and sends', () => open(base() + '/privacy')))];
  // wallet
  const wl = vaultWallets.map(w => sRow('key', w.nickname, 'Key ID ' + w.keyId, h('span', { class: 'st-ctl' },
    h('button', { class: 'mini', onclick: () => passwordSheet('View backup key', 'Show master key', async pw => { const r = await V.revealBackup(w.id, pw); viewBackup(r.masterHex ?? r, w.nickname, r.keyId); }) }, 'Backup key'),
    h('button', { class: 'mini danger', onclick: () => passwordSheet('Remove ' + w.nickname, 'Remove from this device', async pw => { await V.removeWallet(w.id, pw); await load(); closeSheet(); }) }, 'Remove'))));
  return [...head,
    ...sSec('Wallets on this device · ' + (vaultWallets.length ? (unlocked ? 'unlocked' : 'locked') : 'none'), ...(vaultWallets.length ? wl : [sRow('wallet', 'No wallet yet', 'No wallet is stored in this extension.')])),
    ...sSec('Add or restore', sLink('plus', vaultWallets.length ? 'Add a new wallet' : 'Create wallet', 'A new wallet with its own master key', () => createFlow(false)), sLink('key', 'Restore from master key', 'Type a master key you wrote down', () => createFlow(true)), sLink('file', 'Restore backup file', 'An encrypted backup from this extension or the website', fileFlow),
      vaultWallets.length ? sLink('download', 'Download encrypted backup', 'Opens only with your password', async () => { const blob = new Blob([await V.exportFile()], { type: 'application/json' }); const u = URL.createObjectURL(blob); const l = h('a', { href: u, download: `parano1d-world-extension-backup-${new Date().toISOString().slice(0, 10)}.json` }); document.body.append(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }) : null),
    ...sSec('Unlock', sRow('lock', 'Unlock with', 'With PIN, a locked wallet reopens with your PIN for up to 12 hours; after that, or 5 wrong PINs, the password is needed.', h('div', { class: 'seg st-seg', role: 'radiogroup', 'aria-label': 'Unlock with' }, [['password', 'Password'], ['pin', 'PIN']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(V.unlockMethod() === k), onclick: async () => { await V.setUnlockMethod(k); render(); } }, l)))),
      unlocked ? sLink('lock', 'Lock now', 'Keys are wiped from memory', () => { V.lock(); render(); }) : vaultWallets.length ? sLink('lock', 'Unlock', 'Open your wallet with your password or PIN', unlockSheet) : null),
    h('p', { class: 'help' }, 'Encrypted with your device password (PBKDF2-SHA256, 600,000 rounds, AES-256-GCM). Keys are wiped from memory on lock, after 15 minutes idle and when the panel closes.')];
}

/** Pick which wallet a connected site sees: names + first 6 / last 4, one tap, the site is notified. */
function changeSiteWallet(origin, s, row) {
  const opts = [...vaultWallets.map(w => ({ address: w.addresses[0].address, nickname: w.nickname })), ...accounts().filter(a => !vaultWallets.some(w => w.addresses[0].address === a.address))];
  const pick = h('div', { class: 'conn-pick' }, ...opts.map(a => h('button', { type: 'button', class: 'mini' + (s.accounts.includes(a.address) ? ' on' : ''), onclick: async () => {
    await chrome.runtime.sendMessage({ type: 'p1w-set-site-accounts', origin, accounts: [a.address] }); render(); } }, a.nickname + ' ' + a.address.slice(0, 6) + '…' + a.address.slice(-4))));
  row.after(pick);
}
function connectedSites() {
  const box = h('section', { class: 'card st-list', id: 'sites' }, h('div', { class: 'label' }, 'Connected sites'), h('p', { class: 'muted' }, 'Loading…'));
  chrome.storage.local.get(['sites', 'siteSigning']).then(({ sites = {}, siteSigning = {} }) => {
    const list = Object.entries(sites); box.replaceChildren(h('div', { class: 'label' }, 'Connected sites'));
    if (!list.length) { box.append(h('p', { class: 'muted' }, 'No sites connected. When a site such as Noidium asks to connect, you choose which public addresses it may see. Keys are never shared.')); return; }
    const nameOf = a => (vaultWallets.find(w => w.addresses?.[0]?.address === a)?.nickname || accounts().find(x => x.address === a)?.nickname || 'Wallet') + ' ' + a.slice(0, 6) + '…' + a.slice(-4);
    for (const [origin, s] of list) box.append(h('div', { class: 'conn' }, h('div', {}, h('b', {}, new URL(origin).host), h('span', { class: 'mono' }, s.accounts.map(nameOf).join(', ') + ' · since ' + new Date(s.at).toLocaleDateString())),
      h('button', { class: 'mini', type: 'button', onclick: e => changeSiteWallet(origin, s, e.target.closest('.conn')) }, 'Change wallet'),
      !SITE_TRADES ? null : h('button', { class: 'mini', type: 'button', 'data-trades': origin, onclick: async () => { const on = siteSigning[origin] !== true;
        // Off unless you turn it on. Even when on, every trade opens this wallet's own review and needs your PIN.
        if (on && !confirm(`Let ${new URL(origin).host} ask this wallet to approve trades and NFT actions?\n\nEach request still opens this wallet's own review with the exact amounts, checked by the wallet, and needs your PIN. Nothing is ever signed automatically. Trades can lose value; only approve what you understand.`)) return;
        await chrome.runtime.sendMessage({ type: 'p1w-site-signing', origin, on }); render(); } }, siteSigning[origin] === true ? 'Trade approvals: on' : 'Trade approvals: off'),
      h('button', { class: 'mini danger', type: 'button', onclick: async () => { await chrome.runtime.sendMessage({ type: 'p1w-disconnect', origin }); render(); } }, 'Disconnect')));
  });
  return box;
}

// ---- shell ----
const NAV = [['wallet', 'Wallet'], ['markets', 'Markets'], ['explorer', 'Explorer'], ['settings', 'Settings']];
function go(v) { if (v !== 'settings' || view !== 'settings') setPage = null; view = v; if (v !== 'wallet') sendState = null; render(); $('app').scrollTop = 0; window.scrollTo(0, 0); }
function render() {
  $('site').textContent = vaultWallets.length ? (V.state().unlocked ? 'Unlocked' : 'Wallet locked') : st.site ? new URL(st.site).host : 'Not set up';
  $('lock').hidden = !V.state().unlocked;
  const app = $('app'); app.replaceChildren();
  app.classList.toggle('two', full && view === 'wallet' && accounts().length > 0);
  const parts = view === 'markets' ? marketsView() : view === 'explorer' ? explorerView() : view === 'settings' ? settingsView() : walletView();
  app.append(...parts.filter(Boolean));
  const nav = $('nav'); nav.replaceChildren(...NAV.map(([k, l]) => h('button', { type: 'button', class: view === k ? 'on' : '', 'aria-current': view === k ? 'page' : null, onclick: () => go(k) }, svgPath(ICONS[k]), h('span', {}, l))));
}
$('lock').onclick = () => { V.lock(); render(); };
V.onChange?.(() => renderSoon());
// Reload when wallets, links or appearance change; the saved holdings snapshot and the artwork choice don't need it
// (re-rendering on them would loop: render → fetch → save → render).
chrome.storage.onChanged.addListener(ch => { if (Object.keys(ch).some(k => !k.startsWith('holdings:') && k !== 'artwork')) load(); });
// Keys never outlive the panel: lock when it closes.
window.addEventListener('pagehide', () => { try { V.lock(); } catch {} });
setInterval(() => { if (view === 'explorer') render(); }, 30000);
load();
// Privacy screen while the expanded view is hidden (tab previews): blur balances and addresses.
document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('privacy-blur', document.visibilityState === 'hidden'));
