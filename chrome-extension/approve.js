// Approval window for website requests (connect, sign). Shows the site's real address (from Chrome, not the
// page), what it will be able to see, and asks you. Keys stay here: sites only ever get public addresses.
import { shortAddr, originWarnings, formatMicro, cleanNativeRequest } from './common.js';
import { SITE } from './config.js';
import * as V from './lib/core/vault.js';
const $ = id => document.getElementById(id);
const h = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n[k] = v; else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat(9)) if (c !== null && c !== undefined && c !== false) n.append(c); return n; };
const req = new URLSearchParams(location.search).get('req');
const decide = d => chrome.runtime.sendMessage({ type: 'p1w-approval-decide', req, ...d }).then(() => window.close());
// Appearance follows the extension's choice.
(() => { const r = document.documentElement; let c = 'system', p = false; try { c = localStorage.getItem('p1w-theme') || 'system'; p = localStorage.getItem('p1w-paranoid') === 'on'; } catch {}
  const mode = (c === 'cyber' || c === 'world') ? c : (c === 'dark' || (c === 'system' && !matchMedia('(prefers-color-scheme: light)').matches)) ? 'dark' : 'light';
  r.dataset.theme = mode; if (mode === 'cyber' || mode === 'world') r.dataset.mono = ''; if (p) r.dataset.paranoid = 'on'; })();

const TITLES = { p1w_requestAccounts: 'wants to connect to your wallet', p1w_signMessage: 'asks you to sign a message', p1w_signTransaction: 'asks you to sign a transaction', p1w_sendTransaction: 'asks you to sign and send a transaction', p1w_nativeRequest: 'asks you to approve a trade' };
function siteCard(origin, method) {
  const host = new URL(origin).host, warns = originWarnings(origin);
  return h('section', { class: 'card site' }, h('div', { class: 'site-ic', 'aria-hidden': 'true' }, host.replace(/^www\./, '').slice(0, 1).toUpperCase()),
    h('div', { class: 'site-who' }, h('b', { id: 'site-host' }, host), h('span', {}, TITLES[method] || 'sent a request')),
    warns.length ? h('div', { class: 'warn site-warn', role: 'alert' }, warns.map(w => h('p', {}, w))) : null);
}
const GROUP = { main: 'Main', game: 'Gaming', mining: 'Mining', other: 'Other' };
const isGameSite = origin => { try { return /^play\.parano1dworld\.com$/i.test(new URL(origin).host); } catch { return false; } };
async function connectView(r) {
  let list = []; try { list = (await V.wallets()).map(w => ({ address: w.addresses[0].address, nickname: w.nickname, role: w.role, kind: w.category || GROUP[w.role] || 'Other' })); } catch {}
  const { accounts = [], lastUsed = {} } = await chrome.storage.local.get(['accounts', 'lastUsed']);
  for (const a of accounts) if (!list.some(x => x.address === a.address)) list.push({ address: a.address, nickname: a.nickname, role: a.role, kind: 'Linked' });
  // Default: the Game wallet for the game; otherwise the wallet last used with this site; otherwise Main.
  const pref = (isGameSite(r.origin) && list.find(a => a.role === 'game')) || list.find(a => (lastUsed[r.origin] || []).includes(a.address)) || list.find(a => a.role === 'main') || list[0];
  const go = h('button', { class: 'primary', id: 'ok', type: 'button' }, 'Connect');
  const boxes = list.map(a => h('label', { class: 'pick' }, h('input', { type: 'checkbox', value: a.address, checked: a === pref }), h('span', {}, h('b', {}, a.nickname + (a === pref ? ' · suggested' : '')), h('span', { class: 'mono' }, a.address.slice(0, 6) + '…' + a.address.slice(-4) + ' · ' + a.kind))));
  const sync = () => { go.disabled = !boxes.some(b => b.querySelector('input').checked); };
  boxes.forEach(b => b.querySelector('input').onchange = sync);
  go.onclick = async () => { const chosen = boxes.map(b => b.querySelector('input')).filter(i => i.checked).map(i => i.value); try { const { lastUsed = {} } = await chrome.storage.local.get('lastUsed'); lastUsed[r.origin] = chosen; await chrome.storage.local.set({ lastUsed }); } catch {} decide({ approve: true, accounts: chosen }); };
  return [siteCard(r.origin, r.method),
    list.length ? h('section', { class: 'card' }, h('div', { class: 'label' }, 'Choose wallets to share'), ...boxes) : h('section', { class: 'card' }, h('p', { class: 'warn' }, 'There is no wallet in this extension yet. Open the extension to create or restore one, then try again.')),
    h('section', { class: 'card' }, h('div', { class: 'label' }, 'This site will be able to'), h('ul', { class: 'ticks' }, h('li', {}, 'See the public address of the wallets you choose'), h('li', {}, 'See their balances, tokens and NFTs'), h('li', {}, 'Ask you to approve transactions'))),
    h('section', { class: 'card' }, h('div', { class: 'label' }, 'It will never'), h('ul', { class: 'crosses' }, h('li', {}, 'See your master key, password or PIN'), h('li', {}, 'Move funds without your approval each time'))),
    h('div', { class: 'row bar' }, h('button', { class: 'ghost', id: 'no', type: 'button', onclick: () => decide({ approve: false }) }, 'Cancel'), list.length ? go : null),
    h('p', { class: 'foot center' }, 'You can disconnect this site any time in Settings → Connected sites.')];
}
function signView(r) {
  const p = r.params[0] || {};
  const body = r.method === 'p1w_signMessage'
    ? [h('div', { class: 'label' }, 'Message from ' + new URL(r.origin).host), h('pre', { class: 'msg' }, String(p.message)), h('div', { class: 'kv' }, h('span', {}, 'Signing address'), h('b', { class: 'mono' }, shortAddr(p.address)))]
    : [h('div', { class: 'label' }, 'Transaction, as described by the site'), h('p', { class: 'help' }, 'Before signing is switched on, the wallet will decode the transaction itself and show exactly what leaves your wallet and what you receive. A site\'s own description is never trusted.'),
       h('pre', { class: 'msg' }, JSON.stringify(p.summary ?? p, null, 2).slice(0, 4000))];
  return [siteCard(r.origin, r.method), h('section', { class: 'card' }, ...body),
    h('div', { class: 'gate', role: 'note' }, h('b', {}, 'Signing is locked in this test build.'), ' It turns on after the release checks pass. Nothing will be signed or sent.'),
    h('div', { class: 'row bar' }, h('button', { class: 'ghost', id: 'no', type: 'button', onclick: () => decide({ approve: false }) }, 'Reject'), h('button', { class: 'primary', id: 'ok', type: 'button', disabled: true, title: 'Locked until the release checks pass' }, 'Approve')),
    h('button', { class: 'linkbtn', type: 'button', onclick: () => decide({ approve: false, locked: true }) }, 'Close and tell the site signing is not available yet')];
}
// ---- Trades and NFT actions from a connected site (Noidium's shared wallet standard) ----
// The wallet re-checks the request, has the node prepare it, has the wallet engine check that the prepared plan does
// exactly what the request says, shows it in plain words, and signs only after your PIN. The site's own text is never shown.
const short = id => id ? id.slice(0, 8) + '…' + id.slice(-4) : '—';
const units = v => formatMicro(String(v));
function describe(q) {
  switch (q.action) {
    case 'trade': return { title: q.buy ? 'Buy a token' : 'Sell a token', rows: q.buy
      ? [['You pay', units(q.gross_input) + ' NOID'], ['You receive at least', units(q.minimum_output) + ' of token ' + short(q.asset_id)]]
      : [['You pay', units(q.gross_input) + ' of token ' + short(q.asset_id)], ['You receive at least', units(q.minimum_output) + ' NOID']],
      extra: [['Price protection', q.slippage_bps === undefined ? '—' : (q.slippage_bps / 100) + ' % slippage'], ['Valid until block', String(q.valid_until)]] };
    case 'buy_nft': return { title: 'Buy an NFT', rows: [['NFT', short(q.collection_id) + ' #' + q.serial], ['You pay at most', units(q.maximum_ask_micronoid) + ' NOID']], extra: [] };
    case 'list_nft': return { title: 'List an NFT for sale', rows: [['NFT', short(q.collection_id) + ' #' + q.serial], ['Asking price', units(q.ask_micronoid) + ' NOID']], extra: [['Listing ends at block', q.expiry_height >= 2 ** 53 - 1 ? 'no end' : String(q.expiry_height)]] };
    case 'cancel_listing': return { title: 'Cancel an NFT listing', rows: [['NFT', short(q.collection_id) + ' #' + q.serial]], extra: [] };
    case 'transfer_token': return { title: 'Send tokens', rows: [['Amount', units(q.units) + ' of token ' + short(q.asset_id)], ['To', shortAddr(q.recipient)]], extra: [] };
    case 'transfer_nft': return { title: 'Send an NFT', rows: [['NFT', short(q.collection_id) + ' #' + q.serial], ['To', shortAddr(q.recipient)]], extra: [] };
  }
  return null;
}
const kv = ([k, v]) => h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, v));
async function post(path, body) {
  const r = await fetch(SITE + path, { method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-p1w-client': 'parano1d-world-extension' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null); if (!r.ok || !j?.ok) throw new Error((j && j.error) || 'The node could not prepare this.'); return j;
}
async function nativeView(r) {
  const p = r.params[0] || {}, q = cleanNativeRequest(p.request), owner = p.owner, d = q && describe(q);
  const status = h('p', { class: 'help', id: 'nv-status', role: 'status' }, 'Preparing and checking the exact terms…');
  const ok = h('button', { class: 'primary', id: 'ok', type: 'button', disabled: true }, 'Approve');
  const no = h('button', { class: 'ghost', id: 'no', type: 'button', onclick: () => decide({ approve: false }) }, 'Reject');
  if (!q || !d) return [siteCard(r.origin, r.method), h('section', { class: 'card' }, h('p', { class: 'warn' }, 'This request is not one the wallet can check, so it cannot be approved.')), h('div', { class: 'row bar' }, no)];
  const ws = await V.wallets().catch(() => []), w = ws.find(x => x.addresses?.[0]?.address === owner);
  const pwd = h('input', { type: 'password', id: 'nv-pass', autocomplete: 'current-password', placeholder: 'Wallet password' });
  const pin = h('input', { type: 'password', id: 'nv-pin', inputmode: 'numeric', autocomplete: 'off', maxlength: '6', placeholder: 'PIN' });
  const unlocked = V.state().unlocked;
  const card = h('section', { class: 'card' }, h('div', { class: 'label' }, d.title), ...d.rows.map(kv), ...d.extra.map(kv), h('div', { class: 'kv' }, h('span', {}, 'From'), h('b', { class: 'mono' }, (w ? w.nickname + ' · ' : '') + shortAddr(owner))), h('div', { id: 'nv-fee' }), status);
  const out = [siteCard(r.origin, r.method), card];
  if (!w) { status.textContent = 'This wallet\'s key is not in this extension, so it cannot sign here.'; return [...out, h('div', { class: 'row bar' }, no)]; }
  out.push(h('section', { class: 'card' }, h('div', { class: 'label' }, 'Confirm with'), unlocked ? null : pwd, pin), h('div', { class: 'row bar' }, no, ok),
    h('p', { class: 'foot center' }, 'Checked by this wallet, not by the site. Your key never leaves this device.'));
  let plan = null;
  (async () => {
    try {
      const prep = await post('/api/wallet/native', { owner, request: q });
      const pl = prep.plan, review = pl?.review || {};
      if (!pl || pl.owner !== owner) throw new Error('The prepared transaction is for another wallet.');
      const fee = BigInt(review.fee_micronoid || '0'); if (fee > 1_000_000n) throw new Error('The network fee is unusually high.');
      const operation = { native_plan: pl, expected_request: q, expected_chain: pl.chain_id, expected_parent_hash: review.parent_hash, maximum_fee_micronoid: String(fee) };
      const { engine } = await import('./lib/engine/engine.js');
      const check = await engine({ op: 'review', operation });
      if (!check.ok) throw new Error('This wallet could not verify the prepared transaction' + (check.error ? ' (' + check.error + ').' : '.'));
      plan = { operation, txid: review.txid };
      $('nv-fee').replaceChildren(kv(['Network fee', units(String(fee)) + ' NOID']));
      status.textContent = 'Checked: the prepared transaction does exactly what is shown above.' + (prep.backup ? ' (Prepared by the public Parano1d node while our node is offline.)' : '');
      ok.disabled = false;
    } catch (x) { status.textContent = x.message + ' Nothing was signed.'; status.className = 'warn'; }
  })();
  ok.onclick = async () => {
    if (!plan) return; ok.disabled = true; no.disabled = true;
    try {
      if (!V.state().unlocked) await V.unlock(pwd.value);
      await V.confirmPin(pin.value);
      status.textContent = 'Signing on this device… this takes about 10–20 seconds.';
      const auth = await V.authorizeOperation(w.id, plan.operation, plan.txid);
      status.textContent = 'Sending…';
      await post('/api/wallet/submit', { intent_hex: auth.intent_hex, txid: auth.txid });
      decide({ approve: true, txid: auth.txid, spentMicro: String(BigInt(plan.operation.maximum_fee_micronoid || '0') + (q.action === 'trade' && q.buy ? BigInt(q.gross_input) : q.action === 'buy_nft' ? BigInt(q.maximum_ask_micronoid) : 0n)) });
    } catch (x) { status.textContent = x.message + ' Nothing was sent.'; status.className = 'warn'; ok.disabled = false; no.disabled = false; }
  };
  return out;
}
(async () => {
  const r = await chrome.runtime.sendMessage({ type: 'p1w-approval-get', req });
  const app = $('app'); app.replaceChildren();
  if (!r) { app.append(h('section', { class: 'card' }, h('p', {}, 'This request has expired.'))); return; }
  document.title = 'Parano1d World · ' + new URL(r.origin).host;
  app.append(...(r.method === 'p1w_requestAccounts' ? await connectView(r) : r.method === 'p1w_nativeRequest' ? await nativeView(r) : signView(r)));
  document.querySelector('#ok:not([disabled]),#no')?.focus();
})();
