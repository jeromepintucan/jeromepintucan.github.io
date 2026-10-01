/**
 * Venue & court setup (build step 5): venue profile, operating hours, special hours/closures,
 * booking rules, courts, and court blocks with conflict detection against bookings and holds.
 */

import { AppError, fail, invalid, type FieldError } from '../domain/errors.ts';
import { newId, slugify } from '../domain/ids.ts';
import { isInPhilippines } from '../domain/geo.ts';
import { POLICY_LIBRARY } from '../domain/policy.ts';
import type { PaymentMethodCode } from '../domain/pricing.ts';
import { VENUE_TRANSITIONS, transition } from '../domain/state.ts';
import { formatDateShort, formatTimeRange, isLocalDate, localDate, localParts, MINUTE } from '../domain/time.ts';
import { optionalText, requireInt, requireText } from '../domain/validation.ts';
import type { BookingSettings, WeeklyHours } from '../domain/availability.ts';
import { cancelCheckout, insertSlot, releaseSlot } from './checkout.ts';
import type { Court, CourtBlock, Id, Venue } from './model.ts';
import { venueCancelBooking } from './booking.ts';
import { audit, notify, requireBusiness, settings, type Svc } from './svc.ts';

function ownVenue(s: Svc, businessId: Id, venueId: Id): Venue {
  const v = s.db.get('venues', venueId);
  if (!v || v.businessId !== businessId) fail('NOT_FOUND', 'Venue not found.');
  return v;
}

export function listBusinessVenues(s: Svc, input: { businessId: Id }) {
  const acc = requireBusiness(s, input.businessId, 'business.view');
  return s.db
    .filter('venues', (v) => v.businessId === input.businessId && (!acc.member.venueIds || acc.member.venueIds.includes(v.id)))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((v) => ({ venue: v, courts: s.db.filter('courts', (c) => c.venueId === v.id).sort((a, b) => a.sortOrder - b.sortOrder), specialHours: s.db.filter('specialHours', (x) => x.venueId === v.id).sort((a, b) => a.date.localeCompare(b.date)) }));
}

export function createVenue(s: Svc, input: { businessId: Id; name: string; city: string; barangay: string; line1: string; province: string; lat: number; lng: number }) {
  const acc = requireBusiness(s, input.businessId, 'venues.manage', { write: true });
  const errors: FieldError[] = [];
  const name = requireText(errors, 'name', input.name, 'Venue name', { min: 3, max: 80 });
  const city = requireText(errors, 'city', input.city, 'City / municipality', { max: 60 });
  const barangay = requireText(errors, 'barangay', input.barangay, 'Barangay', { max: 60 });
  const line1 = requireText(errors, 'line1', input.line1, 'Street address', { max: 120 });
  const province = requireText(errors, 'province', input.province, 'Province', { max: 60 });
  if (!isInPhilippines({ lat: Number(input.lat), lng: Number(input.lng) })) errors.push({ field: 'lat', message: 'Drop the map pin inside the Philippines.' });
  if (errors.length) invalid(errors);
  let slug = slugify(`${name} ${city}`);
  if (s.db.find('venues', (v) => v.slug === slug)) slug = `${slug}-${Math.floor(Math.random() * 900 + 100)}`;
  const venue: Venue = {
    id: newId('ven'),
    businessId: input.businessId,
    name,
    slug,
    tagline: '',
    description: '',
    address: { line1, barangay, city, province, region: '', postalCode: '' },
    geo: { lat: Number(input.lat), lng: Number(input.lng) },
    timezone: 'Asia/Manila',
    offsetMin: 480,
    contactPhone: acc.business.contactPhone,
    contactEmail: acc.business.contactEmail,
    amenities: [],
    parking: '',
    accessibility: '',
    rules: ['Non-marking court shoes only.', 'Please arrive 10 minutes early for check-in.'],
    status: 'draft',
    history: [],
    hours: { days: Array.from({ length: 7 }, () => ({ open: 6 * 60, close: 22 * 60 })) },
    settings: { incrementMinutes: 30, minDurationMinutes: 60, maxDurationMinutes: 180, advanceBookingDays: 30, minLeadMinutes: 30, bufferMinutes: 0, holdTtlMinutes: 10, maxActiveHoldsPerUser: 2, checkInWindowMinutesBefore: 30, noShowGraceMinutes: 15, requireCheckIn: false },
    policyKey: 'standard',
    acceptedMethods: ['gcash', 'maya', 'grabpay', 'card', 'qrph', 'online_banking'],
    art: { hue: Math.floor(Math.random() * 360), accent: 80, pattern: 'lines' },
    ratingAvg: 0,
    ratingCount: 0,
    createdAt: s.now,
    publishedAt: null,
  };
  s.db.insert('venues', venue);
  audit(s, { action: 'venue.created', targetType: 'venue', targetId: venue.id, businessId: input.businessId, summary: `Created venue ${name}` });
  return venue;
}

export function updateVenueProfile(s: Svc, input: { businessId: Id; venueId: Id; name?: string; tagline?: string; description?: string; parking?: string; accessibility?: string; rules?: string[]; amenities?: string[]; contactPhone?: string; contactEmail?: string; acceptedMethods?: PaymentMethodCode[]; policyKey?: Venue['policyKey'] }) {
  requireBusiness(s, input.businessId, 'venues.manage', { venueId: input.venueId, write: true });
  const v = ownVenue(s, input.businessId, input.venueId);
  const errors: FieldError[] = [];
  const patch: Partial<Venue> = {};
  if (input.name !== undefined) patch.name = requireText(errors, 'name', input.name, 'Venue name', { min: 3, max: 80 });
  if (input.tagline !== undefined) patch.tagline = optionalText(errors, 'tagline', input.tagline, 'Tagline', 120);
  if (input.description !== undefined) patch.description = optionalText(errors, 'description', input.description, 'Description', 2000);
  if (input.parking !== undefined) patch.parking = optionalText(errors, 'parking', input.parking, 'Parking', 300);
  if (input.accessibility !== undefined) patch.accessibility = optionalText(errors, 'accessibility', input.accessibility, 'Accessibility', 300);
  if (input.rules !== undefined) patch.rules = input.rules.map((r) => r.trim()).filter(Boolean).slice(0, 12);
  if (input.amenities !== undefined) {
    const known = new Set(settings(s.db).amenities.map((a) => a.code));
    patch.amenities = input.amenities.filter((a) => known.has(a));
  }
  if (input.acceptedMethods !== undefined) {
    if (!input.acceptedMethods.length) errors.push({ field: 'acceptedMethods', message: 'Accept at least one payment method.' });
    patch.acceptedMethods = input.acceptedMethods;
  }
  if (input.policyKey !== undefined) {
    if (!POLICY_LIBRARY[input.policyKey]) errors.push({ field: 'policyKey', message: 'Choose a cancellation policy.' });
    patch.policyKey = input.policyKey;
  }
  if (errors.length) invalid(errors);
  const before = { name: v.name, policyKey: v.policyKey, acceptedMethods: v.acceptedMethods, amenities: v.amenities };
  s.db.update('venues', v.id, (x) => Object.assign(x, patch));
  audit(s, { action: 'venue.updated', targetType: 'venue', targetId: v.id, businessId: v.businessId, summary: `Updated venue profile (${Object.keys(patch).join(', ')})`, before, after: { name: patch.name ?? v.name, policyKey: patch.policyKey ?? v.policyKey, acceptedMethods: patch.acceptedMethods ?? v.acceptedMethods, amenities: patch.amenities ?? v.amenities } });
  return s.db.must('venues', v.id);
}

export function updateOperatingHours(s: Svc, input: { businessId: Id; venueId: Id; hours: WeeklyHours }) {
  requireBusiness(s, input.businessId, 'venues.manage', { venueId: input.venueId, write: true });
  const v = ownVenue(s, input.businessId, input.venueId);
  const errors: FieldError[] = [];
  if (!input.hours || input.hours.days.length !== 7) errors.push({ field: 'hours', message: 'Provide hours for all 7 days.' });
  input.hours?.days.forEach((d, i) => {
    if (!d) return;
    if (d.open < 0 || d.close > 1440 || d.close <= d.open) errors.push({ field: `hours.${i}`, message: 'Closing time must be after opening time.' });
    if (d.open % 30 || d.close % 30) errors.push({ field: `hours.${i}`, message: 'Use 30-minute boundaries.' });
  });
  if (errors.length) invalid(errors);
  const before = v.hours;
  s.db.update('venues', v.id, (x) => {
    x.hours = input.hours;
  });
  audit(s, { action: 'venue.hours_changed', targetType: 'venue', targetId: v.id, businessId: v.businessId, summary: 'Changed operating hours', before, after: input.hours });
  return s.db.must('venues', v.id);
}

export function updateBookingSettings(s: Svc, input: { businessId: Id; venueId: Id; settings: Partial<BookingSettings> }) {
  requireBusiness(s, input.businessId, 'business.settings.manage', { venueId: input.venueId, write: true });
  const v = ownVenue(s, input.businessId, input.venueId);
  const errors: FieldError[] = [];
  const next = { ...v.settings, ...input.settings };
  if (![30, 60, 90].includes(next.incrementMinutes)) errors.push({ field: 'incrementMinutes', message: 'Choose 30, 60 or 90 minutes.' });
  requireInt(errors, 'minDurationMinutes', next.minDurationMinutes, 'Minimum duration', { min: 30, max: 480 });
  requireInt(errors, 'maxDurationMinutes', next.maxDurationMinutes, 'Maximum duration', { min: next.minDurationMinutes, max: 720 });
  requireInt(errors, 'advanceBookingDays', next.advanceBookingDays, 'Advance booking', { min: 1, max: 180 });
  requireInt(errors, 'minLeadMinutes', next.minLeadMinutes, 'Lead time', { min: 0, max: 1440 });
  requireInt(errors, 'bufferMinutes', next.bufferMinutes, 'Buffer', { min: 0, max: 60 });
  requireInt(errors, 'holdTtlMinutes', next.holdTtlMinutes, 'Hold time', { min: 5, max: 15 });
  if (next.minDurationMinutes % next.incrementMinutes && next.minDurationMinutes % 30) errors.push({ field: 'minDurationMinutes', message: 'Minimum duration must fit the increment.' });
  if (errors.length) invalid(errors);
  const before = v.settings;
  s.db.update('venues', v.id, (x) => {
    x.settings = next;
  });
  audit(s, { action: 'venue.booking_rules_changed', targetType: 'venue', targetId: v.id, businessId: v.businessId, summary: 'Changed booking rules', before, after: next });
  return s.db.must('venues', v.id);
}

export function addSpecialHours(s: Svc, input: { businessId: Id; venueId: Id; date: string; kind: 'closed' | 'special_hours' | 'holiday_hours'; open?: number; close?: number; reason: string }) {
  requireBusiness(s, input.businessId, 'venues.manage', { venueId: input.venueId, write: true });
  const v = ownVenue(s, input.businessId, input.venueId);
  const errors: FieldError[] = [];
  if (!isLocalDate(input.date)) errors.push({ field: 'date', message: 'Choose a valid date.' });
  const reason = requireText(errors, 'reason', input.reason, 'Reason', { max: 80 });
  if (input.kind !== 'closed' && (input.open === undefined || input.close === undefined || input.close <= input.open)) errors.push({ field: 'close', message: 'Closing time must be after opening time.' });
  if (errors.length) invalid(errors);
  // Existing bookings outside the new hours are flagged (not auto-cancelled): staff decide per booking.
  const dayBookings = s.db.filter('bookings', (b) => b.venueId === v.id && b.status === 'confirmed' && localDate(b.startMs, v.offsetMin) === input.date);
  const conflicts = dayBookings.filter((b) => {
    if (input.kind === 'closed') return true;
    const startMin = localParts(b.startMs, v.offsetMin).minute;
    return startMin < input.open! || startMin + b.durationMinutes > input.close!;
  });
  const existing = s.db.find('specialHours', (x) => x.venueId === v.id && x.date === input.date);
  if (existing) s.db.update('specialHours', existing.id, (x) => Object.assign(x, { kind: input.kind, open: input.open, close: input.close, reason }));
  else s.db.insert('specialHours', { id: newId('sph'), businessId: v.businessId, venueId: v.id, date: input.date, kind: input.kind, ...(input.kind !== 'closed' ? { open: input.open!, close: input.close! } : {}), reason });
  audit(s, { action: 'venue.special_hours_set', targetType: 'venue', targetId: v.id, businessId: v.businessId, summary: `${input.kind === 'closed' ? 'Closure' : 'Special hours'} on ${input.date}: ${reason}` });
  return { conflicts: conflicts.map((b) => ({ bookingId: b.id, code: b.code, when: formatTimeRange(b.startMs, b.endMs, v.offsetMin) })) };
}

export function removeSpecialHours(s: Svc, input: { businessId: Id; specialHoursId: Id }) {
  const sp = s.db.get('specialHours', input.specialHoursId);
  if (!sp || sp.businessId !== input.businessId) fail('NOT_FOUND', 'Not found.');
  requireBusiness(s, input.businessId, 'venues.manage', { venueId: sp.venueId, write: true });
  s.db.remove('specialHours', sp.id);
  audit(s, { action: 'venue.special_hours_removed', targetType: 'venue', targetId: sp.venueId, businessId: sp.businessId, summary: `Removed special hours (${sp.reason})` });
  return { ok: true };
}

export function publishVenue(s: Svc, input: { businessId: Id; venueId: Id; publish: boolean }) {
  const acc = requireBusiness(s, input.businessId, 'venues.manage', { venueId: input.venueId, write: true });
  const v = ownVenue(s, input.businessId, input.venueId);
  if (input.publish) {
    if (acc.business.status !== 'active') fail('CONFLICT', 'Your business must be verified before venues can be published.');
    const courts = s.db.filter('courts', (c) => c.venueId === v.id && c.status === 'active');
    if (!courts.length) fail('CONFLICT', 'Add at least one active court before publishing.');
    if (!s.db.find('pricingRules', (r) => r.venueId === v.id && r.status === 'active' && r.effect.type === 'rate' && !r.courtIds && !Object.keys(r.conditions).length)) fail('CONFLICT', 'Add a standard rate that covers all courts before publishing.');
  }
  s.db.update('venues', v.id, (x) => {
    transition(VENUE_TRANSITIONS, x, input.publish ? 'published' : 'unpublished', s.now, acc.user.id, input.publish ? 'Published' : 'Unpublished', 'venue');
    if (input.publish) x.publishedAt = s.now;
  });
  audit(s, { action: input.publish ? 'venue.published' : 'venue.unpublished', targetType: 'venue', targetId: v.id, businessId: v.businessId, summary: `${input.publish ? 'Published' : 'Unpublished'} ${v.name}` });
  return s.db.must('venues', v.id);
}

export function upsertCourt(s: Svc, input: { businessId: Id; venueId: Id; courtId?: Id; name: string; format: Court['format']; environment: Court['environment']; surface: string; status?: Court['status']; customTags?: string[] }) {
  requireBusiness(s, input.businessId, 'courts.manage', { venueId: input.venueId, write: true });
  const v = ownVenue(s, input.businessId, input.venueId);
  const errors: FieldError[] = [];
  const name = requireText(errors, 'name', input.name, 'Court name', { max: 40 });
  if (!['full', 'half'].includes(input.format)) errors.push({ field: 'format', message: 'Choose full or half court.' });
  if (!['indoor', 'outdoor', 'covered'].includes(input.environment)) errors.push({ field: 'environment', message: 'Choose indoor, outdoor or covered.' });
  if (errors.length) invalid(errors);
  if (input.courtId) {
    const c = s.db.get('courts', input.courtId);
    if (!c || c.venueId !== v.id) fail('NOT_FOUND', 'Court not found.');
    const before = { ...c };
    s.db.update('courts', c.id, (x) => Object.assign(x, { name, format: input.format, environment: input.environment, surface: input.surface.trim(), status: input.status ?? x.status, customTags: (input.customTags ?? x.customTags).slice(0, 6) }));
    audit(s, { action: 'court.updated', targetType: 'court', targetId: c.id, businessId: v.businessId, summary: `Updated ${name}`, before, after: s.db.get('courts', c.id) });
    return s.db.must('courts', c.id);
  }
  const court: Court = { id: newId('crt'), businessId: v.businessId, venueId: v.id, name, format: input.format, environment: input.environment, surface: input.surface.trim() || 'Acrylic hard court', customTags: (input.customTags ?? []).slice(0, 6), status: input.status ?? 'active', sortOrder: s.db.count('courts', (c) => c.venueId === v.id) + 1 };
  s.db.insert('courts', court);
  audit(s, { action: 'court.created', targetType: 'court', targetId: court.id, businessId: v.businessId, summary: `Added ${name} to ${v.name}` });
  return court;
}

export interface BlockConflict {
  kind: 'booking' | 'hold' | 'event' | 'block';
  sourceId: Id;
  label: string;
  when: string;
}

export function blockConflicts(s: Svc, courtId: Id, startMs: number, endMs: number): BlockConflict[] {
  const court = s.db.must('courts', courtId);
  const venue = s.db.must('venues', court.venueId);
  return s.db
    .filter('slots', (x) => x.courtId === courtId && x.status === 'active' && x.startMs < endMs && startMs < x.occupiedEndMs && !(x.kind === 'hold' && x.expiresAt !== null && x.expiresAt <= s.now))
    .map((x) => {
      const b = x.kind === 'booking' || x.kind === 'hold' ? s.db.get('bookings', x.sourceId) : undefined;
      const e = x.kind === 'event' ? s.db.get('events', x.sourceId) : undefined;
      return { kind: x.kind, sourceId: x.sourceId, label: b ? `${b.code}${x.kind === 'hold' ? ' (checkout in progress)' : ''}` : e ? e.name : 'Existing block', when: formatTimeRange(x.startMs, x.endMs, venue.offsetMin) };
    });
}

/**
 * Court block (maintenance, private rental, weather...). Conflicts are returned unless the caller chooses
 * `cancel_and_refund`, which cancels affected bookings with FULL refunds (incl. fees) and releases holds.
 */
export function createCourtBlock(s: Svc, input: { businessId: Id; courtId: Id; startMs: number; endMs: number; reason: CourtBlock['reason']; note?: string; resolution?: 'fail' | 'cancel_and_refund' }) {
  const court = s.db.get('courts', input.courtId);
  if (!court || court.businessId !== input.businessId) fail('NOT_FOUND', 'Court not found.');
  const acc = requireBusiness(s, input.businessId, 'courts.block', { venueId: court.venueId, write: true });
  if (!(input.endMs > input.startMs)) invalid([{ field: 'endMs', message: 'End must be after start.' }]);
  if ((input.endMs - input.startMs) % (15 * MINUTE)) invalid([{ field: 'endMs', message: 'Use 15-minute boundaries.' }]);
  const conflicts = blockConflicts(s, court.id, input.startMs, input.endMs);
  if (conflicts.some((c) => c.kind === 'event' || c.kind === 'block')) fail('CONFLICT', 'This time overlaps an event or another block. Move that first.', { meta: { conflicts } });
  if (conflicts.length && input.resolution !== 'cancel_and_refund') {
    throw new AppError('CONFLICT', `${conflicts.length} booking(s) or checkout(s) overlap this block.`, { meta: { conflicts } });
  }
  if (conflicts.length) {
    if (!acc.perms.has('bookings.cancel')) fail('FORBIDDEN', 'Cancelling affected bookings needs the "Cancel bookings" permission. Ask a manager.');
    for (const c of conflicts) {
      const b = s.db.must('bookings', c.sourceId);
      if (c.kind === 'hold') {
        cancelCheckout(s, b.checkoutId, 'Court became unavailable', acc.user.id);
        notify(s, b.userId, 'booking_updates', { title: 'Your checkout was cancelled', body: 'The court you were checking out just became unavailable (maintenance). If you already paid, you will get a full refund automatically.', link: '#/app/bookings' });
      } else if (b.status === 'confirmed') {
        venueCancelBooking(s, { businessId: input.businessId, bookingId: b.id, reason: 'court_unavailable', note: `Court ${input.reason.replace('_', ' ')}` });
      } else releaseSlot(s, b.slotId, 'Court blocked');
    }
  }
  const venue = s.db.must('venues', court.venueId);
  const blockId = newId('blk');
  const slot = insertSlot(s, { businessId: court.businessId, venueId: court.venueId, courtId: court.id, startMs: input.startMs, endMs: input.endMs, bufferMinutes: 0, kind: 'block', sourceId: blockId, expiresAt: null });
  const block: CourtBlock = { id: blockId, businessId: court.businessId, venueId: court.venueId, courtId: court.id, startMs: input.startMs, endMs: input.endMs, reason: input.reason, note: (input.note ?? '').trim().slice(0, 120), createdBy: acc.user.id, createdAt: s.now, status: 'active', slotId: slot.id };
  s.db.insert('courtBlocks', block);
  audit(s, { action: 'court.blocked', targetType: 'court', targetId: court.id, businessId: court.businessId, summary: `Blocked ${court.name} ${formatDateShort(input.startMs, venue.offsetMin)} ${formatTimeRange(input.startMs, input.endMs, venue.offsetMin)} (${input.reason})${conflicts.length ? `; cancelled ${conflicts.length} with full refund` : ''}` });
  return { block, cancelled: conflicts.length };
}

export function removeCourtBlock(s: Svc, input: { businessId: Id; blockId: Id }) {
  const blk = s.db.get('courtBlocks', input.blockId);
  if (!blk || blk.businessId !== input.businessId) fail('NOT_FOUND', 'Block not found.');
  requireBusiness(s, input.businessId, 'courts.block', { venueId: blk.venueId, write: true });
  s.db.update('courtBlocks', blk.id, (x) => {
    x.status = 'removed';
  });
  releaseSlot(s, blk.slotId, 'Block removed');
  audit(s, { action: 'court.unblocked', targetType: 'court', targetId: blk.courtId, businessId: blk.businessId, summary: 'Removed court block' });
  return { ok: true };
}

export function listCourtBlocks(s: Svc, input: { businessId: Id; venueId?: Id }) {
  requireBusiness(s, input.businessId, 'bookings.view', { venueId: input.venueId ?? null });
  return s.db.filter('courtBlocks', (b) => b.businessId === input.businessId && b.status === 'active' && b.endMs > s.now && (!input.venueId || b.venueId === input.venueId)).sort((a, b) => a.startMs - b.startMs);
}
