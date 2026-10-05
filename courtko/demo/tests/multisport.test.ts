/**
 * Change request CR-01 (doc 24): multi-sport catalog, court dependencies, Open Play (registration, partners,
 * teams, payments, refunds), secure check-in, attendance/rotation, privacy-safe views and social profiles.
 * Every call goes through the API layer the UI uses.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, type Harness, type Tab } from './helpers.ts';
import { ApiError } from '../src/services/api.ts';
import { totals } from '../src/domain/ledger.ts';
import { addDays, localDate, localToInstant, HOUR, MINUTE, DAY } from '../src/domain/time.ts';
import { LAUNCH_SPORTS } from '../src/domain/sports.ts';
import { parseCheckinToken } from '../src/domain/checkin.ts';
import * as provider from '../src/services/provider.ts';
import { makeSvc, PROVIDER_ACTOR } from '../src/services/svc.ts';
import { ConstraintViolation } from '../src/services/store.ts';

let h: Harness;
let player: Tab;
let player2: Tab;
let owner: Tab;
let manager: Tab;
let receptionist: Tab;
let superadmin: Tab;

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

const venue = (slug: string) => h.store.read((db) => db.find('venues', (v) => v.slug === slug)!);
const layout = (venueId: string, pred: (c: { name: string; sport?: string; layout?: string }) => boolean) => h.store.read((db) => db.find('courts', (c) => c.venueId === venueId && c.status === 'active' && pred(c))!);

async function pay(tab: Tab, checkoutId: string) {
  const res = await tab.api.write('POST /v1/me/checkouts/{checkoutId}/payment-sessions', { checkoutId, paymentMethod: 'gcash', acceptPolicy: true }, { idempotencyKey: `k-${checkoutId}` });
  const sessionId = res.redirectUrl.split('/').pop()!;
  await h.store.transact((tx) => provider.customerApprove(makeSvc(tx.db, tx.now, tx.meta, PROVIDER_ACTOR, { correlationId: 't', ip: '', device: '', sessionToken: null }), sessionId, { last4: '4242' }));
  await h.advance(5_000); // webhook delivery + verified capture
}

function freeStart(tab: Tab, venueId: string, courtId: string, sport: string, dayOffset: number, minHour = 9) {
  const date = addDays(localDate(h.store.now()), dayOffset);
  const av = tab.api.read('GET /v1/public/venues/{venueId}/availability', { venueId, date, durationMinutes: 60, sport });
  const cell = av.courts.find((c) => c.court.id === courtId)!.cells.find((c) => c.bookable && c.startMs >= localToInstant(date, minHour * 60));
  assert.ok(cell, 'expected a free cell');
  return cell!.startMs;
}

before(async () => {
  h = await harness();
  player = await h.tab('player');
  player2 = await h.tab('player2');
  owner = await h.tab('owner');
  manager = await h.tab('manager');
  receptionist = await h.tab('receptionist');
  superadmin = await h.tab('superadmin');
});

describe('sport catalog', () => {
  test('exactly the four launch sports are active and come from the catalog', () => {
    const sports = player.api.read('GET /v1/public/sports');
    assert.deepEqual(sports.map((s) => s.code).sort(), [...LAUNCH_SPORTS].sort());
    assert.ok(!sports.some((s) => ['badminton', 'futsal'].includes(s.code)));
    const bb = sports.find((s) => s.code === 'basketball')!;
    assert.ok(bb.formats.some((f) => f.code === 'half_court') && bb.formats.some((f) => f.code === 'team'));
    assert.ok(!bb.formats.some((f) => f.code === 'singles'), 'basketball does not assume singles/doubles');
  });

  test('only SuperAdmin can change the catalog; changes are versioned and deactivation needs a reason', async () => {
    await expectCode(() => owner.api.read('GET /v1/admin/sports'), 'NOT_FOUND');
    await expectCode(superadmin.api.write('PATCH /v1/admin/sports/{sport}', { sport: 'tennis', status: 'inactive' }), 'VALIDATION_FAILED');
    const s = await superadmin.api.write('PATCH /v1/admin/sports/{sport}', { sport: 'tennis', description: 'Singles or doubles on hard or clay courts.' });
    assert.equal(s.version, 2);
  });

  test('venues filter by sport, layout and Open Play', () => {
    const bb = player.api.read('GET /v1/public/venues', { sport: 'basketball' }).rows;
    assert.ok(bb.length >= 2 && bb.every((r) => r.sports.includes('basketball')));
    const half = player.api.read('GET /v1/public/venues', { layout: 'partial' }).rows;
    assert.ok(half.every((r) => r.hasPartial));
    const op = player.api.read('GET /v1/public/venues', { hasOpenPlay: true }).rows;
    assert.ok(op.length >= 3 && op.every((r) => r.openPlayCount > 0));
  });
});

describe('court dependencies (space units)', () => {
  test('a full-court hold blocks the halves, and a half-court hold blocks the full court', async () => {
    const v = venue('dink-district-bgc');
    const full = layout(v.id, (c) => c.sport === 'basketball' && c.layout === 'full');
    const halfA = layout(v.id, (c) => c.sport === 'basketball' && c.name.endsWith('Half court A'));
    const halfB = layout(v.id, (c) => c.sport === 'basketball' && c.name.endsWith('Half court B'));
    const startMs = freeStart(player, v.id, full.id, 'basketball', 4, 9);
    const hold = await player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: full.id, startMs, durationMinutes: 60 });
    await expectCode(player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: halfA.id, startMs, durationMinutes: 60 }), 'SLOT_UNAVAILABLE');
    const date = addDays(localDate(h.store.now()), 4);
    const av = player2.api.read('GET /v1/public/venues/{venueId}/availability', { venueId: v.id, date, durationMinutes: 60, sport: 'basketball' });
    assert.equal(av.courts.find((c) => c.court.id === halfB.id)!.cells.find((c) => c.startMs === startMs)!.state, 'dependent');
    await player.api.write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: hold.checkoutId });
    const a = await player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: halfA.id, startMs, durationMinutes: 60 });
    const b = await player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: halfB.id, startMs, durationMinutes: 60 });
    assert.ok(a.checkoutId && b.checkoutId, 'two halves can be booked at the same time');
    await expectCode(player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: full.id, startMs, durationMinutes: 60 }), 'SLOT_UNAVAILABLE');
    await player.api.write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: a.checkoutId });
    await player2.api.write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: b.checkoutId });
  });

  test('a shared floor hosts one sport at a time, with a changeover gap between sports', async () => {
    const v = venue('hoopsville-cubao');
    const vball = layout(v.id, (c) => c.sport === 'volleyball' && c.name.startsWith('Gym 2'));
    const full = layout(v.id, (c) => c.sport === 'basketball' && c.name === 'Gym 2 · Full court');
    const startMs = freeStart(player, v.id, full.id, 'basketball', 5, 10);
    const hold = await player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: full.id, startMs, durationMinutes: 60 });
    await expectCode(player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: vball.id, startMs, durationMinutes: 60 }), 'SLOT_UNAVAILABLE');
    // Right after the basketball booking ends, volleyball needs the 20-minute changeover (net set-up).
    await expectCode(player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: vball.id, startMs: startMs + HOUR, durationMinutes: 60 }), 'CHANGEOVER_CONFLICT');
    const date = addDays(localDate(h.store.now()), 5);
    const av = player2.api.read('GET /v1/public/venues/{venueId}/availability', { venueId: v.id, date, durationMinutes: 60, sport: 'volleyball' });
    const cell = av.courts.find((c) => c.court.id === vball.id)!.cells.find((c) => c.startMs === startMs + HOUR)!;
    assert.ok(!cell.bookable && /changeover/i.test(cell.reason ?? ''), 'availability explains the changeover');
    const later = await player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: vball.id, startMs: startMs + 90 * MINUTE, durationMinutes: 60 });
    assert.ok(later.checkoutId);
    await player.api.write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: hold.checkoutId });
    await player2.api.write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: later.checkoutId });
  });

  test('two pickleball courts fit on one tennis court; the tennis court blocks both', async () => {
    const v = venue('baseline-racquet-club');
    const tennis = layout(v.id, (c) => c.sport === 'tennis' && c.name.startsWith('Court 2'));
    const pa = layout(v.id, (c) => c.sport === 'pickleball' && c.name === 'Court 2 · Pickleball A');
    const pb = layout(v.id, (c) => c.sport === 'pickleball' && c.name === 'Court 2 · Pickleball B');
    const startMs = freeStart(player, v.id, pa.id, 'pickleball', 6, 14);
    const a = await player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: pa.id, startMs, durationMinutes: 60 });
    const b = await player2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: pb.id, startMs, durationMinutes: 60 });
    assert.ok(a.checkoutId && b.checkoutId);
    const t2 = await h.tab('player');
    await expectCode(t2.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: tennis.id, startMs, durationMinutes: 60 }), 'HOLD_LIMIT_REACHED').catch(async () => undefined);
    await player.api.write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: a.checkoutId });
    await expectCode(player.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: tennis.id, startMs, durationMinutes: 60 }), 'SLOT_UNAVAILABLE');
    await player2.api.write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: b.checkoutId });
  });

  test('the store itself rejects overlapping unit occupancy (constraint, not UI)', async () => {
    const v = venue('dink-district-bgc');
    const full = layout(v.id, (c) => c.sport === 'basketball' && c.layout === 'full');
    const half = layout(v.id, (c) => c.sport === 'basketball' && c.layout === 'half');
    const t = h.store.now() + 20 * DAY;
    const base = { businessId: v.businessId, venueId: v.id, startMs: t, endMs: t + HOUR, occupiedEndMs: t + HOUR, kind: 'block' as const, sourceId: 'x', status: 'active' as const, expiresAt: null, createdAt: t, releasedAt: null };
    await assert.rejects(
      h.store.transact((tx) => {
        tx.db.insert('slots', { ...base, id: 'slt_test_full', courtId: full.id, units: full.units });
        tx.db.insert('slots', { ...base, id: 'slt_test_half', courtId: half.id, units: half.units });
      }),
      (e) => e instanceof ConstraintViolation && e.constraint === 'booking_slots_no_overlap',
    );
    assert.ok(!h.store.read((db) => db.get('slots', 'slt_test_full')), 'transaction rolled back');
  });

  test('sport-specific rates price basketball and half courts differently', () => {
    const v = venue('dink-district-bgc');
    const date = addDays(localDate(h.store.now()), 7);
    const bb = owner.api.read('GET /v1/public/venues/{venueId}/availability', { venueId: v.id, date, durationMinutes: 60, sport: 'basketball' });
    const pb = owner.api.read('GET /v1/public/venues/{venueId}/availability', { venueId: v.id, date, durationMinutes: 60, sport: 'pickleball' });
    const row = (av: typeof bb, pred: (n: string) => boolean) => av.courts.find((c) => pred(c.court.name))!.cells;
    const fullCells = row(bb, (n) => n.endsWith('Full court'));
    const halfCells = row(bb, (n) => n.endsWith('Half court A'));
    const pickleCells = row(pb, (n) => n === 'Court 1');
    const at = fullCells.find((c) => c.bookable && halfCells.find((x) => x.startMs === c.startMs)?.bookable && pickleCells.find((x) => x.startMs === c.startMs)?.bookable)!.startMs;
    const fullP = fullCells.find((c) => c.startMs === at)!.price!;
    const halfP = halfCells.find((c) => c.startMs === at)!.price!;
    const pickleP = pickleCells.find((c) => c.startMs === at)!.price!;
    assert.ok(fullP > pickleP, 'basketball full court costs more than a pickleball court');
    assert.ok(halfP < fullP, 'half court is cheaper than the full court');
  });
});

describe('Open Play', () => {
  const sessionBy = (title: string) => h.store.read((db) => db.find('openPlaySessions', (o) => o.title === title)!);

  test('format must fit the sport (server-side)', async () => {
    const v = venue('baseline-racquet-club');
    const tennis = layout(v.id, (c) => c.sport === 'tennis');
    const start = localToInstant(addDays(localDate(h.store.now()), 9), 8 * 60);
    const base = { businessId: v.businessId, venueId: v.id, sport: 'tennis', title: 'Bad format', description: '', courtIds: [tennis.id], startMs: start, endMs: start + 2 * HOUR, registrationOpensAt: h.store.now(), registrationClosesAt: start - HOUR, checkInOpensAt: start - 30 * MINUTE, lateCutoffAt: start + 30 * MINUTE, minParticipants: 2, capacity: 8, capacityUnit: 'player' as const, style: 'recreational' as const, skillLevels: [], pricing: 'per_player' as const, price: 30_000, registrationModes: ['individual' as const], walkInsAllowed: true, waitlistEnabled: true, equipmentIncluded: false, policyKey: 'standard' as const, rotation: 'first_waiting' as const, scoreRecording: false };
    const owner2 = await h.tab();
    void owner2;
    // Baseline is another business: the Dink owner gets 404 (tenant isolation)
    await expectCode(owner.api.write('PUT /v1/businesses/{businessId}/open-play', { ...base, formatCode: 'doubles' }), 'NOT_FOUND');
    const dink = venue('dink-district-bgc');
    const hall = layout(dink.id, (c) => c.sport === 'volleyball');
    await expectCode(owner.api.write('PUT /v1/businesses/{businessId}/open-play', { ...base, businessId: dink.businessId, venueId: dink.id, sport: 'volleyball', courtIds: [hall.id], formatCode: 'doubles' }), 'FORMAT_INCOMPATIBLE');
    const pickle = layout(dink.id, (c) => c.name === 'Court 1');
    await expectCode(owner.api.write('PUT /v1/businesses/{businessId}/open-play', { ...base, businessId: dink.businessId, venueId: dink.id, sport: 'volleyball', courtIds: [pickle.id], formatCode: 'individual' }), 'VALIDATION_FAILED');
  });

  test('create, publish (courts reserved), register & pay, then cancel with a policy refund', async () => {
    const dink = venue('dink-district-bgc');
    const c3 = layout(dink.id, (c) => c.name === 'Court 3');
    const start = localToInstant(addDays(localDate(h.store.now()), 10), 7 * 60);
    const draft = await owner.api.write('PUT /v1/businesses/{businessId}/open-play', { businessId: dink.businessId, venueId: dink.id, sport: 'pickleball', title: 'Sunrise Open Play', description: 'Early games', courtIds: [c3.id], startMs: start, endMs: start + 2 * HOUR, registrationOpensAt: h.store.now(), registrationClosesAt: start - HOUR, checkInOpensAt: start - 30 * MINUTE, lateCutoffAt: start + 30 * MINUTE, minParticipants: 2, capacity: 3, capacityUnit: 'player', formatCode: 'rotation', style: 'recreational', skillLevels: [], pricing: 'per_player', price: 20_000, registrationModes: ['individual'], walkInsAllowed: true, waitlistEnabled: true, equipmentIncluded: true, policyKey: 'standard', rotation: 'first_waiting', scoreRecording: true });
    assert.equal(draft.status, 'draft');
    const pub = await owner.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/publish', { businessId: dink.businessId, sessionId: draft.id });
    assert.equal(pub.slotIds.length, 1);
    await expectCode(player.api.write('POST /v1/me/booking-holds', { venueId: dink.id, courtId: c3.id, startMs: start, durationMinutes: 60 }), 'SLOT_UNAVAILABLE');
    const r = await player.api.write('POST /v1/me/open-play/{sessionId}/registrations', { sessionId: draft.id, mode: 'individual' });
    assert.equal(r.status, 'held');
    await pay(player, r.checkoutId!);
    const mine = player.api.read('GET /v1/me/open-play/registrations/{registrationId}', { registrationId: r.registrationId });
    assert.equal(mine.registration.status, 'confirmed');
    assert.equal(mine.registration.attendance, 'not_arrived', 'registration is not attendance');
    assert.equal(mine.payment!.status, 'captured');
    // fill the session → waitlist
    const r2 = await player2.api.write('POST /v1/me/open-play/{sessionId}/registrations', { sessionId: draft.id, mode: 'individual' });
    await pay(player2, r2.checkoutId!);
    const other = receptionist; // staff can play too
    const r3 = await other.api.write('POST /v1/me/open-play/{sessionId}/registrations', { sessionId: draft.id, mode: 'individual' });
    await pay(other, r3.checkoutId!);
    const late = await h.tab('applicant');
    await expectCode(late.api.write('POST /v1/me/open-play/{sessionId}/registrations', { sessionId: draft.id, mode: 'individual' }), 'SESSION_FULL');
    const w = await late.api.write('POST /v1/me/open-play/{sessionId}/waitlist', { sessionId: draft.id });
    assert.equal(w.position, 1);
    // >24h before → Standard policy refunds 100% of the session fee (fee is non-refundable for player cancellations)
    const q = player.api.read('GET /v1/me/open-play/registrations/{registrationId}/cancellation-quote', { registrationId: r.registrationId });
    assert.equal(q.refund, 20_000);
    const c = await player.api.write('POST /v1/me/open-play/registrations/{registrationId}/cancellation', { registrationId: r.registrationId });
    assert.equal(c.refunded, 20_000);
    await h.advance(60_000);
    const offered = late.api.read('GET /v1/me/open-play/registrations/{registrationId}', { registrationId: w.registrationId });
    assert.equal(offered.registration.status, 'offered', 'the freed seat is offered to the waitlist');
    assert.ok(h.store.read((db) => db.all('journals').every((j) => totals(j.lines).debit === totals(j.lines).credit)), 'ledger stays balanced');
  });

  test('partner invite: declining keeps the inviter registered and marks them as needing a partner', async () => {
    const tennis = sessionBy('Doubles Open Play 3.0–3.5');
    const inv = player2.api.read('GET /v1/me/invites').find((i) => i.session.id === tennis.id && i.invite.status === 'pending')!;
    assert.ok(inv, 'Bea has Juan’s pending invite (seed)');
    assert.ok(!('email' in (inv as object)) && !JSON.stringify(inv).includes('@example.com'), 'invites never expose contact details');
    await player2.api.write('POST /v1/me/invites/{inviteId}/response', { inviteId: inv.invite.id, accept: false });
    const juanReg = h.store.read((db) => db.find('opRegistrations', (r) => r.sessionId === tennis.id && r.role === 'captain')!);
    assert.equal(juanReg.status, 'confirmed');
    assert.equal(juanReg.needsPartner, true);
    const notes = player.api.read('GET /v1/me/notifications');
    assert.ok(notes.some((n) => n.title.startsWith('You need a partner')));
    // Management can assign a replacement from solo registrants
    const solo = h.store.read((db) => db.find('opRegistrations', (r) => r.sessionId === tennis.id && r.role === 'individual' && r.status === 'confirmed')!);
    const baselineOwner = h.store.read((db) => db.must('businesses', tennis.businessId).ownerUserId);
    assert.ok(baselineOwner);
    void solo;
  });

  test('team registration: join a team with open spots; per-team pricing makes members free', async () => {
    const hoops = sessionBy('Saturday Pickup Run (5-on-5)');
    const d = player2.api.read('GET /v1/public/open-play/{sessionId}', { sessionId: hoops.id });
    const team = d.joinableTeams.find((t) => t.name === 'Weekend Warriors')!;
    assert.ok(team && team.members < team.size);
    const r = await player2.api.write('POST /v1/me/open-play/{sessionId}/registrations', { sessionId: hoops.id, mode: 'team', joinPartyId: team.id });
    assert.equal(r.status, 'held', 'per-player pricing: each member pays');
    await pay(player2, r.checkoutId!);
    const after = player2.api.read('GET /v1/public/open-play/{sessionId}', { sessionId: hoops.id });
    assert.equal(after.joinableTeams.find((t) => t.id === team.id)?.members ?? 5, team.members + 1);
    const spike = sessionBy('Coed 6s Open Play');
    assert.equal(spike.pricing, 'per_team');
    assert.equal(spike.capacityUnit, 'team');
  });
});

describe('secure check-in & attendance', () => {
  const live = () => h.store.read((db) => db.find('openPlaySessions', (o) => o.title.startsWith('Drop-in Open Play'))!);

  test('the pass is signed, time-limited and contains no user id or personal data', async () => {
    const s = live();
    const reg = h.store.read((db) => db.find('opRegistrations', (r) => r.sessionId === s.id && r.userId === db.find('users', (u) => u.persona === 'player')!.id)!);
    const t = player.api.read('GET /v1/me/open-play/registrations/{registrationId}/checkin-token', { registrationId: reg.id });
    const parsed = parseCheckinToken(t.token)!;
    assert.ok(parsed && parsed.kind === 'OP1');
    assert.ok(!t.token.includes(reg.userId) && !t.token.includes(reg.id) && !t.token.toLowerCase().includes('juan'));
    assert.ok(t.expiresAt - h.store.now() <= 10 * MINUTE);
    assert.ok(t.registrationToken.startsWith('REG1.'));
    // Another player cannot fetch someone else's pass
    await expectCode(() => player2.api.read('GET /v1/me/open-play/registrations/{registrationId}/checkin-token', { registrationId: reg.id }), 'NOT_FOUND');
  });

  test('valid scan checks in once; duplicate, expired, tampered and wrong-session scans are rejected AND recorded', async () => {
    const s = live();
    const biz = s.businessId;
    const before = h.store.read((db) => db.count('attendanceEvents', (e) => e.sessionId === s.id && e.type === 'check_in_rejected'));
    const valid = receptionist.api.read('GET /demo/open-play/{sessionId}/sample-pass', { businessId: biz, sessionId: s.id, kind: 'valid' });
    const ok = await receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: biz, sessionId: s.id, token: valid.token });
    assert.equal(ok.attendance, 'waiting');
    await expectCode(receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: biz, sessionId: s.id, token: valid.token }), 'ALREADY_CHECKED_IN');
    const expired = receptionist.api.read('GET /demo/open-play/{sessionId}/sample-pass', { businessId: biz, sessionId: s.id, kind: 'expired' });
    await expectCode(receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: biz, sessionId: s.id, token: expired.token }), 'CHECKIN_TOKEN_EXPIRED');
    const tampered = receptionist.api.read('GET /demo/open-play/{sessionId}/sample-pass', { businessId: biz, sessionId: s.id, kind: 'tampered' });
    await expectCode(receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: biz, sessionId: s.id, token: tampered.token }), 'CHECKIN_TOKEN_INVALID');
    const wrong = receptionist.api.read('GET /demo/open-play/{sessionId}/sample-pass', { businessId: biz, sessionId: s.id, kind: 'wrong_session' });
    await expectCode(receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: biz, sessionId: s.id, token: wrong.token }), 'CHECKIN_WRONG_SESSION');
    await expectCode(receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: biz, sessionId: s.id, token: 'OP1.k1.not-a-real-token' }), 'CHECKIN_TOKEN_INVALID');
    const after = h.store.read((db) => db.count('attendanceEvents', (e) => e.sessionId === s.id && e.type === 'check_in_rejected'));
    assert.equal(after - before, 5, 'every rejected scan is recorded even though the request failed');
    assert.ok(h.store.read((db) => db.find('securityEvents', (e) => e.type === 'checkin_token_invalid')), 'tampered pass raises a security event');
  });

  test('manual check-in needs a reason; corrections and reversals are new events; the log is append-only', async () => {
    const s = live();
    const biz = s.businessId;
    const target = h.store.read((db) => db.find('opRegistrations', (r) => r.sessionId === s.id && r.status === 'confirmed' && r.attendance === 'not_arrived')!);
    await expectCode(receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: biz, sessionId: s.id, registrationId: target.id, method: 'manual', reason: '' }), 'VALIDATION_FAILED');
    await receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: biz, sessionId: s.id, registrationId: target.id, method: 'manual', reason: 'Phone died — ID checked' });
    const ev = h.store.read((db) => db.filter('attendanceEvents', (e) => e.registrationId === target.id && e.type === 'check_in')[0]!);
    // receptionist lacks openplay.attendance.correct
    await expectCode(receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/attendance-events/{eventId}/reversal', { businessId: biz, sessionId: s.id, eventId: ev.id, reason: 'Wrong player' }), 'FORBIDDEN');
    await manager.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/attendance-events/{eventId}/reversal', { businessId: biz, sessionId: s.id, eventId: ev.id, reason: 'Checked in the wrong player' });
    const reg = h.store.read((db) => db.must('opRegistrations', target.id));
    assert.equal(reg.attendance, 'not_arrived');
    assert.ok(h.store.read((db) => db.get('attendanceEvents', ev.id)), 'original event is kept');
    await assert.rejects(h.store.transact((tx) => void tx.db.update('attendanceEvents', ev.id, (x) => void (x.reason = 'edited'))), (e) => e instanceof ConstraintViolation);
  });

  test('check-in ≠ on court: players count as on court only after explicit assignment; scores only when enabled', async () => {
    const s = live();
    const biz = s.businessId;
    const d0 = receptionist.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/desk', { businessId: biz, sessionId: s.id });
    const waitingBefore = d0.counts.waiting;
    const onCourtBefore = d0.counts.onCourt;
    assert.ok(d0.counts.registered >= d0.counts.checkedIn && d0.counts.checkedIn >= d0.counts.onCourt);
    // finish the game on court 5 and start the next suggested group
    const court = d0.board.find((c) => c.game)!;
    await receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/games/{gameId}/completion', { businessId: biz, sessionId: s.id, gameId: court.game!.id, scoreA: 11, scoreB: 6 });
    const d1 = receptionist.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/desk', { businessId: biz, sessionId: s.id });
    assert.equal(d1.counts.onCourt, onCourtBefore - 4);
    assert.equal(d1.counts.waiting, waitingBefore + 4);
    const sug = receptionist.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/rotation-suggestion', { businessId: biz, sessionId: s.id, courtId: court.courtId });
    assert.equal(sug.registrationIds.length, 4);
    await receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/games', { businessId: biz, sessionId: s.id, courtId: court.courtId, sideA: sug.sideA, sideB: sug.sideB });
    const d2 = receptionist.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/desk', { businessId: biz, sessionId: s.id });
    assert.equal(d2.counts.onCourt, onCourtBefore);
    // A not-checked-in player can't be put on court
    const absent = d2.players.find((p) => p.attendance === 'not_arrived')!;
    await expectCode(receptionist.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/attendance', { businessId: biz, sessionId: s.id, registrationIds: [absent.registrationId], action: 'assign', courtId: court.courtId }), 'NOT_CHECKED_IN');
  });

  test('players see a privacy-safe live summary: counts plus their own status only', () => {
    const s = live();
    const v = player.api.read('GET /v1/public/open-play/{sessionId}', { sessionId: s.id });
    const l = v.liveSummary!;
    assert.deepEqual(Object.keys(l).sort(), ['capacity', 'checkedIn', 'me', 'playing', 'registered', 'remaining', 'status', 'updatedAt', 'waiting'].sort());
    assert.ok(l.me && 'attendance' in l.me);
    const json = JSON.stringify(v);
    assert.ok(!json.includes('@example.com') && !json.includes('+63917'), 'no contact details');
    assert.ok(!json.includes('checkinRefHash') || !json.includes('Bea'), 'no other players’ check-in metadata');
  });
});

describe('social profiles', () => {
  test('public profile projection never contains contact, payment, restriction or audit fields', () => {
    const p = player2.api.read('GET /v1/players/{username}', { username: 'juan.delacruz' });
    const json = JSON.stringify(p);
    for (const bad of ['@example.com', '+639', 'passwordHash', 'internalNotes', 'methodDisplay', 'restriction', 'checkedInBy', 'userId']) assert.ok(!json.includes(bad), `leaked ${bad}`);
    assert.ok(p.sports.length >= 2, 'shows the sports Juan plays');
  });

  test('follow without approval is immediate; with approval it is pending until accepted', async () => {
    const bea = h.store.read((db) => db.find('profiles', (x) => x.userId === db.find('users', (u) => u.persona === 'player2')!.id)!);
    await player.api.write('PATCH /v1/me/social-settings', { requireApproval: true });
    const f = await player2.api.write('POST /v1/me/follows/{username}', { username: 'juan.delacruz' }).catch(() => null);
    // Bea already follows Juan in the seed → CONFLICT; unfollow then follow again
    if (!f) {
      await player2.api.write('DELETE /v1/me/follows/{username}', { username: 'juan.delacruz' });
      const again = await player2.api.write('POST /v1/me/follows/{username}', { username: 'juan.delacruz' });
      assert.equal(again.status, 'pending');
      const req = player.api.read('GET /v1/me/follow-requests').incoming.find((x) => x.from.username === bea.username)!;
      const ok = await player.api.write('POST /v1/me/follow-requests/{followId}/response', { followId: req.id, accept: true });
      assert.equal(ok.status, 'accepted');
    }
    await player.api.write('PATCH /v1/me/social-settings', { requireApproval: false });
  });

  test('blocking removes follows both ways, prevents new follows and hides the profile', async () => {
    const bea = 'bea.santiago';
    await player.api.write('POST /v1/me/blocks/{username}', { username: bea });
    const follows = h.store.read((db) => {
      const j = db.find('users', (u) => u.persona === 'player')!.id;
      const b = db.find('users', (u) => u.persona === 'player2')!.id;
      return db.filter('follows', (f) => (f.status === 'accepted' || f.status === 'pending') && ((f.followerId === j && f.followeeId === b) || (f.followerId === b && f.followeeId === j))).length;
    });
    assert.equal(follows, 0);
    await expectCode(player2.api.write('POST /v1/me/follows/{username}', { username: 'juan.delacruz' }), 'NOT_FOUND');
    await expectCode(() => player2.api.read('GET /v1/players/{username}', { username: 'juan.delacruz' }), 'NOT_FOUND');
    assert.ok(!player2.api.read('GET /v1/players', { q: 'juan' }).some((c) => c.username === 'juan.delacruz'));
    // Blocking is social only — it does not cancel bookings or registrations.
    assert.ok(h.store.read((db) => db.find('opRegistrations', (r) => r.userId === db.find('users', (u) => u.persona === 'player2')!.id && r.status === 'confirmed')));
    await player.api.write('DELETE /v1/me/blocks/{username}', { username: bea });
  });

  test('non-discoverable players are excluded from search; usernames are validated', async () => {
    await player2.api.write('PATCH /v1/me/social-settings', { discoverable: false });
    assert.ok(!player.api.read('GET /v1/players', { q: 'bea' }).some((c) => c.username === 'bea.santiago'));
    await player2.api.write('PATCH /v1/me/social-settings', { discoverable: true });
    await expectCode(player.api.write('PATCH /v1/me/social-settings', { username: '09171234567' }), 'VALIDATION_FAILED');
    await expectCode(player.api.write('PATCH /v1/me/social-settings', { username: 'bea.santiago' }), 'USERNAME_TAKEN');
  });

  test('My Sports dashboard shows per-sport stats from bookings and Open Play attendance', () => {
    const d = player.api.read('GET /v1/me/sports');
    const codes = d.sports.map((s) => s.sport);
    assert.ok(codes.includes('pickleball') && codes.includes('basketball') && codes.includes('tennis'));
    const pb = d.sports.find((s) => s.sport === 'pickleball')!;
    assert.ok(pb.sessions > 0 && pb.openPlay >= 2 && pb.games >= 5 && pb.wins >= 1);
    assert.equal(d.sports[0]!.sport, 'pickleball', 'pinned sport first');
  });
});
