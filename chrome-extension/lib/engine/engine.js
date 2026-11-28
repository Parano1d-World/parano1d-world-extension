// Page-side client for the wallet engine worker. One worker, created on first use.
let worker = null, seq = 0; const waiting = new Map();
// Trusted Types: the only script URL this site ever creates is its own engine worker, next to this file.
const ENGINE_URL = new URL('./engine-worker.js', import.meta.url).href;
const ttPolicy = globalThis.trustedTypes?.createPolicy ? globalThis.trustedTypes.createPolicy('parano1d-engine', { createScriptURL: u => { if (u !== ENGINE_URL) throw new TypeError('Blocked script URL'); return u; } }) : null;
function get() {
  if (worker) return worker;
  worker = new Worker(ttPolicy ? ttPolicy.createScriptURL(ENGINE_URL) : ENGINE_URL, { type: 'module', name: 'p1w-engine' });
  worker.onmessage = e => { const w = waiting.get(e.data?.id); if (w) { waiting.delete(e.data.id); w(e.data.result); } };
  worker.onerror = () => { for (const w of waiting.values()) w({ ok: false, error: 'Wallet engine could not start in this browser.' }); waiting.clear(); worker = null; };
  return worker;
}
/** Run one engine request; resolves to its JSON result ({ ok, ... } or { ok:false, error }). */
export function engine(request) { return new Promise(resolve => { const id = ++seq; waiting.set(id, resolve); get().postMessage({ id, request }); }); }
