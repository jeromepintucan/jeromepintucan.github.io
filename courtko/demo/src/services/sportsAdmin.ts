/**
 * SuperAdmin-managed sport catalog (doc 24 CR-D01). Changes are versioned and audited. Deactivating a sport
 * hides it from new bookings and Open Play, but never alters existing bookings or registrations.
 */

import { fail, invalid, type FieldError } from '../domain/errors.ts';
import { LAUNCH_SPORTS, type SportConfig } from '../domain/sports.ts';
import { audit, requirePlatform, type Svc } from './svc.ts';

export function publicSports(s: Svc) {
  return s.db
    .filter('sports', (x) => x.status === 'active')
    .sort((a, b) => LAUNCH_SPORTS.indexOf(a.code as never) - LAUNCH_SPORTS.indexOf(b.code as never))
    .map((x) => ({ code: x.code, name: x.name, description: x.description, icon: x.icon, hue: x.hue, formats: x.formats, courtConfigurations: x.courtConfigurations, skillLevels: x.skillLevels, minPlayers: x.minPlayers, maxPlayers: x.maxPlayers, defaultDurationMinutes: x.defaultDurationMinutes, openPlay: x.openPlay, matchResult: x.matchResult, teamRequirement: x.teamRequirement, gameNoun: x.gameNoun }));
}

export function adminSports(s: Svc) {
  requirePlatform(s, 'platform.sports.manage');
  return s.db
    .all('sports')
    .sort((a, b) => LAUNCH_SPORTS.indexOf(a.code as never) - LAUNCH_SPORTS.indexOf(b.code as never))
    .map((sport) => ({
      sport,
      usage: {
        venues: s.db.count('venues', (v) => v.status === 'published' && (v.sports ?? []).includes(sport.code)),
        courts: s.db.count('courts', (c) => c.status === 'active' && (c.sport ?? 'pickleball') === sport.code),
        upcomingBookings: s.db.count('bookings', (b) => (b.sport ?? 'pickleball') === sport.code && b.status === 'confirmed' && b.startMs > s.now),
        openPlay: s.db.count('openPlaySessions', (o) => o.sport === sport.code && (o.status === 'published' || o.status === 'in_progress')),
      },
    }));
}

export function updateSport(
  s: Svc,
  input: { sport: string; name?: string; description?: string; status?: SportConfig['status']; minPlayers?: number; maxPlayers?: number; defaultDurationMinutes?: number; skillLevels?: { code: string; label: string }[]; openPlayEnabled?: boolean; defaultCapacity?: number; defaultGameMinutes?: number; matchResultLabel?: string; matchResultEnabled?: boolean; reason?: string },
) {
  const admin = requirePlatform(s, 'platform.sports.manage', { write: true });
  const sp = s.db.get('sports', input.sport);
  if (!sp) fail('NOT_FOUND', 'Sport not found.');
  const errors: FieldError[] = [];
  if (input.name !== undefined && (input.name.trim().length < 2 || input.name.length > 30)) errors.push({ field: 'name', message: 'Name must be 2–30 characters.' });
  if (input.description !== undefined && input.description.length > 400) errors.push({ field: 'description', message: 'Description is limited to 400 characters.' });
  const min = input.minPlayers ?? sp.minPlayers;
  const max = input.maxPlayers ?? sp.maxPlayers;
  if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min && max <= 40)) errors.push({ field: 'maxPlayers', message: 'Players must be 1–40, and the maximum at least the minimum.' });
  if (input.defaultDurationMinutes !== undefined && !(input.defaultDurationMinutes >= 30 && input.defaultDurationMinutes <= 360 && input.defaultDurationMinutes % 30 === 0)) errors.push({ field: 'defaultDurationMinutes', message: 'Default duration must be 30–360 minutes in 30-minute steps.' });
  if (input.skillLevels !== undefined) {
    if (input.skillLevels.length < 2 || input.skillLevels.length > 8) errors.push({ field: 'skillLevels', message: 'Use 2–8 skill levels.' });
    // Codes are stable identifiers referenced by profiles and sessions; only labels can change here.
    for (const l of input.skillLevels) if (!sp.skillLevels.some((x) => x.code === l.code) || !l.label.trim()) errors.push({ field: 'skillLevels', message: 'Skill level codes are fixed; edit labels only.' });
  }
  if (input.defaultCapacity !== undefined && !(input.defaultCapacity >= 2 && input.defaultCapacity <= 200)) errors.push({ field: 'defaultCapacity', message: 'Default Open Play capacity must be 2–200.' });
  if (input.defaultGameMinutes !== undefined && !(input.defaultGameMinutes >= 5 && input.defaultGameMinutes <= 120)) errors.push({ field: 'defaultGameMinutes', message: 'Game length must be 5–120 minutes.' });
  if (input.status === 'inactive' && sp.status === 'active' && (input.reason ?? '').trim().length < 10) errors.push({ field: 'reason', message: 'Deactivating a sport needs a reason (at least 10 characters).' });
  if (errors.length) invalid(errors);
  const before = structuredClone(sp);
  s.db.update('sports', sp.code, (x) => {
    if (input.name !== undefined) x.name = input.name.trim();
    if (input.description !== undefined) x.description = input.description.trim();
    if (input.status !== undefined) x.status = input.status;
    x.minPlayers = min;
    x.maxPlayers = max;
    if (input.defaultDurationMinutes !== undefined) x.defaultDurationMinutes = input.defaultDurationMinutes;
    if (input.skillLevels !== undefined) x.skillLevels = x.skillLevels.map((l) => ({ ...l, label: input.skillLevels!.find((n) => n.code === l.code)?.label.trim() ?? l.label }));
    if (input.openPlayEnabled !== undefined) x.openPlay = { ...x.openPlay, enabled: input.openPlayEnabled };
    if (input.defaultCapacity !== undefined) x.openPlay = { ...x.openPlay, defaultCapacity: input.defaultCapacity };
    if (input.defaultGameMinutes !== undefined) x.openPlay = { ...x.openPlay, defaultGameMinutes: input.defaultGameMinutes };
    if (input.matchResultLabel !== undefined) x.matchResult = { ...x.matchResult, label: input.matchResultLabel.trim().slice(0, 80) };
    if (input.matchResultEnabled !== undefined) x.matchResult = { ...x.matchResult, enabled: input.matchResultEnabled };
    x.version += 1;
    x.updatedAt = s.now;
    x.updatedBy = admin.id;
  });
  const after = s.db.must('sports', sp.code);
  audit(s, { action: input.status && input.status !== before.status ? `sport.${input.status === 'active' ? 'activated' : 'deactivated'}` : 'sport.updated', targetType: 'sport', targetId: sp.code, summary: `${after.name} catalog v${after.version}${input.status && input.status !== before.status ? ` — ${input.status}` : ''}`, before, after, reason: input.reason?.trim() || null });
  return after;
}
