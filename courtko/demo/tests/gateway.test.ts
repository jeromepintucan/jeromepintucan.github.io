/**
 * Payment-gateway exception handling (doc 08 §6): provider faults with retries and idempotency, channel outages,
 * decline codes with player guidance, the failed-attempt limit, amount mismatches, refund failures with the
 * bank-transfer route, and the exceptions center.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, type Harness, type Tab } from './helpers.ts';
import { ApiError } from '../src/services/api.ts';
import { addDays, localDate, localToInstant } from '../src/domain/time.ts';
import * as provider from '../src/services/provider.ts';
import { makeSvc, PROVIDER_ACTOR } from '../src/services/svc.ts';
import type { DemoControls } from '../src/services/model.ts';

let h: Harness;
let player: Tab;
let owner: Tab;
let admin: Tab;

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

const setDemo = (patch: Partial<DemoControls>) => h.store.transact((tx) => void tx.db.update('settings', 'platform', (x) => void Object.assign(x.demo, patch)));
const prov = <T>(fn: (s: ReturnType<typeof makeSvc>) => T) => h.store.transact((tx) => fn(makeSvc(tx.db, tx.now, tx.meta, PROVIDER_ACTOR, { correlationId: 't', ip: '', device: '', sessionToken: null })));
const dink = () => h.store.read((db) => db.find('venues', (v) => v.slug === 'dink-district-bgc')!);

let dayOffset = 12;
async function hold(): Promise<{ checkoutId: string; bookingId: string }> {
  await h.advance(25 * 60_000); // let earlier holds expire (a player may have at most 2 checkouts in progress)
  const v = dink();
  const date = addDays(localDate(h.store.now()), dayOffset++);
  const av = player.api.read('GET /v1/public/venues/{venueId}/availability', { venueId: v.id, date, durationMinutes: 60, sport: 'pickleball' });
  const row = av.courts.find((c) => c.cells.some((x) => x.bookable && x.startMs >= localToInstant(date, 8 * 60)))!;
  const cell = row.cells.find((x) => x.bookable && x.startMs >= localToInstant(date, 8 * 60))!;
  const r = await player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: row.court.id, startMs: cell.startMs, durationMinutes: 60 });
  return { checkoutId: r.checkoutId, bookingId: h.store.read((db) => db.find('bookings', (b) => b.checkoutId === r.checkoutId)!.id) };
}
const startPay = (checkoutId: string, method: 'gcash' | 'maya' | 'card' = 'gcash', key = `${checkoutId}-${method}-${Math.random()}`) => player.api.write('POST /v1/me/checkouts/{checkoutId}/payment-sessions', { checkoutId, paymentMethod: method, acceptPolicy: true }, { idempotencyKey: key });
const sessionOf = (url: string) => url.split('/').pop()!;

before(async () => {
  h = await harness();
  player = await h.tab('player');
  owner = await h.tab('owner');
  h.clock.t += 31_000;
  admin = await h.tab('superadmin');
});

describe('provider faults', () => {
  test('a transient 502 is retried with the same idempotency key and recorded as a recovered incident', async () => {
    const { checkoutId } = await hold();
    await setDemo({ providerFault: 'flaky' });
    const r = await startPay(checkoutId);
    assert.ok(r.redirectUrl.includes('/pay/'));
    const inc = h.store.read((db) => db.filter('providerIncidents', (i) => i.outcome === 'recovered' && i.op === 'create_session' && i.at === h.store.now()));
    assert.equal(inc.length, 1);
    assert.match(inc[0]!.detail, /no duplicate/);
  });

  test('a lost response (timeout after the provider created the session) returns the SAME session on retry — no double session', async () => {
    const { checkoutId } = await hold();
    await setDemo({ providerFault: 'timeout' });
    const r = await startPay(checkoutId);
    const pay = h.store.read((db) => db.find('payments', (p) => p.checkoutId === checkoutId && p.status === 'pending')!);
    const sessions = h.store.read((db) => db.filter('providerSessions', (x) => x.idempotencyKey === pay.idempotencyKey));
    assert.equal(sessions.length, 1, 'exactly one provider session for the idempotency key');
    assert.equal(sessionOf(r.redirectUrl), sessions[0]!.id);
  });

  test('a full outage fails with PROVIDER_UNAVAILABLE, keeps the hold, and records the incident even though the request failed', async () => {
    const { checkoutId, bookingId } = await hold();
    await setDemo({ providerFault: 'down' });
    const e = await expectCode(startPay(checkoutId), 'PROVIDER_UNAVAILABLE');
    assert.match(e.message, /not charged/);
    assert.equal(h.store.read((db) => db.must('checkouts', checkoutId)).status, 'open');
    assert.equal(h.store.read((db) => db.must('bookings', bookingId)).status, 'slot_held', 'hold kept');
    assert.equal(h.store.read((db) => db.count('payments', (p) => p.checkoutId === checkoutId)), 0, 'no half-created payment');
    assert.ok(h.store.read((db) => db.find('providerIncidents', (i) => i.outcome === 'failed' && i.attempts === 3)), 'failed incident written after rollback');
    const status = player.api.read('GET /v1/public/payment-status');
    assert.equal(status.status, 'down');
    await setDemo({ providerFault: 'none' });
    await startPay(checkoutId); // recovers once the provider is back
  });

  test('a channel outage fails fast for that method only; other methods work', async () => {
    const { checkoutId } = await hold();
    await setDemo({ channelDown: 'gcash' });
    await expectCode(startPay(checkoutId, 'gcash'), 'PAYMENT_METHOD_UNAVAILABLE');
    const st = player.api.read('GET /v1/public/payment-status');
    assert.equal(st.methods.find((m) => m.method === 'gcash')!.status, 'down');
    assert.equal(st.methods.find((m) => m.method === 'maya')!.status, 'operational');
    const r = await startPay(checkoutId, 'maya');
    assert.ok(r.redirectUrl);
    await setDemo({ channelDown: null });
  });
});

describe('declines and attempts', () => {
  test('a decline carries a provider code; the player gets guidance and the hold is kept', async () => {
    const { checkoutId, bookingId } = await hold();
    const r = await startPay(checkoutId, 'gcash');
    await prov((s) => provider.customerDecline(s, sessionOf(r.redirectUrl), 'MAXIMUM_LIMIT_EXCEEDED'));
    await h.advance(3_000);
    const pay = h.store.read((db) => db.find('payments', (p) => p.checkoutId === checkoutId)!);
    assert.equal(pay.status, 'failed');
    assert.equal(pay.failureCode, 'MAXIMUM_LIMIT_EXCEEDED');
    assert.equal(h.store.read((db) => db.must('bookings', bookingId)).status, 'slot_held');
    const note = h.store.read((db) => db.filter('notifications', (n) => n.userId === pay.userId).sort((a, b) => b.createdAt - a.createdAt)[0]!);
    assert.match(note.title, /Wallet limit reached/);
    assert.match(note.body, /another wallet|card/i);
  });

  test('after 5 failed attempts the checkout is paused (card-testing guard)', async () => {
    const { checkoutId } = await hold();
    for (let i = 0; i < 5; i++) {
      const r = await startPay(checkoutId, 'card', `k${i}`);
      await prov((s) => provider.customerDecline(s, sessionOf(r.redirectUrl), 'CARD_DECLINED'));
      await h.advance(2_000);
    }
    await expectCode(startPay(checkoutId, 'card', 'k6'), 'RATE_LIMITED');
  });

  test('unknown decline codes are rejected by the sandbox (catalog is exhaustive)', async () => {
    const { checkoutId } = await hold();
    const r = await startPay(checkoutId);
    await assert.rejects(prov((s) => provider.customerDecline(s, sessionOf(r.redirectUrl), 'MADE_UP')));
  });
});

describe('amount mismatch, refunds and the exceptions center', () => {
  test('a mismatched captured amount is never fulfilled: held for review, then refunded in full by platform finance', async () => {
    const { checkoutId, bookingId } = await hold();
    const r = await startPay(checkoutId);
    await setDemo({ amountMismatchNext: true });
    await prov((s) => provider.customerApprove(s, sessionOf(r.redirectUrl), { last4: '4242' }));
    await h.advance(5_000);
    const pay = h.store.read((db) => db.find('payments', (p) => p.checkoutId === checkoutId)!);
    assert.equal(pay.review?.reason, 'amount_mismatch');
    assert.notEqual(h.store.read((db) => db.must('bookings', bookingId)).status, 'confirmed', 'not fulfilled');
    assert.ok(h.store.read((db) => db.find('webhookEvents', (w) => w.note.includes('review') || w.note.includes('captured') || w.note.includes('Verified'))), 'webhook acknowledged');
    const exc = admin.api.read('GET /v1/admin/payment-exceptions');
    const item = exc.items.find((i) => i.kind === 'amount_mismatch' && i.ref.paymentId === pay.id)!;
    assert.ok(item && item.actions.includes('resolve_mismatch'));
    const res = await admin.api.write('POST /v1/admin/payments/{paymentId}/review-resolution', { paymentId: pay.id, note: 'Provider ticket #4821' });
    assert.equal(res.refunded, pay.amount + 100);
    await h.advance(5_000);
    const pp = h.store.read((db) => db.must('providerPayments', pay.review!.providerPaymentId));
    assert.equal(pp.status, 'REFUNDED');
  });

  test('a refund the channel cannot process shows in Payment issues and can be completed by bank transfer', async () => {
    const list = owner.api.read('GET /v1/businesses/{businessId}/payment-exceptions', { businessId: dink().businessId });
    const item = list.items.find((i) => i.kind === 'refund_failed')!;
    assert.ok(item, 'seeded failed refund is listed');
    assert.ok(item.actions.includes('manual_refund'));
    assert.match(item.guidance, /bank transfer/);
    await expectCode(owner.api.write('POST /v1/businesses/{businessId}/refunds/{refundId}/manual-completion', { businessId: dink().businessId, refundId: item.ref.refundId!, reference: '12' }), 'VALIDATION_FAILED');
    const done = await owner.api.write('POST /v1/businesses/{businessId}/refunds/{refundId}/manual-completion', { businessId: dink().businessId, refundId: item.ref.refundId!, reference: 'BPI-2026100612345' });
    assert.equal(done.status, 'succeeded');
    assert.equal(done.manual?.reference, 'BPI-2026100612345');
    const b = h.store.read((db) => db.must('bookings', done.bookingId!));
    assert.equal(b.status, 'refunded');
    const after = owner.api.read('GET /v1/businesses/{businessId}/payment-exceptions', { businessId: dink().businessId });
    assert.ok(!after.items.some((i) => i.ref.refundId === done.id && i.kind === 'refund_failed'));
  });

  test('exceptions are tenant-scoped and acknowledgements never edit the records', async () => {
    const mine = owner.api.read('GET /v1/businesses/{businessId}/payment-exceptions', { businessId: dink().businessId });
    assert.ok(mine.items.every((i) => i.businessId === dink().businessId));
    const fyi = mine.items.find((i) => i.actions.includes('acknowledge') && !i.resolved)!;
    assert.ok(fyi);
    await owner.api.write('POST /v1/businesses/{businessId}/payment-exceptions/acknowledgements', { businessId: dink().businessId, key: fyi.key, note: 'Checked' });
    const again = owner.api.read('GET /v1/businesses/{businessId}/payment-exceptions', { businessId: dink().businessId });
    assert.ok(again.items.find((i) => i.key === fyi.key)!.resolved);
    await expectCode(owner.api.write('POST /v1/businesses/{businessId}/payment-exceptions/acknowledgements', { businessId: dink().businessId, key: fyi.key, note: 'Twice' }), 'CONFLICT');
    await expectCode(() => player.api.read('GET /v1/admin/payment-exceptions'), 'NOT_FOUND'); // platform routes are invisible to non-admins
    assert.ok(mine.reasons.length > 0, 'failure analytics from realistic seeded attempts');
  });
});
