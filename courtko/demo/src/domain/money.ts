/**
 * Money primitives. Every amount is an integer number of centavos (PHP minor units).
 * Rates are integer parts-per-million (ppm): 5% = 50_000 ppm.
 * Multiplication/division uses BigInt so intermediate products never lose precision.
 * Portable to the production `packages/domain` without changes.
 */

export type Centavos = number;
export type Ppm = number;
export type Rounding = 'half_up' | 'half_even' | 'floor' | 'ceil';

export const CURRENCY = 'PHP';
export const PPM_SCALE = 1_000_000;

export function assertCentavos(value: number, label = 'amount'): Centavos {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of centavos (got ${value})`);
  }
  return value;
}

export function assertNonNegative(value: number, label = 'amount'): Centavos {
  assertCentavos(value, label);
  if (value < 0) throw new RangeError(`${label} must not be negative (got ${value})`);
  return value;
}

/** Convenience for configuration and synthetic data only: pesos(400) === 40_000. */
export function pesos(amount: number): Centavos {
  return Math.round(amount * 100);
}

/** Integer division of BigInts with an explicit rounding mode (non-negative numerators and positive denominators). */
export function divRound(numerator: bigint, denominator: bigint, mode: Rounding = 'half_up'): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  if (numerator < 0n) {
    // Symmetric rounding for negatives (used for signed adjustments).
    const flipped = mode === 'floor' ? 'ceil' : mode === 'ceil' ? 'floor' : mode;
    return -divRound(-numerator, denominator, flipped);
  }
  const q = numerator / denominator;
  const r = numerator % denominator;
  if (r === 0n) return q;
  switch (mode) {
    case 'floor':
      return q;
    case 'ceil':
      return q + 1n;
    case 'half_up':
      return r * 2n >= denominator ? q + 1n : q;
    case 'half_even': {
      const twice = r * 2n;
      if (twice > denominator) return q + 1n;
      if (twice < denominator) return q;
      return q % 2n === 0n ? q : q + 1n;
    }
  }
}

/** amount × rate (ppm) with rounding, e.g. commission = applyRate(40_000, 50_000) === 2_000. */
export function applyRate(amount: Centavos, ratePpm: Ppm, mode: Rounding = 'half_up'): Centavos {
  assertCentavos(amount);
  if (!Number.isSafeInteger(ratePpm) || ratePpm < 0 || ratePpm > PPM_SCALE) {
    throw new RangeError(`rate must be an integer ppm between 0 and ${PPM_SCALE} (got ${ratePpm})`);
  }
  return Number(divRound(BigInt(amount) * BigInt(ratePpm), BigInt(PPM_SCALE), mode));
}

/** Pro-rates an amount by minutes: rate per hour × minutes / 60, exact then rounded once. */
export function proRateByMinutes(ratePerHour: Centavos, minutes: number, mode: Rounding = 'half_up'): Centavos {
  return Number(divRound(BigInt(ratePerHour) * BigInt(minutes), 60n, mode));
}

/** Sum of integer centavo values with overflow protection. */
export function sum(values: readonly Centavos[]): Centavos {
  let total = 0;
  for (const v of values) total = assertCentavos(total + assertCentavos(v));
  return total;
}

/**
 * Splits `total` across `weights` using the largest-remainder method so parts always add back to `total`.
 * Ties are broken by lower index to keep results deterministic.
 */
export function allocate(total: Centavos, weights: readonly number[]): Centavos[] {
  assertNonNegative(total, 'total');
  if (weights.length === 0) return [];
  const w = weights.map((x) => BigInt(Math.max(0, Math.round(x))));
  const weightSum = w.reduce((a, b) => a + b, 0n);
  if (weightSum === 0n) {
    const parts = weights.map(() => 0);
    parts[0] = total;
    return parts;
  }
  const big = BigInt(total);
  const base = w.map((x) => (big * x) / weightSum);
  const remainders = w.map((x, i) => ({ i, r: (big * x) % weightSum }));
  let leftover = Number(big - base.reduce((a, b) => a + b, 0n));
  remainders.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  const out = base.map((x) => Number(x));
  for (let k = 0; k < remainders.length && leftover > 0; k++, leftover--) out[remainders[k]!.i]! += 1;
  return out;
}

/**
 * Gross-up so that a percentage + fixed provider fee charged on the TOTAL leaves exactly `net`.
 * total = ceil((net + fixed) / (1 - pct)); fee = total - net.
 */
export function grossUpFee(net: Centavos, percentPpm: Ppm, fixed: Centavos): Centavos {
  assertNonNegative(net, 'net');
  assertNonNegative(fixed, 'fixed fee');
  if (percentPpm < 0 || percentPpm >= PPM_SCALE) throw new RangeError('fee percentage out of range');
  let total = Number(divRound(BigInt(net + fixed) * BigInt(PPM_SCALE), BigInt(PPM_SCALE - percentPpm), 'ceil'));
  // The provider rounds its fee half-up, so the ceiling can overshoot by a centavo; take the smallest sufficient total.
  while (total - 1 - net > 0 && total - 1 - providerFeeOn(total - 1, percentPpm, fixed) >= net) total -= 1;
  return total - net;
}

/** Fee a provider would charge on `amount` for a percentage + fixed schedule (half-up). */
export function providerFeeOn(amount: Centavos, percentPpm: Ppm, fixed: Centavos): Centavos {
  return applyRate(amount, percentPpm) + fixed;
}

/** VAT contained in a VAT-inclusive amount: amount × rate / (1 + rate). */
export function includedTax(amountInclusive: Centavos, ratePpm: Ppm): Centavos {
  return Number(divRound(BigInt(amountInclusive) * BigInt(ratePpm), BigInt(PPM_SCALE + ratePpm), 'half_up'));
}

const pesoFormatter = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const pesoCompact = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });

/** "₱415.00". Display only — never parse the output back into money. */
export function formatPHP(amount: Centavos, opts: { compact?: boolean; signed?: boolean } = {}): string {
  const abs = Math.abs(amount) / 100;
  const text = opts.compact && Math.abs(amount) % 100 === 0 ? pesoCompact.format(abs) : pesoFormatter.format(abs);
  if (amount < 0) return `−${text}`;
  if (opts.signed && amount > 0) return `+${text}`;
  return text;
}

/** 50_000 → "5%", 47_500 → "4.75%", 1_250 → "0.125%". */
export function formatPpm(ratePpm: Ppm): string {
  return `${parseFloat((ratePpm / 10_000).toFixed(4))}%`;
}

/** "5" / "4.75" (percent) → ppm; returns null if out of range. */
export function parsePercentInput(text: string): Ppm | null {
  const cleaned = text.replace(/[%\s]/g, '');
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(cleaned)) return null;
  const ppm = Math.round(Number(cleaned) * 10_000);
  return ppm >= 0 && ppm <= PPM_SCALE ? ppm : null;
}

/** Parses a peso amount typed by a user ("1,250.50") into centavos; returns null if invalid. */
export function parsePesoInput(text: string): Centavos | null {
  const cleaned = text.replace(/[₱,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}
