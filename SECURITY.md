# Security

Please report vulnerabilities privately to **support@koajent.com**, not in a public issue.

Include what you found, how to reproduce it and what it affects. We will confirm receipt, keep you informed and credit
you if you wish once a fix is out.

Never send anyone your master key, recovery words or wallet password. Parano1d World will never ask for them.

## Local mining dashboard

The website and the Desktop Wallet link to the mining dashboard that runs on the miner's own computer. Its address is
defined once, in `deploy/js/core/local-ports.js` (website) and `desktop/local-ports.js` (Desktop Wallet), together with
the official Parano1d node's standard ports. The dashboard listens on that computer only (loopback), so nothing on the
internet or the local network can reach it, and it needs the access code kept in that computer's user account. Phones
never use this address: they reach a mining computer through parano1dworld.com with commands signed by the phone's own
key, and only after the owner turns on "Allow control from a phone" on that computer (off by default).
