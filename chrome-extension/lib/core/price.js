// NOID/USD price, same order as every Parano1d app:
// 1. our node feed  2. CoinPaprika, then NOID Scan (server-side backup; never in Paranoid mode)
// 3. the last saved price for up to 30 minutes  4. nothing. A price is never made up.

export const FRESH_MS = 30 * 60_000, SKIP_MS = 5 * 60_000;
const KEY = 'p1w_price_v1', skip = new Map(), listeners = new Set();
let current = null, timer = null, inflight = null;
let paranoid = () => { try { return localStorage.getItem('parano1d_world_paranoid_v1') === 'on'; } catch { return false; } };
let BASE = '';
/** The Chrome extension shares this file: it sets the site address and its own Paranoid switch. */
export function configurePrice({ base = '', isParanoid } = {}) { BASE = base; if (isParanoid) paranoid = isParanoid; }
const fresh = p => p && Number(p.usd) > 0 && Date.now() - Date.parse(p.updated) <= FRESH_MS && Date.parse(p.updated) <= Date.now() + 60_000;

async function one(path, origin) {
  if (skip.get(path) > Date.now()) return null;
  if (paranoid() && origin === 'backup') return null; // backup sources are other sites (see THIRD_PARTY in api.js)
  try {
    const r = await fetch(path, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    const p = r.ok ? await r.json() : null;
    if (fresh(p)) return { usd: String(p.usd), updated: p.updated, source: p.source, sources: Array.isArray(p.sources) ? p.sources : [], via: origin,
      volume24h: /^\d{1,15}(\.\d+)?$/.test(p.volume_24h_usd || '') ? Number(p.volume_24h_usd) : null,
      change24h: /^-?\d{1,4}(\.\d{1,2})?$/.test(p.change_24h_pct || '') ? Number(p.change_24h_pct) : null };
  } catch {}
  skip.set(path, Date.now() + SKIP_MS); return null;
}

/** Latest fresh price or null. `via` is 'node' (our feed), 'backup' or 'saved'. */
export async function getPrice({ base = BASE } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    let p = await one(base + '/api/explorer/price', 'node') || await one(base + '/api/price/backup', 'backup');
    if (p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} }
    else { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (fresh(s)) p = { ...s, via: 'saved' }; } catch {} }
    current = p; inflight = null; for (const f of listeners) try { f(p); } catch {}
    return p;
  })();
  return inflight;
}
export const lastPrice = () => (fresh(current) ? current : null);
/** Plain-language line, e.g. "Parano1d World price" or "Saved price · 4 min old". The upstream source (exchange or
 *  aggregator) is never shown publicly; it is only in the owner's status (owner decision, 24 Nov). */
export function sourceLine(p) {
  if (!p) return 'Price unavailable';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(p.updated)) / 60000));
  if (p.via === 'saved') return `Saved price · ${mins} min old`;
  return p.via === 'node' ? 'Parano1d World price' : 'Backup price';
}
/** Format a USD amount; '—' when there is no price. */
export const usd = (noid, p = lastPrice()) => { if (!p || !Number.isFinite(+noid)) return '—'; const v = +noid * +p.usd; return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: v < 1 ? 4 : 2, maximumFractionDigits: v < 1 ? 4 : 2 }); };
/** Refresh every 60 s and call `fn` with each result; returns an unsubscribe. */
export function watchPrice(fn, opts) { listeners.add(fn); if (current) fn(current); if (!timer) { getPrice(opts); timer = setInterval(() => getPrice(opts), 60_000); } return () => { listeners.delete(fn); if (!listeners.size) { clearInterval(timer); timer = null; } }; }
