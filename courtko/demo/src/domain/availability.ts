/**
 * Availability (design doc 07). Occupancy comes from `booking_slots`: holds, bookings, blocks and event
 * reservations. Each occupancy covers play time plus the venue's cleanup buffer, and the store enforces the
 * same no-overlap rule as the production exclusion constraint.
 */

import type { FieldError } from './errors.ts';
import { dayOfWeek, localDate, localParts, localToInstant, MINUTE, DAY, formatMinuteOfDay, formatDuration, type LocalDate } from './time.ts';

export interface WeeklyHours {
  /** index 0 = Sunday; null = closed */
  days: ({ open: number; close: number } | null)[];
}

export interface SpecialHours {
  id: string;
  venueId: string;
  date: LocalDate;
  kind: 'closed' | 'special_hours' | 'holiday_hours';
  open?: number;
  close?: number;
  reason: string;
}

export interface BookingSettings {
  incrementMinutes: 30 | 60 | 90;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  advanceBookingDays: number;
  minLeadMinutes: number;
  bufferMinutes: number;
  holdTtlMinutes: number;
  maxActiveHoldsPerUser: number;
  checkInWindowMinutesBefore: number;
  noShowGraceMinutes: number;
  requireCheckIn: boolean;
  /** Changeover between different sports on the same space (net/line conversion). Default 15 min. */
  changeoverMinutes?: number;
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  incrementMinutes: 30,
  minDurationMinutes: 60,
  maxDurationMinutes: 180,
  advanceBookingDays: 30,
  minLeadMinutes: 30,
  bufferMinutes: 0,
  holdTtlMinutes: 10,
  maxActiveHoldsPerUser: 2,
  checkInWindowMinutesBefore: 30,
  noShowGraceMinutes: 15,
  requireCheckIn: false,
};

export interface DaySchedule {
  closed: boolean;
  open: number;
  close: number;
  note: string | null;
}

export function scheduleFor(date: LocalDate, weekly: WeeklyHours, special: readonly SpecialHours[]): DaySchedule {
  const sp = special.find((s) => s.date === date);
  if (sp) {
    if (sp.kind === 'closed') return { closed: true, open: 0, close: 0, note: sp.reason };
    return { closed: false, open: sp.open ?? 360, close: sp.close ?? 1380, note: sp.reason };
  }
  const d = weekly.days[dayOfWeek(date)];
  if (!d) return { closed: true, open: 0, close: 0, note: 'Closed' };
  return { closed: false, open: d.open, close: d.close, note: null };
}

export type OccupancyKind = 'hold' | 'booking' | 'block' | 'event' | 'open_play';

export interface Occupancy {
  id: string;
  courtId: string;
  startMs: number;
  /** end of play (or block) */
  endMs: number;
  /** end including cleanup buffer — the range protected by the no-overlap rule */
  occupiedEndMs: number;
  kind: OccupancyKind;
  sourceId: string;
  label?: string;
  /** Space units occupied (CR-D03). Defaults to the whole court. */
  units?: string[];
  sport?: string;
}

/**
 * `dependent` = this layout is free itself, but a related layout sharing the same space is in use
 * (e.g. a half court while the full court is booked).
 */
export type CellState = 'available' | 'booked' | 'held' | 'blocked' | 'event' | 'open_play' | 'dependent' | 'past' | 'closed' | 'beyond_window';

export interface AvailabilityCell {
  startMs: number;
  endMs: number;
  state: CellState;
  /** Whether a booking of the requested duration can start here. */
  bookable: boolean;
  occupancyId?: string;
  reason?: string;
}

export interface CourtAvailability {
  courtId: string;
  cells: AvailabilityCell[];
  bookableStarts: number;
}

export function occupancyUnits(o: Pick<Occupancy, 'units' | 'courtId'>): string[] {
  return o.units?.length ? o.units : [o.courtId];
}

/**
 * Server-side availability per bookable layout. A layout is occupied by any occupancy that shares at least one
 * space unit (full court ↔ halves, multi-use floors). Different-sport neighbours also need the changeover gap.
 */
export function computeAvailability(input: {
  date: LocalDate;
  offsetMin: number;
  schedule: DaySchedule;
  settings: BookingSettings;
  courtIds: readonly string[];
  /** Space units per layout; defaults to the layout id itself. */
  courtUnits?: Readonly<Record<string, readonly string[]>>;
  courtSports?: Readonly<Record<string, string | undefined>>;
  occupancies: readonly Occupancy[];
  durationMinutes: number;
  now: number;
}): CourtAvailability[] {
  const { schedule, settings } = input;
  const step = settings.incrementMinutes;
  const changeover = (settings.changeoverMinutes ?? 15) * MINUTE;
  const dayStart = localToInstant(input.date, 0, input.offsetMin);
  const lastDate = localDate(input.now + settings.advanceBookingDays * DAY, input.offsetMin);
  const beyond = input.date > lastDate;
  return input.courtIds.map((courtId) => {
    const units = input.courtUnits?.[courtId] ?? [courtId];
    const sport = input.courtSports?.[courtId];
    const occ = input.occupancies.filter((o) => occupancyUnits(o).some((u) => units.includes(u)));
    const gapFor = (o: Occupancy) => (sport && o.sport && o.sport !== sport ? changeover : 0);
    const cells: AvailabilityCell[] = [];
    let bookableStarts = 0;
    if (schedule.closed) return { courtId, cells, bookableStarts };
    for (let m = schedule.open; m + step <= schedule.close; m += step) {
      const startMs = dayStart + m * MINUTE;
      const endMs = startMs + step * MINUTE;
      const hit = occ.find((o) => o.startMs < endMs && startMs < o.endMs);
      let state: CellState = 'available';
      let reason: string | undefined;
      if (hit) {
        const own = hit.courtId === courtId;
        if (hit.kind === 'block') state = 'blocked';
        else if (hit.kind === 'event') state = 'event';
        else if (hit.kind === 'open_play') state = 'open_play';
        else if (!own) {
          state = 'dependent';
          reason = hit.label ?? 'Shared space in use';
        } else state = hit.kind === 'hold' ? 'held' : 'booked';
      } else if (startMs < input.now + settings.minLeadMinutes * MINUTE) state = 'past';
      else if (beyond) state = 'beyond_window';
      let bookable = false;
      if (state === 'available') {
        const bookEnd = startMs + input.durationMinutes * MINUTE;
        const protectedEnd = bookEnd + settings.bufferMinutes * MINUTE;
        const conflict = occ.find((o) => o.startMs - gapFor(o) < protectedEnd && startMs < o.occupiedEndMs + gapFor(o));
        if (m + input.durationMinutes > schedule.close) reason = `Not enough time before closing for ${formatDuration(input.durationMinutes)}`;
        else if (conflict && gapFor(conflict) && !(conflict.startMs < protectedEnd && startMs < conflict.occupiedEndMs)) reason = `Court changeover needs ${Math.round(gapFor(conflict) / MINUTE)} min between different sports`;
        else if (conflict) reason = `Not enough free time for ${formatDuration(input.durationMinutes)}`;
        else bookable = true;
      }
      if (bookable) bookableStarts++;
      cells.push({ startMs, endMs, state, bookable, ...(hit ? { occupancyId: hit.id } : {}), ...(reason ? { reason } : {}) });
    }
    return { courtId, cells, bookableStarts };
  });
}

/** Server-side validation of a requested booking window against venue rules. */
export function validateBookingWindow(input: {
  startMs: number;
  durationMinutes: number;
  offsetMin: number;
  settings: BookingSettings;
  schedule: DaySchedule;
  now: number;
}): FieldError[] {
  const errors: FieldError[] = [];
  const { settings, schedule } = input;
  const p = localParts(input.startMs, input.offsetMin);
  if (input.durationMinutes % settings.incrementMinutes !== 0 && input.durationMinutes % 30 !== 0)
    errors.push({ field: 'durationMinutes', message: `Duration must be in ${settings.incrementMinutes}-minute steps.` });
  if (input.durationMinutes < settings.minDurationMinutes)
    errors.push({ field: 'durationMinutes', message: `The minimum booking is ${formatDuration(settings.minDurationMinutes)}.` });
  if (input.durationMinutes > settings.maxDurationMinutes)
    errors.push({ field: 'durationMinutes', message: `The maximum booking is ${formatDuration(settings.maxDurationMinutes)}.` });
  if (schedule.closed) errors.push({ field: 'startAt', message: `The venue is closed on this date${schedule.note ? ` (${schedule.note})` : ''}.` });
  else {
    if ((p.minute - schedule.open) % settings.incrementMinutes !== 0) errors.push({ field: 'startAt', message: `Start times are every ${settings.incrementMinutes} minutes.` });
    if (p.minute < schedule.open || p.minute + input.durationMinutes > schedule.close)
      errors.push({ field: 'startAt', message: `Bookings must be within opening hours (${formatMinuteOfDay(schedule.open)} – ${formatMinuteOfDay(schedule.close)}).` });
  }
  if (input.startMs < input.now + settings.minLeadMinutes * MINUTE) errors.push({ field: 'startAt', message: `Book at least ${settings.minLeadMinutes} minutes ahead.` });
  if (input.startMs > input.now + settings.advanceBookingDays * DAY) errors.push({ field: 'startAt', message: `You can book up to ${settings.advanceBookingDays} days ahead.` });
  return errors;
}

export function overlaps(a: { startMs: number; occupiedEndMs: number }, b: { startMs: number; occupiedEndMs: number }): boolean {
  return a.startMs < b.occupiedEndMs && b.startMs < a.occupiedEndMs;
}
