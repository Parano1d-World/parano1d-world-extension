// Service worker.
// 1. Stores the linked website wallets (public data only) received from the Parano1d World site.
// 2. Wallet connector: websites call window.parano1d (inpage.js → bridge.js → here). This checks every request
//    (allowed method, top-level https page, the origin Chrome reports, size), keeps the list of sites you
//    connected and which public addresses each may see, and opens the approval window for anything that shares
//    data or needs a signature. It never touches keys: the vault lives only in the extension's own pages.
import { allowedSite, cleanAccounts, siteOrigin, cleanRpc, RPC_ERR, CHAIN_ID, ADDR } from './common.js';
import { SITE_TRADES } from './config.js';
import { SITE } from './config.js';
import { approvalOk, reviewDigest } from './lib/core/payment-approval.js';
const DEV = (chrome.runtime.getManifest().host_permissions || []).some(h => h.startsWith('http://127.0.0.1'));

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => { chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {}); });

const err = k => ({ error: { code: RPC_ERR[k][0], message: RPC_ERR[k][1] } });
const sites = async () => (await chrome.storage.local.get('sites')).sites || {};
const tabsOf = new Map(); // origin -> Set(tabId), for accountsChanged events
const pending = new Map(); // req -> { origin, method, params, tabId, resolve, windowId }
// Trades this extension sent and the chain hasn't confirmed yet: reported as "pending" in balanceState (what was paid
// plus the fee), so a site never offers the same coins twice. Cleared once the node sees the transaction, or after 30 min.
async function addPending(owner, txid, spent) {
  const { sitePending = [] } = await chrome.storage.local.get('sitePending');
  sitePending.push({ owner, txid, spent, at: Date.now() }); await chrome.storage.local.set({ sitePending: sitePending.slice(-40) });
}
async function openPending(owner) {
  const { sitePending = [] } = await chrome.storage.local.get('sitePending'); const keep = [];
  for (const x of sitePending) {
    if (Date.now() - x.at > 30 * 60_000) continue;
    if (x.owner === owner && keep.filter(k => k.owner === owner).length < 8) { try { const t = await api('/api/explorer/tx?id=' + x.txid); if (Number.isSafeInteger(t?.height ?? t?.tx?.height)) continue; } catch {} }
    keep.push(x);
  }
  await chrome.storage.local.set({ sitePending: keep }); return keep.filter(x => x.owner === owner);
}

async function notify(origin, event, data) { for (const t of tabsOf.get(origin) || []) chrome.tabs.sendMessage(t, { type: 'p1w-event', event, data }).catch(() => {}); }

async function approval(origin, method, params, tabId) {
  for (const p of pending.values()) if (p.origin === origin) return err('pending');
  const req = crypto.randomUUID();
  return new Promise(resolve => {
    pending.set(req, { origin, method, params, tabId, resolve, windowId: null });
    chrome.windows.create({ url: chrome.runtime.getURL(`approve.html?req=${req}`), type: 'popup', width: 400, height: 660, focused: true })
      .then(w => { const p = pending.get(req); if (p) p.windowId = w.id; })
      .catch(() => { pending.delete(req); resolve(err('rejected')); });
  });
}
chrome.windows.onRemoved.addListener(id => { for (const [req, p] of pending) if (p.windowId === id) { pending.delete(req); p.resolve(err('rejected')); } });

async function api(path) {
  const r = await fetch(SITE + path, { credentials: 'omit', cache: 'no-store', headers: { accept: 'application/json' } });
  const j = await r.json().catch(() => null); if (!r.ok || !j?.ok) throw new Error('Wallet data unavailable'); return j;
}

async function rpc(msg, sender) {
  const origin = siteOrigin(sender, DEV); if (!origin) return err('origin');
  const c = cleanRpc(msg); if (c.error) return err(c.error);
  if (sender.tab?.id !== undefined) { if (!tabsOf.has(origin)) tabsOf.set(origin, new Set()); tabsOf.get(origin).add(sender.tab.id); }
  const all = await sites(), site = all[origin], allowed = site?.accounts || [];
  switch (c.method) {
    case 'p1w_chainId': return { result: CHAIN_ID };
    case 'p1w_accounts': return { result: allowed };
    case 'p1w_requestAccounts': return allowed.length ? { result: allowed } : approval(origin, c.method, c.params, sender.tab?.id);
    case 'p1w_disconnect': { delete all[origin]; await chrome.storage.local.set({ sites: all }); notify(origin, 'accountsChanged', []); return { result: true }; }
    case 'p1w_getBalance': case 'p1w_getAssets': {
      if (!allowed.includes(c.params[0])) return err('unauthorized');
      try {
        if (c.method === 'p1w_getBalance') { const r = await api('/api/explorer/address?id=' + c.params[0]); return { result: { address: c.params[0], balanceMicro: r.balanceMicro, provenance: r.balanceProvenance } }; }
        const r = await api('/api/explorer/holdings?id=' + c.params[0]); return { result: { address: c.params[0], height: r.height ?? null, assets: r.assets || [] } };
      } catch (e) { return { error: { code: 4900, message: e.message } }; }
    }
    case 'p1w_balanceState': { // the shared standard's balance call (Noidium): public data for a connected address
      if (!allowed.includes(c.params[0])) return err('unauthorized');
      try { const r = await api('/api/explorer/address?id=' + c.params[0]); const b = /^\d{1,30}$/.test(String(r.balanceMicro)) ? String(r.balanceMicro) : null; if (b === null) throw new Error('Balance unavailable');
        const lk = /^\d{1,30}$/.test(String(r.lockedMicro ?? '')) ? BigInt(r.lockedMicro) : null, sp = lk === null ? b : String(BigInt(b) > lk ? BigInt(b) - lk : 0n);
        // stale: not checked by our node, or the locked amount is unknown, so "spendable" may be too high. The wallet's own review decides.
        const pend = await openPending(c.params[0]), pAmt = pend.reduce((t, x) => t + BigInt(x.spent), 0n), spendable = BigInt(sp) > pAmt ? String(BigInt(sp) - pAmt) : '0';
        return { result: { address: c.params[0], total: b, spendable, pending: String(pAmt), pendingTxs: pend.length, readyAtBlock: null, stale: r.balanceProvenance !== 'node-verified' || lk === null } }; }
      catch (e) { return { error: { code: 4900, message: e.message } }; }
    }
    case 'p1w_nativeRequest': { // a trade or NFT action from a connected site: prepared, decoded and signed only in the approval window
      if (!allowed.length) return err('unauthorized');
      const { siteSigning = {} } = await chrome.storage.local.get('siteSigning');
      if (SITE_TRADES !== true || siteSigning[origin] !== true) return err('off');
      return approval(origin, c.method, [{ request: c.params[0].request, owner: allowed[0] }], sender.tab?.id);
    }
    default: // signing: only for a connected address, and always through the approval window
      if (!allowed.length) return err('unauthorized');
      if (c.method === 'p1w_signMessage' && !allowed.includes(c.params[0].address)) return err('unauthorized');
      return approval(origin, c.method, c.params, sender.tab?.id);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Website wallet link (public addresses) from the Parano1d World site's content script.
  if (msg?.type === 'link' && sender.tab && sender.id === chrome.runtime.id) {
    const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
    if (!allowedSite(origin, DEV ? ['dev'] : [])) { reply({ ok: false, error: 'This site is not Parano1d World' }); return; }
    const accounts = cleanAccounts(msg.accounts);
    if (!accounts.length) { reply({ ok: false, error: 'No wallets received' }); return; }
    const ap = msg.appearance && ['system', 'dark', 'light', 'cyber', 'world'].includes(msg.appearance.theme) ? { theme: msg.appearance.theme, paranoid: msg.appearance.paranoid === true } : null;
    chrome.storage.local.set({ site: origin, accounts, active: accounts[0].address, linkedAt: Date.now(), ...(ap ? { appearance: ap } : {}) }).then(() => reply({ ok: true, count: accounts.length }));
    return true;
  }
  // Connector requests from websites (via bridge.js).
  if (msg?.type === 'p1w-rpc' && sender.id === chrome.runtime.id && sender.tab) { rpc(msg, sender).then(reply, () => reply(err('rejected'))); return true; }
  // The approval window (an extension page) reads its request and sends the decision.
  const fromExt = sender.id === chrome.runtime.id && (sender.url || '').startsWith(chrome.runtime.getURL('')); // the extension's own pages only (the approval window is a tab)
  if (msg?.type === 'p1w-approval-get' && fromExt) { const p = pending.get(msg.req); reply(p ? { origin: p.origin, method: p.method, params: p.params } : null); return; }
  if (msg?.type === 'p1w-approval-decide' && fromExt) {
    const p = pending.get(msg.req); if (!p) { reply(false); return; }
    pending.delete(msg.req);
    (async () => {
      if (!msg.approve) p.resolve(err(msg.locked ? 'locked' : 'rejected'));
      else if (p.method === 'p1w_requestAccounts') {
        const accounts = (Array.isArray(msg.accounts) ? msg.accounts : []).filter(a => ADDR.test(a)).slice(0, 12);
        if (!accounts.length) p.resolve(err('rejected'));
        else { const all = await sites(); all[p.origin] = { accounts, at: Date.now() }; await chrome.storage.local.set({ sites: all }); p.resolve({ result: accounts }); notify(p.origin, 'accountsChanged', accounts); }
      } else if (p.method === 'p1w_nativeRequest') {
        // The approval window prepared, decoded, PIN-authorized and submitted it; it reports only the transaction id.
        if (typeof msg.txid === 'string' && /^[0-9a-f]{64}$/.test(msg.txid)) {
          const owner = p.params?.[0]?.owner, spent = /^\d{1,20}$/.test(String(msg.spentMicro || '')) ? String(msg.spentMicro) : '0';
          if (typeof owner === 'string') await addPending(owner, msg.txid, spent);
          p.resolve({ result: { txid: msg.txid } }); notify(p.origin, 'balanceChanged', null); }
        else p.resolve(err('rejected'));
      } else {
        // Fail closed (audit 176): an approval from the extension window must carry the exact recipient, amount and
        // review digest it showed, plus its source; anything missing or different is refused and nothing is signed.
        const q = p.params?.[0] || {}, pay = p.method === 'p1w_sendTransaction' || p.method === 'p1w_signTransaction';
        const expected = pay ? { to: q.to, amount: q.amount, digest: await reviewDigest({ to: q.to, amount: q.amount }) } : null;
        if (!expected || !approvalOk(msg.review, expected)) p.resolve(err('rejected'));
        else p.resolve(err('locked')); // signing is locked until the release checks pass
      }
      if (p.windowId) chrome.windows.remove(p.windowId).catch(() => {});
      reply(true);
    })();
    return true;
  }
  // Settings: disconnect a site from inside the extension.
  // Settings: switch which wallet(s) a connected site sees (public addresses only; the site is told).
  if (msg?.type === 'p1w-set-site-accounts' && fromExt && typeof msg.origin === 'string' && Array.isArray(msg.accounts) && msg.accounts.length && msg.accounts.length <= 12 && msg.accounts.every(a => typeof a === 'string' && /^o1[a-z0-9]{20,120}$/.test(a))) {
    sites().then(async all => { if (!all[msg.origin]) return reply(false); all[msg.origin] = { ...all[msg.origin], accounts: msg.accounts, at: all[msg.origin].at }; await chrome.storage.local.set({ sites: all }); notify(msg.origin, 'accountsChanged', msg.accounts); reply(true); }); return true;
  }
  // Settings: allow or stop trade approvals for one connected site (off unless the owner turns it on).
  if (msg?.type === 'p1w-site-signing' && fromExt && SITE_TRADES === true && typeof msg.origin === 'string') {
    // Only for a site that is already connected (its origin came from the browser when it connected).
    Promise.all([sites(), chrome.storage.local.get('siteSigning')]).then(async ([all, { siteSigning = {} }]) => { if (!all[msg.origin]) return reply(false); if (msg.on === true) siteSigning[msg.origin] = true; else delete siteSigning[msg.origin]; await chrome.storage.local.set({ siteSigning }); reply(true); }); return true;
  }
  if (msg?.type === 'p1w-disconnect' && fromExt && typeof msg.origin === 'string') { sites().then(async all => { delete all[msg.origin]; const { siteSigning = {} } = await chrome.storage.local.get('siteSigning'); delete siteSigning[msg.origin]; await chrome.storage.local.set({ sites: all, siteSigning }); notify(msg.origin, 'accountsChanged', []); reply(true); }); return true; }
});
