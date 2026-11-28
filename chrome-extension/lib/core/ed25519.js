// Ed25519 (RFC 8032) and X25519 (RFC 7748) in plain JavaScript, used only when the browser's WebCrypto lacks them
// (some Safari / iOS versions). Verification follows ed25519-dalek's verify_strict (canonical S, re-encoded R
// compared byte for byte); the caller already refuses small-order keys and R. Not constant-time: public-key
// operations (verify) are safe either way, and signing/X25519 here run only on the user's own device.
const P = 2n ** 255n - 19n, L = 2n ** 252n + 27742317777372353535851937790883648493n;
const D = -121665n * inv(121666n) % P, I = pow(2n, (P - 1n) / 4n);
const Gy = 4n * inv(5n) % P, Gx = recoverX(Gy, 0);
const G = [Gx, Gy, 1n, Gx * Gy % P];
function mod(a, m = P) { const r = a % m; return r >= 0n ? r : r + m; }
function pow(b, e, m = P) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
function inv(a) { return pow(a, P - 2n); }
function recoverX(y, sign) {
  const xx = mod((y * y - 1n) * inv(D * y * y + 1n)); if (xx === 0n) return sign ? null : 0n;
  let x = pow(xx, (P + 3n) / 8n); if (mod(x * x - xx) !== 0n) x = mod(x * I); if (mod(x * x - xx) !== 0n) return null;
  if (Number(x & 1n) !== sign) x = P - x; return x;
}
function add([X1, Y1, Z1, T1], [X2, Y2, Z2, T2]) {
  const A = mod((Y1 - X1) * (Y2 - X2)), B = mod((Y1 + X1) * (Y2 + X2)), C = mod(2n * T1 * T2 * D), Dd = mod(2n * Z1 * Z2);
  const E = B - A, F = Dd - C, Gg = Dd + C, H = B + A; return [mod(E * F), mod(Gg * H), mod(F * Gg), mod(E * H)];
}
function mul(pt, n) { let q = [0n, 1n, 1n, 0n]; while (n > 0n) { if (n & 1n) q = add(q, pt); pt = add(pt, pt); n >>= 1n; } return q; }
function encode([X, Y, Z]) { const zi = inv(Z), x = mod(X * zi), y = mod(Y * zi); const b = le(y, 32); b[31] |= Number(x & 1n) << 7; return b; }
function decode(b) {
  if (b.length !== 32) return null; const c = b.slice(); const sign = c[31] >> 7; c[31] &= 0x7f; const y = fromLe(c);
  if (y >= P) return null; const x = recoverX(y, sign); if (x === null) return null; return [x, y, 1n, mod(x * y)];
}
function le(n, len) { const b = new Uint8Array(len); for (let i = 0; i < len; i++) { b[i] = Number(n & 255n); n >>= 8n; } return b; }
function fromLe(b) { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; }
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const sha512 = async b => new Uint8Array(await crypto.subtle.digest('SHA-512', b));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function expand(seed) { const h = await sha512(seed); const a = h.slice(0, 32); a[0] &= 248; a[31] &= 127; a[31] |= 64; return { a: fromLe(a), prefix: h.slice(32) }; }
export async function edPublicKey(seed) { const { a } = await expand(seed); return encode(mul(G, a)); }
export async function edSign(seed, msg) {
  const { a, prefix } = await expand(seed), A = encode(mul(G, a));
  const r = mod(fromLe(await sha512(cat(prefix, msg))), L), R = encode(mul(G, r));
  const k = mod(fromLe(await sha512(cat(R, A, msg))), L);
  return cat(R, le(mod(r + k * a, L), 32));
}
export async function edVerify(pub, msg, sig) {
  if (sig.length !== 64 || pub.length !== 32) return false;
  const A = decode(pub), Rb = sig.slice(0, 32), s = fromLe(sig.slice(32)); if (!A || s >= L || !decode(Rb)) return false;
  const k = mod(fromLe(await sha512(cat(Rb, pub, msg))), L);
  const negA = [mod(-A[0]), A[1], A[2], mod(-A[3])];
  return eq(encode(add(mul(G, s), mul(negA, k))), Rb);
}

// X25519: Montgomery ladder on the u coordinate (RFC 7748).
export function x25519(scalar, u = le(9n, 32)) {
  const k = scalar.slice(); k[0] &= 248; k[31] &= 127; k[31] |= 64; const n = fromLe(k);
  const uc = u.slice(); uc[31] &= 127; const x1 = mod(fromLe(uc));
  let x2 = 1n, z2 = 0n, x3 = x1, z3 = 1n, swap = 0n;
  for (let t = 254n; t >= 0n; t--) {
    const kt = (n >> t) & 1n; if (swap ^ kt) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; } swap = kt;
    const A = mod(x2 + z2), AA = A * A % P, B = mod(x2 - z2), BB = B * B % P, E = mod(AA - BB), C = mod(x3 + z3), Dd = mod(x3 - z3);
    const DA = Dd * A % P, CB = C * B % P;
    x3 = mod((DA + CB) ** 2n); z3 = mod(x1 * mod((DA - CB) ** 2n)); x2 = AA * BB % P; z2 = mod(E * (AA + 121665n * E));
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
  return le(mod(x2 * inv(z2)), 32);
}
