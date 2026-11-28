// Shared rules for the extension (also unit-tested in node).
export const ADDR = /^o1[a-z0-9]{20,140}$/, NICK = /^[\p{L}\p{N} ._'-]{1,24}$/u, KEYID = /^[0-9a-f]{4}(·[0-9a-f]{4}){3}$/;
export const ROLES = ['main', 'game', 'other'];
/** Sites the extension trusts. Dev builds add http://127.0.0.1:<port> (tools/build.mjs writes a dev manifest). */
export function allowedSite(origin, extra = []) {
  return ['https://parano1dworld.com', 'https://www.parano1dworld.com', ...extra].includes(origin) || (extra.includes('dev') && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin));
}
export function cleanAccounts(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(), out = [];
  for (const a of list.slice(0, 12)) {
    if (!a || !ADDR.test(a.address) || seen.has(a.address)) continue; seen.add(a.address);
    out.push({ address: a.address, nickname: NICK.test(String(a.nickname || '').trim()) ? String(a.nickname).trim() : 'Wallet', role: ROLES.includes(a.role) ? a.role : 'other', keyId: KEYID.test(a.keyId || '') ? a.keyId : null, watchOnly: a.source === 'watch' });
  }
  return out;
}
export const shortAddr = a => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '');
export function formatMicro(m, max = 6) {
  if (m === null || m === undefined || !/^\d{1,30}$/.test(String(m))) return '—';
  const v = BigInt(m), w = (v / 1000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','), f = (v % 1000000n).toString().padStart(6, '0').slice(0, max).replace(/0+$/, '');
  return f ? `${w}.${f}` : w;
}

// Wallet connector rules: shared with the website (lib/core/connect-rules.js, kept identical by a test).
export * from './lib/core/connect-rules.js';
