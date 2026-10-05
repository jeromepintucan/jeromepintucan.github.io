/**
 * Signed, time-limited Open Play check-in tokens (doc 24 CR-D08).
 *
 *   OP1.<kid>.<ref>.<exp36>.<sig>   — live pass in the player app; rotates every 10 minutes
 *   REG1.<kid>.<ref>.<exp36>.<sig>  — registration QR (confirmation/receipt); valid until the late-arrival cutoff
 *
 * - `ref` is a random-looking per-registration reference derived with HMAC from the registration id and a
 *   random nonce. It is NOT the user id or registration id, and is never stored — only its SHA-256 is.
 * - `sig` binds the token to the session id and expiry, so a token can't be replayed for another session or
 *   extended. Verification always happens on the server; the token carries no personal information.
 * - `kid` identifies the signing key so keys can rotate (production: AWS KMS / Secrets Manager).
 */

import { hmacSha256, sha256Hex, timingSafeEqual, toBase64Url, toHex } from './crypto.ts';

/** PLACEHOLDER keys for the demo. Production keys live in a secrets manager and rotate. */
const KEYS: Record<string, string> = {
  k1: 'demo-openplay-checkin-key-k1-rotate-in-production',
};
export const CURRENT_KID = 'k1';
export const LIVE_TOKEN_TTL_MS = 10 * 60_000;

export type CheckinTokenKind = 'OP1' | 'REG1';

export function checkinRef(registrationId: string, nonce: string, kid = CURRENT_KID): string {
  return toBase64Url(hmacSha256(KEYS[kid]!, `ref:${registrationId}:${nonce}`)).slice(0, 22);
}

export function checkinRefHash(ref: string): string {
  return sha256Hex(`checkin-ref:${ref}`);
}

function sign(kind: CheckinTokenKind, kid: string, ref: string, exp: number, sessionId: string): string {
  return toHex(hmacSha256(KEYS[kid]!, `${kind}|${kid}|${ref}|${exp}|${sessionId}`)).slice(0, 32);
}

/** Live pass: expiry snaps to the current 10-minute window so the QR is stable within a window. */
export function issueLiveToken(ref: string, sessionId: string, now: number, notAfter: number): { token: string; expiresAt: number } {
  const windowEnd = (Math.floor(now / LIVE_TOKEN_TTL_MS) + 1) * LIVE_TOKEN_TTL_MS;
  const exp = Math.min(windowEnd, Math.max(now + 60_000, notAfter));
  return { token: `OP1.${CURRENT_KID}.${ref}.${exp.toString(36)}.${sign('OP1', CURRENT_KID, ref, exp, sessionId)}`, expiresAt: exp };
}

export function issueRegistrationToken(ref: string, sessionId: string, lateCutoffAt: number): string {
  return `REG1.${CURRENT_KID}.${ref}.${lateCutoffAt.toString(36)}.${sign('REG1', CURRENT_KID, ref, lateCutoffAt, sessionId)}`;
}

export interface ParsedCheckinToken {
  kind: CheckinTokenKind;
  kid: string;
  ref: string;
  exp: number;
  sig: string;
}

export function parseCheckinToken(raw: string): ParsedCheckinToken | null {
  const m = /^(OP1|REG1)\.([a-z0-9]{1,8})\.([A-Za-z0-9_-]{22})\.([0-9a-z]{6,12})\.([0-9a-f]{32})$/.exec(raw.trim());
  if (!m) return null;
  const exp = parseInt(m[4]!, 36);
  if (!Number.isFinite(exp)) return null;
  return { kind: m[1] as CheckinTokenKind, kid: m[2]!, ref: m[3]!, exp, sig: m[5]! };
}

export function verifyCheckinSignature(t: ParsedCheckinToken, sessionId: string): boolean {
  if (!KEYS[t.kid]) return false;
  return timingSafeEqual(sign(t.kind, t.kid, t.ref, t.exp, sessionId), t.sig);
}
