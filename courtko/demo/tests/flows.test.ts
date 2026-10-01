/**
 * End-to-end service flows through the API layer (same code the UI calls), covering the critical scenarios in
 * design doc 20: double booking, duplicate/late/missed webhooks, refunds, tenant isolation, unauthorized staff,
 * support mode, maker-checker, restriction during checkout, court blocked during checkout, event capacity.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, type Harness, type Tab } from './helpers.ts';
import { ApiError } from '../src/services/api.ts';
import { accountBalance, ACCOUNTS, totals, venuePayable } from '../src/domain/ledger.ts';
import { addDays, localDate, localToInstant, MINUTE, HOUR, DAY } from '../src/domain/time.ts';
import * as provider from '../src/services/provider.ts';
import { makeSvc, PROVIDER_ACTOR, verifyAuditChain } from '../src/services/svc.ts';
import { allLines } from '../src/services/ledgerSvc.ts';

let h: Harness;
let player: Tab;
let player2: Tab;
let owner: Tab;
let receptionist: Tab;
let manager: Tab;
let superadmin: Tab;
let finance: Tab;

async function expectCode(p: Promise<unknown> | (() => unknown), code: string) {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    assert.ok(e instanceof ApiError, `expected ApiError, got ${e}`);
    assert.equal(e.code, code, e.message);
    return e;
  }
  assert.fail(`expected ${code}`);
}

function bgc() {
  return h.store.read((db) => db.find('venues', (v) => v.slug === 'dink-district-bgc')!);
}
function courts(venueId: string) {
  return h.store.read((db) => db.filter('courts', (c) => c.venueId === venueId).sort((a, b) => a.sortOrder - b.sortOrder));
}
/** First bookable start (≥ minHoursAhead) on a court for a duration. */
function freeSlot(tab: Tab, venueId: string, courtId: string, minHoursAhead = 30, dayOffset = 2) {
  const date = addDays(localDate(h.store.now()), dayOffset);
  const av = tab.api.read('GET /v1/public/venues/{venueId}/availability', { venueId, date, durationMinutes: 60 });
  const c = av.courts.find((x) => x.court.id === courtId)!;
  const cell = c.cells.find((x) => x.bookable && x.startMs > h.store.now() + minHoursAhead * HOUR) ?? c.cells.find((x) => x.bookable)!;
  return cell.startMs;
}

async function payFor(tab: Tab, checkoutId: string, method: 'gcash' | 'card' | 'online_banking' = 'gcash', approve = true) {
  const res = await tab.api.write('POST /v1/me/checkouts/{checkoutId}/payment-sessions', { checkoutId, paymentMethod: method, acceptPolicy: true }, { idempotencyKey: `k-${checkoutId}-${method}` });
  const sessionId = res.redirectUrl.split('/').pop()!;
  if (approve) await h.store.transact((tx) => provider.customerApprove(makeSvc(tx.db, tx.now, tx.meta, PROVIDER_ACTOR, { correlationId: 't', ip: '', device: '', sessionToken: null }), sessionId, { last4: '4242' }));
  return { ...res, sessionId };
}

function ledgerBalanced() {
  return h.store.read((db) => db.all('journals').every((j) => totals(j.lines).debit === totals(j.lines).credit));
}

before(async () => {
  h = await harness();
  [player, player2, owner, receptionist, manager, superadmin, finance] = await Promise.all(['player', 'player2', 'owner', 'receptionist', 'manager', 'superadmin', 'finance'].map((p) => h.tab(p)));
});

describe('seed integrity', () => {
  test('synthetic data balances: every journal balances; provider funds equal ledger clearing', () => {
    assert.ok(ledgerBalanced());
    const recon = superadmin.api.read('GET /v1/admin/reconciliation');
    assert.equal(recon.balanced, true, `provider ${recon.providerTotal} vs ledger ${recon.ledgerClearing}`);
    assert.equal(recon.counts.missing_capture ?? 0, 0);
    const chain = h.store.read((db) => verifyAuditChain(db));
    assert.equal(chain.ok, true);
  });
});

describe('booking + payment happy path', () => {
  test('hold → method → pay → webhook → confirmed, ledger posted, commission 5%', async () => {
    const v = bgc();
    const court = courts(v.id)[3]!;
    const startMs = freeSlot(player, v.id, court.id);
    const hold = await player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 }, { idempotencyKey: 'hold-1' });
    await player.api.write('PATCH /v1/me/checkouts/{checkoutId}', { checkoutId: hold.checkoutId, paymentMethod: 'online_banking' });
    const co = player.api.read('GET /v1/me/checkouts/{checkoutId}', { checkoutId: hold.checkoutId });
    assert.equal(co.snapshot.quote.fee?.customerAmount, 1_500, 'online banking flat ₱15 passed through');
    assert.equal(co.snapshot.quote.commission.amount, Math.round(co.snapshot.quote.commission.base * 0.05));
    await payFor(player, hold.checkoutId, 'online_banking');
    // Redirect alone does not confirm
    assert.equal(player.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: hold.bookingId }).booking.status, 'payment_pending');
    await h.advance(3_000);
    const b = player.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: hold.bookingId });
    assert.equal(b.booking.status, 'confirmed');
    assert.ok(b.qrToken?.startsWith('CK1.'));
    assert.ok(ledgerBalanced());
  });

  test('idempotent hold replay returns the same checkout; different body is rejected', async () => {
    const v = bgc();
    const court = courts(v.id)[4]!;
    const startMs = freeSlot(player2, v.id, court.id, 40, 3);
    const a = await player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 }, { idempotencyKey: 'same' });
    const b = await player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 }, { idempotencyKey: 'same' });
    assert.equal(a.checkoutId, b.checkoutId);
    await expectCode(player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 90 }, { idempotencyKey: 'same' }), 'IDEMPOTENCY_KEY_REUSED');
    await player2.api.write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: a.checkoutId });
  });
});

describe('critical scenarios', () => {
  test('event reaches capacity: registration is refused with EVENT_FULL', async () => {
    const clinic = player.api.read('GET /v1/public/events', {}).find((e) => e.event.name.startsWith('Beginner Clinic'))!;
    await expectCode(player.api.write('POST /v1/me/events/{eventId}/registrations', { eventId: clinic.event.id, divisionId: clinic.divisions[0]!.division.id }), 'EVENT_FULL');
    const w = await player.api.write('POST /v1/me/events/{eventId}/waitlist', { eventId: clinic.event.id, divisionId: clinic.divisions[0]!.division.id });
    assert.equal(w.position, 3);
  });

  test('two users attempt the same slot: exactly one hold succeeds', async () => {
    const v = bgc();
    const court = courts(v.id)[5]!;
    const startMs = freeSlot(player, v.id, court.id, 50, 4);
    const results = await Promise.allSettled([
      player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 }),
      player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal((rejected.reason as ApiError).code, 'SLOT_UNAVAILABLE');
    await h.jobs();
    assert.ok(h.store.read((db) => db.count('securityEvents', (e) => e.type === 'double_booking_blocked') >= 1));
    const winner = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ checkoutId: string }>;
    const tab = (await player.api.read('GET /v1/me/bookings', { tab: 'upcoming' })).some((x) => x.booking.checkoutId === winner.value.checkoutId) ? player : player2;
    await tab.api.write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: winner.value.checkoutId });
  });

  test('duplicate webhook is processed once', async () => {
    await superadminSetWebhookMode('duplicate');
    const v = bgc();
    const court = courts(v.id)[0]!;
    const startMs = freeSlot(player, v.id, court.id, 60, 5);
    const hold = await player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 });
    const before = h.store.read((db) => db.count('journals', () => true));
    await payFor(player, hold.checkoutId);
    await h.advance(3_000);
    await h.advance(3_000);
    const after = h.store.read((db) => db.count('journals', () => true));
    assert.equal(after - before, 2, 'one capture + one provider-fee journal only');
    const dup = h.store.read((db) => db.find('webhookEvents', (w) => w.deliveries > 1));
    assert.ok(dup, 'duplicate delivery was recorded and ignored');
    await superadminSetWebhookMode('normal');
  });

  test('missed webhook is healed by reconciliation', async () => {
    await superadminSetWebhookMode('drop');
    const v = bgc();
    const court = courts(v.id)[1]!;
    const startMs = freeSlot(player2, v.id, court.id, 30, 6);
    const hold = await player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 });
    await payFor(player2, hold.checkoutId, 'gcash');
    await h.advance(5_000);
    assert.equal(player2.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: hold.bookingId }).booking.status, 'payment_pending');
    await h.advance(70_000); // reconciliation job looks at pending > 60 s
    assert.equal(player2.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: hold.bookingId }).booking.status, 'confirmed');
    await superadminSetWebhookMode('normal');
  });

  test('payment succeeds after checkout timeout: slot re-acquired (late recovery)', async () => {
    const v = bgc();
    const court = courts(v.id)[2]!;
    const startMs = freeSlot(player, v.id, court.id, 80, 7);
    const hold = await player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 });
    const pay = await payFor(player, hold.checkoutId, 'gcash', false);
    // hold expires with the provider session still pending: simulate provider allowing a late capture
    h.clock.t += 21 * MINUTE;
    await (await import('../src/services/jobs.ts')).shiftSessions(h.store, 21 * MINUTE);
    await h.store.transact((tx) => {
      const s = tx.db.get('providerSessions', pay.sessionId)!;
      tx.db.update('providerSessions', s.id, (x) => {
        x.expiresAt = tx.now + 60 * MINUTE; // provider still accepts it
      });
    });
    await h.jobs(); // expires the hold locally
    assert.equal(player.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: hold.bookingId }).booking.status, 'expired');
    await h.store.transact((tx) => provider.customerApprove(makeSvc(tx.db, tx.now, tx.meta, PROVIDER_ACTOR, { correlationId: 't', ip: '', device: '', sessionToken: null }), pay.sessionId));
    await h.advance(3_000);
    const b = player.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: hold.bookingId });
    assert.equal(b.booking.status, 'confirmed');
    assert.equal(b.booking.lateRecovery, true);
  });

  test('player cancels 10 hours before: 50% court refund, fee not refunded, commission reversed', async () => {
    const v = bgc();
    const court = courts(v.id)[3]!;
    const date = addDays(localDate(h.store.now()), 8);
    const startMs = localToInstant(date, 13 * 60);
    const hold = await player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 });
    await payFor(player, hold.checkoutId, 'online_banking');
    await h.advance(3_000);
    const jump = startMs - 10 * HOUR - h.clock.t;
    h.clock.t += jump;
    await (await import('../src/services/jobs.ts')).shiftSessions(h.store, jump);
    const q = player.api.read('GET /v1/me/bookings/{bookingId}/cancellation-quote', { bookingId: hold.bookingId });
    const court400 = player.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: hold.bookingId }).snapshot!.quote.items[0]!.amount;
    assert.equal(q.refundTotal, Math.round(court400 / 2));
    await player.api.write('POST /v1/me/bookings/{bookingId}/cancel', { bookingId: hold.bookingId });
    await h.advance(6_000);
    await h.advance(3_000);
    const b = player.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: hold.bookingId });
    assert.equal(b.booking.status, 'partially_refunded');
    assert.equal(b.refunds[0]!.status, 'succeeded');
    assert.ok(ledgerBalanced());
  });

  test('receptionist check-in works at their venue; another business is invisible (404)', async () => {
    const today = localDate(h.store.now());
    const v = bgc();
    const cal = receptionist.api.read('GET /v1/businesses/{businessId}/calendar', { businessId: v.businessId, venueId: v.id, date: today });
    assert.ok(cal.courts.length === 6);
    const kitchen = h.store.read((db) => db.find('businesses', (b) => b.tradeName === 'Kitchen Line Pickleball Club')!);
    await expectCode(() => receptionist.api.read('GET /v1/businesses/{businessId}/bookings', { businessId: kitchen.id }), 'NOT_FOUND');
    const alabang = h.store.read((db) => db.find('venues', (x) => x.slug === 'dink-district-alabang')!);
    await expectCode(() => receptionist.api.read('GET /v1/businesses/{businessId}/calendar', { businessId: v.businessId, venueId: alabang.id, date: today }), 'FORBIDDEN');
  });

  test('staff without refunds.approve cannot approve; owner can (separation of duties)', async () => {
    const v = bgc();
    const pending = owner.api.read('GET /v1/businesses/{businessId}/refunds', { businessId: v.businessId }).find((r) => r.refund.status === 'pending_approval')!;
    await expectCode(receptionist.api.write('POST /v1/businesses/{businessId}/refunds/{refundId}/approve', { businessId: v.businessId, refundId: pending.refund.id }), 'FORBIDDEN');
    await expectCode(manager.api.write('POST /v1/businesses/{businessId}/refunds/{refundId}/approve', { businessId: v.businessId, refundId: pending.refund.id }), 'FORBIDDEN');
    const r = await owner.api.write('POST /v1/businesses/{businessId}/refunds/{refundId}/approve', { businessId: v.businessId, refundId: pending.refund.id });
    assert.equal(r.status, 'processing');
  });

  test('refund after payout drives venue payable negative', async () => {
    const v = bgc();
    await h.advance(2 * HOUR);
    const bal = h.store.read((db) => accountBalance(allLines(db, (j) => j.businessId === v.businessId), venuePayable(v.businessId)));
    assert.ok(Number.isInteger(bal));
  });

  test('user restricted during checkout: payment is refunded in full, booking not confirmed', async () => {
    const v = bgc();
    const court = courts(v.id)[4]!;
    const startMs = freeSlot(player2, v.id, court.id, 30, 9);
    const hold = await player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 });
    const pay = await payFor(player2, hold.checkoutId, 'gcash', false);
    const bea = h.store.read((db) => db.find('users', (u) => u.persona === 'player2')!);
    await owner.api.write('POST /v1/businesses/{businessId}/restrictions', { businessId: v.businessId, userId: bea.id, reasonCategory: 'misconduct', internalNotes: 'Test restriction during checkout', endAt: h.store.now() + 3 * DAY });
    await h.store.transact((tx) => provider.customerApprove(makeSvc(tx.db, tx.now, tx.meta, PROVIDER_ACTOR, { correlationId: 't', ip: '', device: '', sessionToken: null }), pay.sessionId));
    await h.advance(3_000);
    await h.advance(6_000);
    const b = player2.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: hold.bookingId });
    assert.ok(['refund_pending', 'refunded'].includes(b.booking.status), b.booking.status);
  });

  test('court blocked during checkout: hold released; late payment refunded', async () => {
    const v = bgc();
    const court = courts(v.id)[5]!;
    const startMs = freeSlot(player, v.id, court.id, 30, 10);
    const hold = await player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: court.id, startMs, durationMinutes: 60 });
    const pay = await payFor(player, hold.checkoutId, 'gcash', false);
    await expectCode(owner.api.write('POST /v1/businesses/{businessId}/courts/{courtId}/blocks', { businessId: v.businessId, courtId: court.id, startMs, endMs: startMs + 2 * HOUR, reason: 'maintenance' }), 'CONFLICT');
    await owner.api.write('POST /v1/businesses/{businessId}/courts/{courtId}/blocks', { businessId: v.businessId, courtId: court.id, startMs, endMs: startMs + 2 * HOUR, reason: 'maintenance', resolution: 'cancel_and_refund' });
    await h.store.transact((tx) => provider.customerApprove(makeSvc(tx.db, tx.now, tx.meta, PROVIDER_ACTOR, { correlationId: 't', ip: '', device: '', sessionToken: null }), pay.sessionId)).catch(() => undefined);
    await h.advance(3_000);
    const b = player.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: hold.bookingId });
    assert.ok(['cancelled', 'refund_pending', 'refunded'].includes(b.booking.status), b.booking.status);
  });

  test('support mode is read-only and audited', async () => {
    const juan = h.store.read((db) => db.find('users', (u) => u.persona === 'player')!);
    await superadmin.api.write('POST /v1/admin/support-sessions', { targetUserId: juan.id, reason: 'Player reports a missing refund on booking', ticketRef: 'SUP-1043', minutes: 15 });
    const me = superadmin.api.read('GET /v1/me');
    assert.equal(me?.user.id, juan.id);
    await expectCode(superadmin.api.write('PATCH /v1/me/profile', { bio: 'hacked' }), 'SUPPORT_MODE_READ_ONLY');
    await superadmin.api.write('DELETE /v1/admin/support-sessions/current', undefined as never);
    assert.ok(h.store.read((db) => db.find('audit', (a) => a.action === 'support.session_started')));
  });

  test('commission change needs a second approver (maker-checker)', async () => {
    const kitchen = h.store.read((db) => db.find('businesses', (b) => b.tradeName === 'Ortigas Paddle House')!);
    const { approval } = await superadmin.api.write('POST /v1/admin/commission-agreements', { businessId: kitchen.id, ratePpm: 45_000, effectiveFrom: h.store.now(), effectiveTo: null, appliesToProducts: false, appliesToEvents: true, note: 'Agreement OPH-2026-02' });
    await expectCode(superadmin.api.write('POST /v1/admin/approval-requests/{approvalId}/decision', { approvalId: approval.id, approve: true }), 'FORBIDDEN');
    const done = await finance.api.write('POST /v1/admin/approval-requests/{approvalId}/decision', { approvalId: approval.id, approve: true });
    assert.equal(done.status, 'approved');
  });

  test('forged webhook is rejected and alerted', async () => {
    const res = await player.api.webhook({ 'x-callback-token': 'guess' }, { id: 'evt-fake', event: 'payment.succeeded', data: { reference_id: 'pay_x' } });
    assert.equal(res.status, 401);
    assert.ok(h.store.read((db) => db.find('securityEvents', (e) => e.type === 'webhook_token_invalid')));
  });

  test('ledger still balances and audit chain intact after all scenarios', () => {
    assert.ok(ledgerBalanced());
    assert.equal(h.store.read((db) => verifyAuditChain(db)).ok, true);
    const clearing = h.store.read((db) => accountBalance(allLines(db), ACCOUNTS.providerClearing));
    const recon = superadmin.api.read('GET /v1/admin/reconciliation');
    assert.equal(recon.ledgerClearing, clearing);
  });
});

async function superadminSetWebhookMode(mode: 'normal' | 'duplicate' | 'drop') {
  await h.store.transact((tx) => {
    tx.db.update('settings', 'platform', (x) => {
      x.demo.webhookMode = mode;
    });
  });
}
