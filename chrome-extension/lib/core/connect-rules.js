// Wallet connector rules, shared by the website wallet window and the extension (kept identical by a test).
// Sites such as Noidium connect like MetaMask; keys never leave the wallet.
const ADDR = /^o1[a-z0-9]{20,140}$/;
export const CHAIN_ID = 'parano1d:mainnet';
/** Methods a website may call. Anything else is refused (4200). */
export const RPC_METHODS = Object.freeze({
  p1w_requestAccounts: 'approve', p1w_accounts: 'read', p1w_chainId: 'read', p1w_getBalance: 'read', p1w_getAssets: 'read',
  p1w_signMessage: 'sign', p1w_signTransaction: 'sign', p1w_sendTransaction: 'sign', p1w_disconnect: 'read',
  p1w_balanceState: 'read', p1w_nativeRequest: 'sign',
});
/** Native actions a site may ask the wallet to prepare, review and sign (the same request shapes Noidium sends).
 *  Each field is checked exactly; unknown fields are refused. Creating tokens or collections and minting are not offered. */
const H64 = /^[0-9a-f]{64}$/, UINT = /^[1-9]\d{0,19}$/, SERIAL = /^\d{1,12}$/, HEIGHT = v => Number.isSafeInteger(v) && v > 0;
export const NATIVE_ACTIONS = Object.freeze({
  trade: { asset_id: v => H64.test(v), buy: v => typeof v === 'boolean', gross_input: v => UINT.test(v), minimum_output: v => UINT.test(v), slippage_bps: v => Number.isInteger(v) && v >= 0 && v <= 5000, valid_until: HEIGHT },
  buy_nft: { collection_id: v => H64.test(v), serial: v => SERIAL.test(v), maximum_ask_micronoid: v => UINT.test(v) },
  list_nft: { collection_id: v => H64.test(v), serial: v => SERIAL.test(v), ask_micronoid: v => UINT.test(v), expiry_height: HEIGHT },
  cancel_listing: { collection_id: v => H64.test(v), serial: v => SERIAL.test(v) },
  transfer_token: { asset_id: v => H64.test(v), units: v => UINT.test(String(v)), recipient: v => ADDR.test(v) },
  transfer_nft: { collection_id: v => H64.test(v), serial: v => SERIAL.test(String(v)), recipient: v => ADDR.test(v) },
});
const OPTIONAL = { trade: ['slippage_bps'] };
/** A clean copy of a site's native request, or null. */
export function cleanNativeRequest(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const spec = NATIVE_ACTIONS[r.action]; if (!spec) return null;
  const keys = Object.keys(r).filter(k => k !== 'action');
  if (keys.some(k => !Object.hasOwn(spec, k))) return null;
  const out = { action: r.action };
  for (const [k, ok] of Object.entries(spec)) {
    if (r[k] === undefined) { if ((OPTIONAL[r.action] || []).includes(k)) continue; return null; }
    if (!ok(r[k])) return null; out[k] = r[k];
  }
  return out;
}
export const RPC_ERR = Object.freeze({ rejected: [4001, 'You rejected the request.'], unauthorized: [4100, 'Connect this site to the wallet first (p1w_requestAccounts).'],
  unsupported: [4200, 'This wallet does not support that method.'], off: [4200, 'Approving trades from websites is switched off in this wallet (Settings → Connected sites).'], locked: [4200, 'Signing turns on after the wallet\'s release checks pass. Nothing was signed.'],
  pending: [-32002, 'A request from this site is already waiting in the wallet.'], params: [-32602, 'Invalid parameters.'], origin: [4100, 'Only secure (https) sites can connect.'] });
/** The site asking, as Chrome reports it (never what the page claims). https only, plus the local preview in dev builds. */
export function siteOrigin(sender, dev = false) {
  const o = sender?.origin || (sender?.url ? new URL(sender.url).origin : '');
  if (sender?.frameId !== 0) return null; // top-level pages only, never iframes
  if (/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o)) return o.toLowerCase();
  return dev && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(o) ? o : null;
}
/** Warnings shown on the approval screen for the site's address. */
export function originWarnings(origin) {
  const host = new URL(origin).hostname, w = [];
  if (/(^|\.)xn--/.test(host)) w.push('This address uses look-alike characters (punycode). Check it carefully.');
  if (/parano1d|paranoid|noidium|nodium/i.test(host) && !/^(www\.)?(parano1dworld\.com|noidium\.com)$/.test(host)) w.push('This site uses a name like Parano1d World or Noidium but is not their official address.');
  if (host.split('.').length > 4) w.push('Unusually long site address.');
  return w;
}
/** Validate and copy a request from a website (bounded size, plain data only). */
export function cleanRpc(msg) {
  if (!msg || typeof msg.method !== 'string' || !Object.hasOwn(RPC_METHODS, msg.method)) return { error: 'unsupported' };
  let params; try { params = msg.params === undefined ? [] : JSON.parse(JSON.stringify(msg.params)); } catch { return { error: 'params' }; }
  if (!Array.isArray(params) || JSON.stringify(params).length > 65_536) return { error: 'params' };
  if (['p1w_getBalance', 'p1w_getAssets'].includes(msg.method) && !ADDR.test(params[0] || '')) return { error: 'params' };
  if (msg.method === 'p1w_signMessage' && (!params[0] || !ADDR.test(params[0].address || '') || typeof params[0].message !== 'string' || params[0].message.length > 2048)) return { error: 'params' };
  if (['p1w_signTransaction', 'p1w_sendTransaction'].includes(msg.method) && (!params[0] || typeof params[0] !== 'object')) return { error: 'params' };
  if (msg.method === 'p1w_nativeRequest') { const r = cleanNativeRequest(params[0]?.request); if (!r) return { error: 'params' }; params = [{ request: r }]; }
  return { method: msg.method, params, kind: RPC_METHODS[msg.method] };
}
