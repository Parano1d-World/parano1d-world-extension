// NOID key derivation, ported 1:1 from the Apache-2.0 Parano1d sources and checked against known-answer
// vectors produced by the official web wallet (tests/vectors/noid-addresses.json):
//   spend_secret(master, i) = Poseidon2bSponge(IV=0).absorb(master_lo, master_hi, i, "noid-deri").finalize()
//   address(secret)         = bech32m("o", Poseidon2bSponge(IV=ADDRFIX_).absorb_pair(secret_lo, secret_hi).finalize_no_pad())
// GF(2^128) arithmetic runs in the flat (GCM polynomial) basis, exactly as noid_poseidon2b does internally.
// This module never stores, logs or transmits secrets; callers wipe their buffers.
import { TOWER_TO_FLAT, FLAT_TO_TOWER, ROUND_CONSTANTS, MDS_FULL, MDS_PARTIAL } from './poseidon2b-tables.js';

const M128 = (1n << 128n) - 1n, M64 = (1n << 64n) - 1n;
const F_ROUNDS = 8, P_ROUNDS = 58, N_ROUNDS = F_ROUNDS + P_ROUNDS;

function applyMatrix(m, v) { let r = 0n, i = 0; while (v) { if (v & 1n) r ^= m[i]; v >>= 1n; i++; } return r; }
const toFlat = v => applyMatrix(TOWER_TO_FLAT, v), toTower = v => applyMatrix(FLAT_TO_TOWER, v);

// 64x64 carry-less multiply, 4-bit window.
function clmul64(a, b) {
  const a2 = a << 1n, a4 = a << 2n, a8 = a << 3n;
  const t = [0n, a, a2, a ^ a2, a4, a ^ a4, a2 ^ a4, a ^ a2 ^ a4, a8, a ^ a8, a2 ^ a8, a ^ a2 ^ a8, a4 ^ a8, a ^ a4 ^ a8, a2 ^ a4 ^ a8, a ^ a2 ^ a4 ^ a8];
  let r = 0n;
  for (let k = 60n; k >= 0n; k -= 4n) r = (r << 4n) ^ t[Number((b >> k) & 0xfn)];
  return r;
}
const by87 = a => a ^ (a << 1n) ^ (a << 2n) ^ (a << 7n);
function reduce(hi, lo) {
  const v1 = by87(hi & M64), v2 = by87(hi >> 64n);
  const low = (lo ^ v1 ^ (v2 << 64n)) & M128, rest = v2 >> 64n;
  return (low ^ by87(rest)) & M128;
}
export function mulGcm(a, b) {
  const al = a & M64, ah = a >> 64n, bl = b & M64, bh = b >> 64n;
  const v0 = clmul64(al, bl), v1 = clmul64(ah, bh), mid = clmul64(al ^ ah, bl ^ bh) ^ v0 ^ v1;
  return reduce(v1 ^ (mid >> 64n), (v0 ^ (mid << 64n)) & M128);
}
const sbox = x => { const x2 = mulGcm(x, x), x4 = mulGcm(x2, x2); return mulGcm(mulGcm(x, x2), x4); };

let T = null; // flat-basis tables, built once
function tables() {
  if (T) return T;
  const fm = m => m.map(row => row.map(v => ({ one: v === 1n, f: toFlat(v) })));
  return (T = { rc: ROUND_CONSTANTS.map(row => row.map(toFlat)), full: fm(MDS_FULL), part: fm(MDS_PARTIAL) });
}
function mds(s, m) { const o = [0n, 0n, 0n, 0n]; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[i] ^= m[i][j].one ? s[j] : mulGcm(s[j], m[i][j].f); return o; }
/** Poseidon2b permutation on a tower-basis state of four 128-bit elements. */
export function permute(state) {
  const t = tables(); let s = state.map(toFlat);
  s = mds(s, t.full);
  for (let r = 0; r < N_ROUNDS; r++) {
    if (r < F_ROUNDS / 2 || r >= F_ROUNDS / 2 + P_ROUNDS) { for (let i = 0; i < 4; i++) s[i] = sbox(s[i] ^ t.rc[i][r]); s = mds(s, t.full); }
    else { s[0] = sbox(s[0] ^ t.rc[0][r]); s = mds(s, t.part); }
  }
  return s.map(toTower);
}

const leU128 = (b, o) => { let v = 0n; for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]); return v; };
const putU128 = (v, b, o) => { for (let i = 0; i < 16; i++) { b[o + i] = Number(v & 0xffn); v >>= 8n; } };
/** Rate-2 sponge over 32-byte blocks, matching Poseidon2bSponge (absorb / finalize / finalize_no_pad). */
export class Sponge {
  constructor(iv = [0n, 0n]) { this.s = [0n, 0n, iv[0], iv[1]]; this.buf = new Uint8Array(32); this.n = 0; }
  #block() { this.s[0] ^= leU128(this.buf, 0); this.s[1] ^= leU128(this.buf, 16); this.s = permute(this.s); }
  update(bytes) { for (const x of bytes) { this.buf[this.n++] = x; if (this.n === 32) { this.#block(); this.n = 0; } } }
  absorb(v) { const b = new Uint8Array(16); putU128(v, b, 0); this.update(b); b.fill(0); }
  finalize() { this.buf.fill(0, this.n); this.buf[this.n] |= 0x80; this.buf[31] |= 0x01; this.#block(); return this.squeeze(); }
  finalizeNoPad() { if (this.n) throw new Error('finalizeNoPad needs whole blocks'); return this.squeeze(); }
  squeeze() { const o = new Uint8Array(32); putU128(this.s[0], o, 0); putU128(this.s[1], o, 16); this.wipe(); return o; }
  wipe() { this.s = [0n, 0n, 0n, 0n]; this.buf.fill(0); this.n = 0; }
}
export const tagIv = label => { const v = [...label].reduce((a, c) => (a << 8n) | BigInt(c.charCodeAt(0)), 0n); return [v << 64n, v]; };
const IV_ADDRFIX = tagIv('ADDRFIX_');
const DERIVE_TAG = 0x6E6F69642D64657269n; // "noid-deri"

/** Per-index spend secret (32 bytes) from the 32-byte master secret. */
export function spendSecret(master, index) {
  if (!(master instanceof Uint8Array) || master.length !== 32) throw new Error('Master secret must be 32 bytes');
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new Error('Invalid address index');
  const sp = new Sponge([0n, 0n]);
  sp.absorb(leU128(master, 0)); sp.absorb(leU128(master, 16)); sp.absorb(BigInt(index)); sp.absorb(DERIVE_TAG);
  return sp.finalize();
}
/** 32 public address bytes from a spend secret. */
export function addressBytes(secret) {
  const sp = new Sponge(IV_ADDRFIX); sp.update(secret); return sp.finalizeNoPad();
}

// ---- bech32m (BIP-350), HRP "o" ----
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l', GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3], BECH32M = 0x2bc830a3;
function polymod(values) { let c = 1; for (const v of values) { const top = c >>> 25; c = ((c & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((top >>> i) & 1) c ^= GEN[i]; } return c >>> 0; }
const hrpExpand = h => [...[...h].map(c => c.charCodeAt(0) >> 5), 0, ...[...h].map(c => c.charCodeAt(0) & 31)];
function convertBits(data, from, to, pad) { let acc = 0, bits = 0; const out = [], max = (1 << to) - 1; for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & max); } } if (pad && bits) out.push((acc << (to - bits)) & max); else if (!pad && (bits >= from || ((acc << (to - bits)) & max))) return null; return out; }
export function encodeAddress(bytes32) {
  const data = convertBits(bytes32, 8, 5, true), hrp = 'o';
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ BECH32M;
  const chk = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...data, ...chk].map(d => CHARSET[d]).join('');
}
/** Strict decode: lowercase o1… with a valid bech32m checksum and 32 bytes. Returns bytes or null. */
export function decodeAddress(s) {
  if (typeof s !== 'string' || s !== s.toLowerCase() || !s.startsWith('o1') || s.length > 90) return null;
  const data = [...s.slice(2)].map(c => CHARSET.indexOf(c)); if (data.some(d => d < 0) || data.length < 7) return null;
  if (polymod([...hrpExpand('o'), ...data]) !== BECH32M) return null;
  const b = convertBits(data.slice(0, -6), 5, 8, false); return b && b.length === 32 ? Uint8Array.from(b) : null;
}
/** Address string for derivation index i. */
export function deriveAddress(master, index) { const s = spendSecret(master, index); try { return encodeAddress(addressBytes(s)); } finally { s.fill(0); } }
/** Fresh 256-bit master secret from the operating system's CSPRNG (same source the official wallets use). */
export function newMaster() { const m = new Uint8Array(32); crypto.getRandomValues(m); return m; }
export const masterToHex = m => Array.from(m, b => b.toString(16).padStart(2, '0')).join('');
/** Accepts exactly 64 hex characters (whitespace ignored), the official backup format. */
export function hexToMaster(text) { const k = String(text ?? '').replace(/\s/g, ''); if (!/^[0-9a-fA-F]{64}$/.test(k)) throw new Error('Enter the 64-character master key'); return Uint8Array.from(k.match(/../g), h => parseInt(h, 16)); }

// ---- BLAKE3 (single-chunk inputs ≤ 1024 bytes; all this wallet needs) for the official Key ID ----
const B3_IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const B3_PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1, CHUNK_END = 2, ROOT = 8, DERIVE_KEY_CONTEXT = 32, DERIVE_KEY_MATERIAL = 64;
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
function b3compress(cv, block, counter, len, flags) {
  const v = [...cv, B3_IV[0], B3_IV[1], B3_IV[2], B3_IV[3], counter >>> 0, 0, len, flags];
  let m = block.slice();
  const g = (a, b, c, d, x, y) => { v[a] = (v[a] + v[b] + x) >>> 0; v[d] = rotr(v[d] ^ v[a], 16); v[c] = (v[c] + v[d]) >>> 0; v[b] = rotr(v[b] ^ v[c], 12); v[a] = (v[a] + v[b] + y) >>> 0; v[d] = rotr(v[d] ^ v[a], 8); v[c] = (v[c] + v[d]) >>> 0; v[b] = rotr(v[b] ^ v[c], 7); };
  for (let r = 0; r < 7; r++) {
    g(0, 4, 8, 12, m[0], m[1]); g(1, 5, 9, 13, m[2], m[3]); g(2, 6, 10, 14, m[4], m[5]); g(3, 7, 11, 15, m[6], m[7]);
    g(0, 5, 10, 15, m[8], m[9]); g(1, 6, 11, 12, m[10], m[11]); g(2, 7, 8, 13, m[12], m[13]); g(3, 4, 9, 14, m[14], m[15]);
    if (r < 6) m = B3_PERM.map(i => m[i]);
  }
  return Array.from({ length: 8 }, (_, i) => (v[i] ^ v[i + 8]) >>> 0);
}
function b3chunk(key, input, flags) {
  if (input.length > 1024) throw new Error('BLAKE3 helper supports one chunk');
  let cv = key.slice(); const blocks = Math.max(1, Math.ceil(input.length / 64));
  for (let b = 0; b < blocks; b++) {
    const part = input.subarray(b * 64, b * 64 + 64), buf = new Uint8Array(64); buf.set(part);
    const words = Array.from({ length: 16 }, (_, i) => buf[i * 4] | (buf[i * 4 + 1] << 8) | (buf[i * 4 + 2] << 16) | (buf[i * 4 + 3] << 24));
    cv = b3compress(cv, words, 0, part.length, flags | (b === 0 ? CHUNK_START : 0) | (b === blocks - 1 ? CHUNK_END | ROOT : 0));
    buf.fill(0);
  }
  return cv;
}
const wordsToBytes = w => { const o = new Uint8Array(32); w.forEach((x, i) => { o[i * 4] = x & 255; o[i * 4 + 1] = (x >>> 8) & 255; o[i * 4 + 2] = (x >>> 16) & 255; o[i * 4 + 3] = (x >>> 24) & 255; }); return o; };
export const blake3 = input => wordsToBytes(b3chunk(B3_IV, input, 0));
export function blake3DeriveKey(context, material) {
  const ctxKey = b3chunk(B3_IV, new TextEncoder().encode(context), DERIVE_KEY_CONTEXT);
  return wordsToBytes(b3chunk(ctxKey, material, DERIVE_KEY_MATERIAL));
}
/** Official short Key ID ("ParanO(1)d master secret fingerprint v1"): first 8 bytes, grouped xxxx·xxxx·xxxx·xxxx. */
export function keyId(master) {
  const d = blake3DeriveKey('ParanO(1)d master secret fingerprint v1', master), h = masterToHex(d.subarray(0, 8)); d.fill(0);
  return `${h.slice(0, 4)}·${h.slice(4, 8)}·${h.slice(8, 12)}·${h.slice(12, 16)}`;
}
