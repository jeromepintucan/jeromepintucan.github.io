/**
 * Public discovery (no sign-in required): venue search with optional, permission-based location,
 * venue details, and location suggestions. Precise coordinates are used per request only and never stored.
 */

import { computeAvailability, scheduleFor } from '../domain/availability.ts';
import { fail } from '../domain/errors.ts';
import { coarsen, haversineKm, isValidLatLng, type LatLng } from '../domain/geo.ts';
import { describePolicy, POLICY_LIBRARY } from '../domain/policy.ts';
import { RULE_KIND_LABEL } from '../domain/pricing.ts';
import { DAY, addDays, formatMinuteOfDay, localDate, localToInstant, DOW_SHORT } from '../domain/time.ts';
import { occupanciesFor } from './booking.ts';
import { productStock } from './inventory.ts';
import type { Id, Venue } from './model.ts';
import { describeRule } from './pricingSvc.ts';
import { displayName, settings, type Svc } from './svc.ts';
import type { Db } from './store.ts';

export function startingRate(db: Db, venueId: Id): number | null {
  const rates = db.filter('pricingRules', (r) => r.venueId === venueId && r.status === 'active' && r.effect.type === 'rate' && !r.conditions.holidaysOnly).map((r) => (r.effect.type === 'rate' ? r.effect.ratePerHour : 0));
  return rates.length ? Math.min(...rates) : null;
}

export function nextAvailable(db: Db, venue: Venue, now: number): { startMs: number; courtName: string } | null {
  const courts = db.filter('courts', (c) => c.venueId === venue.id && c.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder);
  const today = localDate(now, venue.offsetMin);
  for (const date of [today, addDays(today, 1), addDays(today, 2)]) {
    const schedule = scheduleFor(date, venue.hours, db.filter('specialHours', (x) => x.venueId === venue.id));
    const dayStart = localToInstant(date, 0, venue.offsetMin);
    const grid = computeAvailability({ date, offsetMin: venue.offsetMin, schedule, settings: venue.settings, courtIds: courts.map((c) => c.id), occupancies: occupanciesFor(db, venue.id, dayStart, dayStart + DAY, now), durationMinutes: venue.settings.minDurationMinutes, now });
    let best: { startMs: number; courtName: string } | null = null;
    for (const g of grid) {
      const cell = g.cells.find((c) => c.bookable);
      if (cell && (!best || cell.startMs < best.startMs)) best = { startMs: cell.startMs, courtName: courts.find((c) => c.id === g.courtId)!.name };
    }
    if (best) return best;
  }
  return null;
}

export interface VenueSearchInput {
  q?: string;
  near?: LatLng | null;
  radiusKm?: number;
  environment?: 'indoor' | 'outdoor' | 'covered' | '';
  amenities?: string[];
  minRating?: number;
  maxPrice?: number;
  hasEvents?: boolean;
  date?: string;
  startMinute?: number;
  sort?: 'recommended' | 'distance' | 'price' | 'rating' | 'next';
}

export function searchVenues(s: Svc, input: VenueSearchInput) {
  const near = input.near && isValidLatLng(input.near) ? coarsen(input.near) : null;
  const q = (input.q ?? '').trim().toLowerCase();
  const favorites = new Set(s.actor.user ? s.db.filter('favorites', (f) => f.userId === s.actor.user!.id).map((f) => f.venueId) : []);
  const rows = s.db
    .filter('venues', (v) => v.status === 'published' && s.db.get('businesses', v.businessId)?.status === 'active')
    .map((v) => {
      const courts = s.db.filter('courts', (c) => c.venueId === v.id && c.status === 'active');
      const distanceKm = near ? haversineKm(near, v.geo) : null;
      const eventsCount = s.db.count('events', (e) => e.venueId === v.id && e.status === 'published' && e.visibility === 'public' && e.endMs > s.now);
      return {
        venue: v,
        businessName: s.db.get('businesses', v.businessId)?.tradeName ?? '',
        courts: courts.length,
        environments: [...new Set(courts.map((c) => c.environment))],
        distanceKm,
        fromRate: startingRate(s.db, v.id),
        next: nextAvailable(s.db, v, s.now),
        eventsCount,
        favorite: favorites.has(v.id),
      };
    })
    .filter((r) => {
      const v = r.venue;
      if (q && ![v.name, v.address.city, v.address.barangay, v.address.province, v.address.landmark ?? '', r.businessName, v.tagline].some((t) => t.toLowerCase().includes(q))) return false;
      if (near && input.radiusKm && r.distanceKm !== null && r.distanceKm > input.radiusKm) return false;
      if (input.environment && !r.environments.includes(input.environment)) return false;
      if (input.amenities?.length && !input.amenities.every((a) => v.amenities.includes(a))) return false;
      if (input.minRating && v.ratingAvg < input.minRating) return false;
      if (input.maxPrice && (r.fromRate ?? Infinity) > input.maxPrice) return false;
      if (input.hasEvents && r.eventsCount === 0) return false;
      return true;
    });
  const sort = input.sort ?? (near ? 'distance' : 'recommended');
  rows.sort((a, b) => {
    switch (sort) {
      case 'distance':
        return (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9);
      case 'price':
        return (a.fromRate ?? 1e12) - (b.fromRate ?? 1e12);
      case 'rating':
        return b.venue.ratingAvg - a.venue.ratingAvg || b.venue.ratingCount - a.venue.ratingCount;
      case 'next':
        return (a.next?.startMs ?? 9e15) - (b.next?.startMs ?? 9e15);
      default:
        // Recommended: rating weighted by review volume, then availability. No paid placement.
        return b.venue.ratingAvg * Math.log10(10 + b.venue.ratingCount) - a.venue.ratingAvg * Math.log10(10 + a.venue.ratingCount) || (a.next?.startMs ?? 9e15) - (b.next?.startMs ?? 9e15);
    }
  });
  return { rows, usedLocation: !!near };
}

export function venueDetail(s: Svc, input: { slug: string }) {
  const venue = s.db.find('venues', (v) => v.slug === input.slug);
  if (!venue || (venue.status !== 'published' && !canPreview(s, venue))) fail('NOT_FOUND', 'Venue not found.');
  const business = s.db.must('businesses', venue.businessId);
  const courts = s.db.filter('courts', (c) => c.venueId === venue.id && c.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder);
  const rules = s.db.filter('pricingRules', (r) => r.venueId === venue.id && r.status === 'active').sort((a, b) => a.priority - b.priority);
  const amenityLabels = new Map(settings(s.db).amenities.map((a) => [a.code, a.label]));
  const rates = rules.map((r) => {
    const c = r.conditions;
    const parts: string[] = [];
    if (c.daysOfWeek?.length) parts.push(c.daysOfWeek.length === 5 && !c.daysOfWeek.includes(0) && !c.daysOfWeek.includes(6) ? 'Mon–Fri' : c.daysOfWeek.length === 2 && c.daysOfWeek.includes(0) && c.daysOfWeek.includes(6) ? 'Sat–Sun' : c.daysOfWeek.map((d) => DOW_SHORT[d]).join(', '));
    if (c.startMinute !== undefined || c.endMinute !== undefined) parts.push(`${formatMinuteOfDay(c.startMinute ?? 0)}–${formatMinuteOfDay(c.endMinute ?? 1440)}`);
    if (c.holidaysOnly) parts.push('Public holidays');
    if (c.dateFrom || c.dateTo) parts.push(`${c.dateFrom ?? '…'} to ${c.dateTo ?? '…'}`);
    const courtNames = r.courtIds ? courts.filter((ct) => r.courtIds!.includes(ct.id)).map((ct) => ct.name).join(', ') : 'All courts';
    return { name: r.name, kind: RULE_KIND_LABEL[r.kind], when: parts.join(' · ') || 'Anytime', courts: courtNames, price: describeRule(r) };
  });
  const products = s.db
    .filter('products', (p) => p.venueId === venue.id && p.status === 'active')
    .map((p) => ({ product: p, available: productStock(s.db, p).available }));
  const events = s.db.filter('events', (e) => e.venueId === venue.id && e.status === 'published' && e.visibility === 'public' && e.endMs > s.now).sort((a, b) => a.startMs - b.startMs);
  const reviews = s.db
    .filter('reviews', (r) => r.venueId === venue.id && r.status === 'published')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 12)
    .map((r) => ({ review: r, author: displayName(s.db, r.userId) }));
  const policy = POLICY_LIBRARY[venue.policyKey];
  return {
    venue,
    business: { tradeName: business.tradeName, vatRegistered: business.vatRegistered },
    courts,
    amenities: venue.amenities.map((a) => amenityLabels.get(a) ?? a),
    rates,
    fromRate: startingRate(s.db, venue.id),
    products,
    events,
    reviews,
    policy: { name: policy.name, version: policy.version, lines: describePolicy(policy) },
    next: nextAvailable(s.db, venue, s.now),
    favorite: s.actor.user ? !!s.db.get('favorites', `${s.actor.user.id}:${venue.id}`) : false,
    preview: venue.status !== 'published',
  };
}

function canPreview(s: Svc, venue: Venue): boolean {
  const u = s.actor.user;
  if (!u) return false;
  return !!s.db.find('members', (m) => m.businessId === venue.businessId && m.userId === u.id && m.status === 'active');
}

/** Location suggestions for manual search (city, municipality, barangay, landmark). */
export function searchLocations(s: Svc, input: { q: string }) {
  const q = (input.q ?? '').trim().toLowerCase();
  if (q.length < 2) return [];
  const out = new Map<string, { label: string; kind: string; query: string }>();
  for (const v of s.db.filter('venues', (x) => x.status === 'published')) {
    const cands: [string, string][] = [
      [v.address.city, 'City / municipality'],
      [`${v.address.barangay}, ${v.address.city}`, 'Barangay'],
      [v.address.landmark ?? '', 'Landmark'],
      [v.address.province, 'Province'],
    ];
    for (const [label, kind] of cands) {
      if (label && label.toLowerCase().includes(q) && !out.has(label)) out.set(label, { label, kind, query: label.split(',')[0]! });
    }
  }
  return [...out.values()].slice(0, 8);
}
