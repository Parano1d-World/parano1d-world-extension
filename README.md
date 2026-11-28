# Parano1d World browser extension

The Parano1d World extension for Chrome, Edge and Brave: connects your Parano1d World wallet to sites such as the
Parano1d World game, shows which wallet a site may use, and asks before anything is signed. Published by KoAjent LLC
for review and audit.

- **Permissions:** `storage` and `sidePanel`, with host access to parano1dworld.com. A small connector script runs on
  https pages so a site can ask to connect (`inpage.js` / `bridge.js`); it only relays requests to the extension, which
  checks the site's origin and asks you before sharing an address or signing anything.
- **Same wallet code as the website:** `chrome-extension/lib/core/` is byte-identical to the website's wallet code
  (checked by `tests/extension.test.mjs`).
- **Safety checks before signing:** look-alike addresses must be retyped, first and large payments ask again.

## Layout
| Path | What |
|---|---|
| `chrome-extension/` | The extension as packaged (`manifest.json`, popup, background, approval window, wallet library) |
| `tests/` | Unit tests: `node --test tests/*.test.mjs` (Node.js 22+) |

Install from the link on https://parano1dworld.com (Desktop Wallet page). Security: see `SECURITY.md`.
