// Chrome extension: least-privilege manifest, strict CSP, trusted sites only, account sanitising, no secrets.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { allowedSite, cleanAccounts, formatMicro, shortAddr } from '../chrome-extension/common.js';
const man = JSON.parse(fs.readFileSync(new URL('../chrome-extension/manifest.json', import.meta.url), 'utf8'));
const src = f => fs.readFileSync(new URL('../chrome-extension/' + f, import.meta.url), 'utf8');

test('manifest: MV3, minimal permissions, production hosts only, strict CSP', () => {
  assert.equal(man.manifest_version, 3);
  assert.ok(man.description.length <= 132 && man.name.length <= 75, 'Chrome Web Store limits: description 132, name 75');
  assert.deepEqual(man.permissions, ['storage', 'sidePanel']); // sidePanel: the wallet opens in Chrome's side panel
  assert.deepEqual(man.host_permissions, ['https://parano1dworld.com/*', 'https://www.parano1dworld.com/*']);
  assert.deepEqual(man.content_scripts[0].matches, man.host_permissions);
  assert.match(man.content_security_policy.extension_pages, /^script-src 'self' 'wasm-unsafe-eval'; object-src 'none'/); // wasm: the wallet engine checks and signs trades on this device
  assert.ok(!/unsafe-inline|unsafe-eval|https?:/.test(man.content_security_policy.extension_pages.replace("'wasm-unsafe-eval'", '')));
  assert.ok(!JSON.stringify(man).includes('<all_urls>') && !man.permissions.includes('tabs') && !man.externally_connectable);
  // Wallet connector (MetaMask model): https pages only, top frame only; the page script holds no wallet data.
  const [, bridge, inpage] = man.content_scripts;
  assert.deepEqual([bridge.js, bridge.matches, bridge.all_frames, bridge.world], [['bridge.js'], ['https://*/*'], false, undefined]);
  assert.deepEqual([inpage.js, inpage.matches, inpage.all_frames, inpage.world], [['inpage.js'], ['https://*/*'], false, 'MAIN']);
  assert.ok(!/vault|localStorage|chrome\./.test(src('inpage.js')), 'the page-side provider never touches the wallet');
  assert.match(src('config.js'), /SITE = 'https:\/\/parano1dworld\.com'/);
});

test('only the Parano1d World site (and local preview in dev builds) can link', () => {
  assert.equal(allowedSite('https://parano1dworld.com'), true);
  assert.equal(allowedSite('https://www.parano1dworld.com'), true);
  assert.equal(allowedSite('https://parano1dworld.com.evil.example'), false);
  assert.equal(allowedSite('http://127.0.0.1:8788'), false, 'production build ignores localhost');
  assert.equal(allowedSite('http://127.0.0.1:8788', ['dev']), true);
});

test('accounts are sanitised: public o1 addresses only, capped, deduplicated', () => {
  const a = 'o1' + 'a'.repeat(40);
  const out = cleanAccounts([{ address: a, nickname: '<img onerror=x>', role: 'root', keyId: 'zz', master: 'f'.repeat(64) }, { address: a }, { address: 'f'.repeat(64) }, ...Array.from({ length: 20 }, (_, i) => ({ address: 'o1' + String(i).padStart(40, 'b') }))]);
  assert.deepEqual(out[0], { address: a, nickname: 'Wallet', role: 'other', keyId: null, watchOnly: false });
  assert.ok(out.length <= 12 && !JSON.stringify(out).includes('f'.repeat(64)));
  assert.equal(formatMicro('3000000'), '3'); assert.equal(formatMicro('1250000'), '1.25'); assert.equal(formatMicro('x'), '—');
  assert.equal(shortAddr(a), 'o1aaaa…aaaa');
});

test('no HTML sinks or remote code in extension scripts', () => {
  for (const f of ['popup.js', 'background.js', 'link.js', 'common.js']) {
    const s = src(f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(s), f);
    assert.ok(!/https?:\/\/(?!parano1dworld\.com|www\.w3\.org)/.test(s.replace(/\/\/.*$/gm, '')), f + ' references an unexpected host');
  }
  assert.match(src('link.js'), /e\.source !== window \|\| e\.origin !== location\.origin/);
});

import { cleanRpc, siteOrigin, originWarnings } from '../chrome-extension/common.js';
test('connector: only allowed methods, top-level https origins, look-alike warnings', () => {
  assert.equal(cleanRpc({ method: 'eth_sign' }).error, 'unsupported');
  assert.equal(cleanRpc({ method: 'p1w_getBalance', params: ['f'.repeat(64)] }).error, 'params', 'a key is not an address');
  assert.equal(cleanRpc({ method: 'p1w_signMessage', params: [{ address: 'o1' + 'a'.repeat(40), message: 'x'.repeat(3000) }] }).error, 'params');
  assert.equal(cleanRpc({ method: 'p1w_accounts' }).kind, 'read');
  assert.equal(siteOrigin({ origin: 'https://noidium.com', frameId: 0 }), 'https://noidium.com');
  assert.equal(siteOrigin({ origin: 'https://noidium.com', frameId: 3 }), null, 'iframes cannot ask');
  assert.equal(siteOrigin({ origin: 'http://noidium.com', frameId: 0 }), null, 'http cannot ask');
  assert.equal(siteOrigin({ origin: 'http://127.0.0.1:8794', frameId: 0 }), null); assert.equal(siteOrigin({ origin: 'http://127.0.0.1:8794', frameId: 0 }, true), 'http://127.0.0.1:8794');
  assert.equal(originWarnings('https://noidium.com').length, 0);
  assert.ok(originWarnings('https://noidium-airdrop.com').length && originWarnings('https://xn--nidium-6ya.com').length);
});
