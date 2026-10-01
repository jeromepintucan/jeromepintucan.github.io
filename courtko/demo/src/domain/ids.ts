/**
 * Identifiers and human-facing codes.
 * - Entity IDs: `<prefix>_<16 Crockford base32 chars>` (production uses UUIDv7; the demo keeps IDs readable).
 * - Booking codes `CK-XXXXXX`, pickup codes `PU-XXXXXX`, support tickets `SUP-####` (doc 05 glossary).
 *   Code alphabet excludes I, L, O and U to avoid misreading at the front desk.
 */

import { randomBytes } from './crypto.ts';

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type Rng = () => number; // returns [0, 1)

/** Deterministic PRNG for synthetic data generation (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomIndex(rng: Rng | undefined, n: number): number {
  if (rng) return Math.floor(rng() * n);
  const b = randomBytes(1)[0]!;
  return b % n; // n divides 256 for our 32-char alphabet → unbiased
}

export function randomCode(length: number, rng?: Rng): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomIndex(rng, CODE_ALPHABET.length)];
  return out;
}

export function newId(prefix: string, rng?: Rng): string {
  return `${prefix}_${randomCode(16, rng).toLowerCase()}`;
}

export function bookingCode(rng?: Rng): string {
  return `CK-${randomCode(6, rng)}`;
}

export function pickupCode(rng?: Rng): string {
  return `PU-${randomCode(6, rng)}`;
}

export function correlationId(): string {
  return `cor_${randomCode(12).toLowerCase()}`;
}

export function idempotencyKey(): string {
  return `idem_${randomCode(20).toLowerCase()}`;
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Normalizes a code typed at the front desk: uppercases, removes spaces, maps look-alikes. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/^CK(?=[0-9A-Z]{6}$)/, 'CK-')
    .replace(/^PU(?=[0-9A-Z]{6}$)/, 'PU-');
}
