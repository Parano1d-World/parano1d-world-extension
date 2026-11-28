// Relays window.parano1d requests between the page and the extension. Isolated from the page's scripts;
// passes plain data only and adds nothing about the wallet.
window.addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data; if (!d || d.target !== 'p1w-bridge' || typeof d.id !== 'string' || d.id.length > 64) return;
  let params; try { params = JSON.parse(JSON.stringify(d.params ?? [])); } catch { params = null; }
  const reply = r => window.postMessage({ target: 'p1w-inpage', id: d.id, ...r }, location.origin);
  try {
    chrome.runtime.sendMessage({ type: 'p1w-rpc', method: String(d.method || ''), params }, r => {
      if (chrome.runtime.lastError || !r) { reply({ error: { code: 4900, message: 'The wallet is not available.' } }); return; }
      reply(r);
    });
  } catch { reply({ error: { code: 4900, message: 'The wallet is not available.' } }); }
});
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'p1w-event') return;
  window.postMessage({ target: 'p1w-inpage', event: msg.event, data: msg.data }, location.origin);
});
