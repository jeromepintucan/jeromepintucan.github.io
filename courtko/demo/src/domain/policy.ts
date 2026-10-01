/**
 * Cancellation, refund, reschedule and no-show policies (design docs 07 and 09). Policies are versioned;
 * each booking stores the exact version the player accepted, so later edits never change past terms.
 */

import { HOUR } from './time.ts';

export interface RefundTier {
  /** Applies when the cancellation happens at least this many hours before the start. */
  minHoursBefore: number;
  /** Share of the court booking base refunded (ppm). */
  refundPpm: number;
}

export interface CancellationPolicy {
  id: string;
  key: 'standard' | 'flexible' | 'strict' | 'non_refundable';
  name: string;
  version: number;
  effectiveFrom: string;
  tiers: RefundTier[]; // sorted by minHoursBefore descending
  gatewayFeeRefundableOnPlayerCancel: boolean;
  reschedule: { allowed: boolean; maxTimes: number; minHoursBefore: number };
  noShow: { graceMinutes: number; refundPpm: number };
}

export const POLICY_LIBRARY: Record<CancellationPolicy['key'], CancellationPolicy> = {
  standard: {
    id: 'pol_standard',
    key: 'standard',
    name: 'Standard',
    version: 3,
    effectiveFrom: '2026-07-01',
    tiers: [
      { minHoursBefore: 24, refundPpm: 1_000_000 },
      { minHoursBefore: 6, refundPpm: 500_000 },
      { minHoursBefore: 0, refundPpm: 0 },
    ],
    gatewayFeeRefundableOnPlayerCancel: false,
    reschedule: { allowed: true, maxTimes: 1, minHoursBefore: 12 },
    noShow: { graceMinutes: 15, refundPpm: 0 },
  },
  flexible: {
    id: 'pol_flexible',
    key: 'flexible',
    name: 'Flexible',
    version: 2,
    effectiveFrom: '2026-07-01',
    tiers: [
      { minHoursBefore: 2, refundPpm: 1_000_000 },
      { minHoursBefore: 0, refundPpm: 0 },
    ],
    gatewayFeeRefundableOnPlayerCancel: false,
    reschedule: { allowed: true, maxTimes: 2, minHoursBefore: 2 },
    noShow: { graceMinutes: 15, refundPpm: 0 },
  },
  strict: {
    id: 'pol_strict',
    key: 'strict',
    name: 'Strict',
    version: 2,
    effectiveFrom: '2026-07-01',
    tiers: [
      { minHoursBefore: 72, refundPpm: 1_000_000 },
      { minHoursBefore: 24, refundPpm: 500_000 },
      { minHoursBefore: 0, refundPpm: 0 },
    ],
    gatewayFeeRefundableOnPlayerCancel: false,
    reschedule: { allowed: true, maxTimes: 1, minHoursBefore: 24 },
    noShow: { graceMinutes: 15, refundPpm: 0 },
  },
  non_refundable: {
    id: 'pol_non_refundable',
    key: 'non_refundable',
    name: 'Non-refundable rate',
    version: 1,
    effectiveFrom: '2026-07-01',
    tiers: [{ minHoursBefore: 0, refundPpm: 0 }],
    gatewayFeeRefundableOnPlayerCancel: false,
    reschedule: { allowed: false, maxTimes: 0, minHoursBefore: 0 },
    noShow: { graceMinutes: 15, refundPpm: 0 },
  },
};

export type CancellationInitiator = 'player' | 'venue' | 'court_unavailable' | 'weather' | 'system';

export interface RefundDecision {
  /** Share of the court booking base returned to the player (ppm). */
  courtRefundPpm: number;
  /** Whether the customer-paid gateway fee is returned. */
  refundGatewayFee: boolean;
  /** Unclaimed add-ons are always refunded in full when the booking is cancelled. */
  refundUnclaimedAddOns: boolean;
  tierLabel: string;
  /** The quote is valid until the next tier boundary (or the start time). */
  validUntil: number;
  reason: string;
}

export function hoursLabel(h: number): string {
  return h === 1 ? '1 hour' : `${h} hours`;
}

export function evaluateCancellation(policy: CancellationPolicy, initiator: CancellationInitiator, now: number, startMs: number): RefundDecision {
  if (initiator !== 'player') {
    return {
      courtRefundPpm: 1_000_000,
      refundGatewayFee: true,
      refundUnclaimedAddOns: true,
      tierLabel: 'Full refund (venue or platform initiated)',
      validUntil: startMs,
      reason:
        initiator === 'weather'
          ? 'Cancelled due to weather'
          : initiator === 'court_unavailable'
            ? 'Court unavailable'
            : initiator === 'system'
              ? 'Booking could not be fulfilled'
              : 'Cancelled by the venue',
    };
  }
  const hoursBefore = (startMs - now) / HOUR;
  const tiers = [...policy.tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  let chosen = tiers[tiers.length - 1]!;
  let nextBoundary = startMs;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]!;
    if (hoursBefore >= t.minHoursBefore) {
      chosen = t;
      nextBoundary = startMs - t.minHoursBefore * HOUR;
      break;
    }
  }
  const pct = chosen.refundPpm / 10_000;
  const label =
    chosen.refundPpm === 1_000_000
      ? `Full refund (${hoursLabel(chosen.minHoursBefore)} or more before start)`
      : chosen.refundPpm === 0
        ? 'No refund at this point'
        : `${pct}% refund (${hoursLabel(chosen.minHoursBefore)} or more before start)`;
  return {
    courtRefundPpm: chosen.refundPpm,
    refundGatewayFee: policy.gatewayFeeRefundableOnPlayerCancel,
    refundUnclaimedAddOns: true,
    tierLabel: label,
    validUntil: Math.max(now, nextBoundary),
    reason: 'Cancelled by player',
  };
}

export function describePolicy(policy: CancellationPolicy): string[] {
  const tiers = [...policy.tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  const lines: string[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]!;
    const upper = i > 0 ? tiers[i - 1]!.minHoursBefore : null;
    const pct = t.refundPpm / 10_000;
    const range = upper === null ? `${hoursLabel(t.minHoursBefore)} or more before start` : t.minHoursBefore === 0 ? `Less than ${hoursLabel(upper)} before start` : `${t.minHoursBefore}–${upper} hours before start`;
    lines.push(`${range}: ${pct === 100 ? 'full refund' : pct === 0 ? 'no refund' : `${pct}% refund`} of the court price.`);
  }
  lines.push(policy.gatewayFeeRefundableOnPlayerCancel ? 'Payment processing fees are refunded.' : 'Payment processing fees are non-refundable when you cancel.');
  lines.push('If the venue cancels or the court becomes unavailable, you get a full refund including fees.');
  lines.push(
    policy.reschedule.allowed
      ? `You can reschedule ${policy.reschedule.maxTimes === 1 ? 'once' : `up to ${policy.reschedule.maxTimes} times`}, at least ${hoursLabel(policy.reschedule.minHoursBefore)} before start, subject to availability.`
      : 'Rescheduling is not available for this rate.',
  );
  lines.push(`No-shows: not refunded. Staff may mark a no-show ${policy.noShow.graceMinutes} minutes after the start time.`);
  return lines;
}

export function canReschedule(policy: CancellationPolicy, now: number, startMs: number, timesRescheduled: number): { ok: boolean; reason?: string } {
  if (!policy.reschedule.allowed) return { ok: false, reason: 'Rescheduling is not available for this rate.' };
  if (timesRescheduled >= policy.reschedule.maxTimes) return { ok: false, reason: 'You have used your reschedule allowance for this booking.' };
  if (startMs - now < policy.reschedule.minHoursBefore * HOUR)
    return { ok: false, reason: `Rescheduling closes ${hoursLabel(policy.reschedule.minHoursBefore)} before start.` };
  return { ok: true };
}
