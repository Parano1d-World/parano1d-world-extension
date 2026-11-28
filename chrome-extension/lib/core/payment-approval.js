// Fail-closed payment approvals (audit 176): every confirmation step refuses when information is missing, instead of
// skipping itself. An approval carries exactly what the person reviewed (recipient, amount, a digest of the review
// screen) and where it was given; before anything is signed all of it must be present, non-empty, from a known
// source, and equal to the payment about to be signed. Otherwise nothing is signed.
export const SOURCES = Object.freeze(['page', 'extension']);
const filled = v => typeof v === 'string' && v.trim() !== '';
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

/** Digest of what the review screen showed. Missing recipient/amount/unit → null (nothing to approve). */
export async function reviewDigest({ to, amount, unit = 'NOID', fee = null, total = null }) {
  if (![to, amount, unit].every(filled)) return null;
  const canon = JSON.stringify(['parano1d-world/review/1', to, amount, unit, fee == null ? '' : String(fee), total == null ? '' : String(total)]);
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon)));
}

/** True only when the approval is complete, from a known source, and matches the payment exactly. */
export function approvalOk(approval, expected) {
  if (!approval || typeof approval !== 'object' || !expected || typeof expected !== 'object') return false;
  const { to, amount, digest, source } = approval;
  if (![to, amount, digest, source].every(filled) || ![expected.to, expected.amount, expected.digest].every(filled)) return false;
  if (!SOURCES.includes(source)) return false;
  return to === expected.to && amount === expected.amount && digest === expected.digest;
}
