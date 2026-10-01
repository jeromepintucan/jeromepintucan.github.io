/**
 * TOTP (RFC 6238, HMAC-SHA1, 30-second steps, 6 digits) — compatible with Google Authenticator,
 * Microsoft Authenticator, 1Password and similar apps. Recovery codes are stored hashed.
 */

import { fromBase32, hmacSha1, randomBytes, sha256Hex, toBase32 } from './crypto.ts';
import { randomCode } from './ids.ts';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function newTotpSecret(): string {
  return toBase32(randomBytes(20));
}

export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const mac = hmacSha1(secret, msg);
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) | ((mac[offset + 1]! & 0xff) << 16) | ((mac[offset + 2]! & 0xff) << 8) | (mac[offset + 3]! & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpAt(secretBase32: string, epochMs: number, digits = TOTP_DIGITS): string {
  return hotp(fromBase32(secretBase32), Math.floor(epochMs / 1000 / TOTP_STEP_SECONDS), digits);
}

/** Accepts the current step ±1 to tolerate clock drift; returns the matched step or null. */
export function verifyTotp(secretBase32: string, code: string, epochMs: number, lastUsedStep = -1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = fromBase32(secretBase32);
  const step = Math.floor(epochMs / 1000 / TOTP_STEP_SECONDS);
  for (const s of [step, step - 1, step + 1]) {
    if (s <= lastUsedStep) continue; // prevents replay of an already-used code
    if (hotp(secret, s) === code) return s;
  }
  return null;
}

export function secondsRemaining(epochMs: number): number {
  return TOTP_STEP_SECONDS - (Math.floor(epochMs / 1000) % TOTP_STEP_SECONDS);
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'CourtKo'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function newRecoveryCodes(count = 8): { codes: string[]; digests: string[] } {
  const codes = Array.from({ length: count }, () => `${randomCode(4)}-${randomCode(4)}`);
  return { codes, digests: codes.map((c) => sha256Hex(c)) };
}
