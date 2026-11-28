// Content script on the Parano1d World site. Relays the wallet page's "Send to extension" message (public
// addresses only) to the extension, and nothing else. It never reads the page's storage or DOM.
window.addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data; if (!d || d.type !== 'p1w-extension-link' || d.v !== 1 || !Array.isArray(d.accounts)) return;
  chrome.runtime.sendMessage({ type: 'link', accounts: d.accounts.slice(0, 12), appearance: d.appearance }, r => {
    window.postMessage({ type: 'p1w-extension-linked', ok: Boolean(r?.ok), count: r?.count || 0, error: r?.error || null }, location.origin);
  });
});
