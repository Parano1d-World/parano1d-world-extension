# Parano1d World — Chrome extension

Your Parano1d World wallets in the toolbar.

- **Small popup** (toolbar) and **expanded view** (⤢ opens a full tab).
- **Wallets:** Main, Game and watch-only addresses, linked from parano1dworld.com.
- **Balance** and **tokens/NFTs** from the Parano1d World node (native holdings, read-only).
- **Receive:** QR code + copy.
- **Send:** enter recipient and amount; your wallet on parano1dworld.com opens with them filled in, and you confirm there with your PIN.

## Security
- Wallets created or restored **in the extension** are kept in the same encrypted vault as the website
  (`lib/core/vault.js`, byte-identical and tested): PBKDF2 600,000 rounds + AES-GCM, unlocked in memory only. The
  password and PIN are never stored. Wallets **linked from the website** are kept as public addresses and nicknames only.
- Linking happens on parano1dworld.com after unlock + PIN. The content script accepts the message only from the
  page itself (same window, same origin) and the service worker only from the allowed site.
- Permissions: `storage`, `sidePanel` and the parano1dworld.com site. No tabs, history or cookies access. A small
  connector script runs on https pages so a site can ask to connect; the extension checks the site's origin and asks
  you before sharing an address or signing anything.
- Strict extension CSP: `script-src 'self'`, no remote code. All text is inserted with `textContent`.

## Install for testing
1. Chrome → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → choose this `chrome-extension` folder (or unzip `parano1d-world-extension.zip`).
3. Click the puzzle icon → pin **Parano1d World** → **Link wallet**.

Publishing to the Chrome Web Store needs a developer account, a privacy statement (no data collected beyond the
public addresses kept locally) and screenshots.
