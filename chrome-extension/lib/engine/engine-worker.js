// Runs the wallet engine off the page thread (authorizing a payment takes several seconds of proving).
// Messages: { id, request } -> { id, result }. The worker keeps no state between requests.
import init, { engine_call } from './p1w-engine.js';
const ready = init();
self.onmessage = async e => {
  const { id, request } = e.data || {};
  try { await ready; self.postMessage({ id, result: JSON.parse(engine_call(JSON.stringify(request))) }); }
  catch (x) { self.postMessage({ id, result: { ok: false, error: 'Wallet engine failed to run: ' + (x?.message || x) } }); }
};
