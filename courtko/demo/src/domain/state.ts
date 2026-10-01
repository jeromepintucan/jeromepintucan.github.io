/**
 * State machines (design docs 07, 08, 09). Every status change in the services goes through
 * `transition()`, which rejects anything not listed here.
 */

import { AppError } from './errors.ts';

export type BookingStatus =
  | 'draft'
  | 'slot_held'
  | 'payment_pending'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'refund_pending'
  | 'partially_refunded'
  | 'refunded'
  | 'no_show'
  | 'disputed'
  | 'failed'
  | 'expired';

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'partially_refunded'
  | 'refunded'
  | 'disputed'
  | 'chargeback';

export type RefundStatus = 'requested' | 'pending_approval' | 'approved' | 'processing' | 'succeeded' | 'failed' | 'rejected';
export type PayoutStatus = 'scheduled' | 'processing' | 'paid' | 'failed' | 'reversed';
export type DisputeStatus = 'open' | 'evidence_submitted' | 'won' | 'lost';
export type OrderStatus = 'pending_payment' | 'paid' | 'preparing' | 'ready_for_pickup' | 'claimed' | 'cancelled' | 'refunded' | 'partially_refunded';
export type RegistrationStatus = 'held' | 'pending_payment' | 'confirmed' | 'waitlisted' | 'offered' | 'checked_in' | 'withdrawn' | 'cancelled' | 'refunded';
export type BusinessStatus = 'draft' | 'pending_verification' | 'active' | 'rejected' | 'suspended';
export type VenueStatus = 'draft' | 'published' | 'unpublished' | 'suspended';
export type CheckoutStatus = 'open' | 'payment_pending' | 'completed' | 'expired' | 'cancelled' | 'failed';

type Machine<S extends string> = Record<S, readonly S[]>;

export const BOOKING_TRANSITIONS: Machine<BookingStatus> = {
  draft: ['slot_held', 'failed'],
  slot_held: ['payment_pending', 'cancelled', 'expired'],
  // payment_pending → cancelled: the venue blocked the court and released the hold mid-checkout.
  payment_pending: ['slot_held', 'confirmed', 'expired', 'failed', 'refund_pending', 'cancelled'],
  // expired/cancelled → confirmed|refund_pending only when the provider reports a LATE capture (doc 07).
  expired: ['confirmed', 'refund_pending'],
  confirmed: ['confirmed', 'checked_in', 'completed', 'no_show', 'cancelled', 'refund_pending', 'disputed'],
  checked_in: ['completed', 'disputed'],
  completed: ['refund_pending', 'disputed'],
  no_show: ['refund_pending'],
  refund_pending: ['refunded', 'partially_refunded', 'refund_pending'],
  partially_refunded: ['refund_pending', 'disputed'],
  disputed: ['completed', 'confirmed', 'refunded'],
  cancelled: ['refund_pending'],
  refunded: [],
  failed: [],
};

export const PAYMENT_TRANSITIONS: Machine<PaymentStatus> = {
  created: ['pending', 'failed', 'cancelled'],
  pending: ['authorized', 'captured', 'failed', 'expired', 'cancelled'],
  authorized: ['captured', 'cancelled', 'expired'],
  captured: ['partially_refunded', 'refunded', 'disputed'],
  partially_refunded: ['partially_refunded', 'refunded', 'disputed'],
  disputed: ['captured', 'chargeback', 'partially_refunded', 'refunded'],
  // The provider is authoritative: a capture reported after local expiry/cancellation/failure is recorded
  // (and then refunded or recovered), never ignored.
  failed: ['captured'],
  expired: ['captured'],
  cancelled: ['captured'],
  refunded: [],
  chargeback: [],
};

export const REFUND_TRANSITIONS: Machine<RefundStatus> = {
  requested: ['pending_approval', 'approved', 'rejected'],
  pending_approval: ['approved', 'rejected'],
  approved: ['processing'],
  processing: ['succeeded', 'failed'],
  failed: ['processing', 'rejected'],
  succeeded: [],
  rejected: [],
};

export const PAYOUT_TRANSITIONS: Machine<PayoutStatus> = {
  scheduled: ['processing'],
  processing: ['paid', 'failed'],
  failed: ['scheduled'],
  paid: ['reversed'],
  reversed: [],
};

export const DISPUTE_TRANSITIONS: Machine<DisputeStatus> = {
  open: ['evidence_submitted', 'won', 'lost'],
  evidence_submitted: ['won', 'lost'],
  won: [],
  lost: [],
};

export const ORDER_TRANSITIONS: Machine<OrderStatus> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['preparing', 'ready_for_pickup', 'cancelled', 'refunded', 'partially_refunded'],
  preparing: ['ready_for_pickup', 'cancelled', 'refunded'],
  ready_for_pickup: ['claimed', 'cancelled', 'refunded'],
  claimed: ['refunded', 'partially_refunded'],
  partially_refunded: ['refunded'],
  cancelled: ['refunded'],
  refunded: [],
};

export const REGISTRATION_TRANSITIONS: Machine<RegistrationStatus> = {
  held: ['pending_payment', 'confirmed', 'cancelled'],
  pending_payment: ['held', 'confirmed', 'cancelled'],
  waitlisted: ['offered', 'withdrawn', 'cancelled'],
  offered: ['held', 'cancelled', 'withdrawn'],
  confirmed: ['checked_in', 'withdrawn', 'cancelled', 'refunded'],
  checked_in: ['refunded'],
  withdrawn: ['refunded'],
  cancelled: ['refunded'],
  refunded: [],
};

export const BUSINESS_TRANSITIONS: Machine<BusinessStatus> = {
  draft: ['pending_verification'],
  pending_verification: ['active', 'rejected', 'draft'],
  active: ['suspended'],
  suspended: ['active'],
  rejected: ['draft'],
};

export const VENUE_TRANSITIONS: Machine<VenueStatus> = {
  draft: ['published'],
  published: ['unpublished', 'suspended'],
  unpublished: ['published', 'suspended'],
  suspended: ['unpublished'],
};

export const CHECKOUT_TRANSITIONS: Machine<CheckoutStatus> = {
  open: ['payment_pending', 'expired', 'cancelled', 'failed'],
  payment_pending: ['open', 'completed', 'expired', 'failed', 'cancelled'],
  expired: ['completed', 'failed'],
  cancelled: ['failed'],
  completed: [],
  failed: [],
};

export interface StatusChange<S extends string> {
  from: S;
  to: S;
  at: number;
  by: string;
  reason?: string;
}

export function canTransition<S extends string>(machine: Machine<S>, from: S, to: S): boolean {
  return (machine[from] as readonly S[]).includes(to);
}

/** Applies a validated transition and appends the change to `history`. */
export function transition<S extends string, T extends { status: S; history?: StatusChange<S>[] }>(
  machine: Machine<S>,
  entity: T,
  to: S,
  at: number,
  by: string,
  reason?: string,
  entityLabel = 'record',
): T {
  const from = entity.status;
  if (!canTransition(machine, from, to)) {
    throw new AppError('INVALID_STATE_TRANSITION', `This ${entityLabel} can't move from "${from.replace(/_/g, ' ')}" to "${to.replace(/_/g, ' ')}".`, {
      meta: { from, to },
    });
  }
  entity.status = to;
  entity.history = [...(entity.history ?? []), { from, to, at, by, ...(reason ? { reason } : {}) }];
  return entity;
}

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  draft: 'Draft',
  slot_held: 'Slot held',
  payment_pending: 'Payment pending',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refund_pending: 'Refund pending',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  no_show: 'No-show',
  disputed: 'Disputed',
  failed: 'Failed',
  expired: 'Expired',
};

export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['confirmed', 'checked_in'];
export const UPCOMING_BOOKING_STATUSES: BookingStatus[] = ['confirmed', 'checked_in', 'slot_held', 'payment_pending'];
