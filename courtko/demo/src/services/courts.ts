/**
 * Physical courts, space units and bookable layouts (doc 24 CR-D03).
 *
 * A physical court is the real floor. It is split into space units (e.g. half A / half B). Each bookable layout
 * ("court configuration") plays one sport and occupies one or more units, so the store's no-overlap rule keyed on
 * units automatically makes a full-court booking block both halves, a half-court booking block the full court,
 * and a basketball/volleyball floor bookable for only one sport at a time.
 */

import type { LayoutKind, SportCode, SportConfig } from '../domain/sports.ts';
import type { Court, Id, PhysicalCourt } from './model.ts';

export interface LayoutSpec {
  sport: SportCode;
  layout: LayoutKind;
  label: string;
  unitNames: string[];
  capacity: number;
}

export function unitKey(physicalCourtId: Id, unit: string): string {
  return `${physicalCourtId}:${unit}`;
}

/**
 * Default layouts for a physical court given its sports and units:
 *  - basketball: full court on all units, plus one half court per unit when the floor has two units;
 *  - volleyball: one full court on all units;
 *  - tennis: one court on all units;
 *  - pickleball: one court on all units, or — on a tennis court with two units — one pickleball court per unit
 *    (two pickleball courts drawn on one tennis court, convertible at set times).
 */
export function defaultLayouts(physical: Pick<PhysicalCourt, 'sports' | 'unitNames'>, sports: readonly SportConfig[]): LayoutSpec[] {
  const units = physical.unitNames.length ? physical.unitNames : ['main'];
  const split = units.length > 1;
  const cfg = (code: string) => sports.find((x) => x.code === code);
  const out: LayoutSpec[] = [];
  for (const sport of physical.sports) {
    const c = cfg(sport);
    if (!c) continue;
    if (sport === 'basketball') {
      out.push({ sport, layout: 'full', label: 'Full court', unitNames: units, capacity: 20 });
      if (split) for (const u of units) out.push({ sport, layout: 'half', label: `Half court ${u}`, unitNames: [u], capacity: 10 });
    } else if (sport === 'volleyball') {
      out.push({ sport, layout: 'full', label: 'Volleyball court', unitNames: units, capacity: 18 });
    } else if (sport === 'pickleball' && split && physical.sports.includes('tennis')) {
      units.forEach((u, i) => out.push({ sport, layout: 'standard', label: `Pickleball ${String.fromCharCode(65 + i)}`, unitNames: [u], capacity: 4 }));
    } else {
      out.push({ sport, layout: c.courtConfigurations.some((x) => x.code === 'full') ? 'full' : 'standard', label: c.courtConfigurations[0]?.label ?? c.name, unitNames: units, capacity: c.maxPlayers });
    }
  }
  return out;
}

/** Display name for a layout: single-layout courts keep the court name; others add the layout label. */
export function layoutName(physical: Pick<PhysicalCourt, 'name'>, spec: LayoutSpec, totalLayouts: number): string {
  return totalLayouts <= 1 ? physical.name : `${physical.name} · ${spec.label}`;
}

export function layoutRow(physical: PhysicalCourt, spec: LayoutSpec, totalLayouts: number, id: Id, sortOrder: number): Court {
  return {
    id,
    businessId: physical.businessId,
    venueId: physical.venueId,
    name: layoutName(physical, spec, totalLayouts),
    format: spec.layout === 'half' ? 'half' : 'full',
    environment: physical.environment,
    surface: physical.surface,
    customTags: [],
    status: physical.status,
    sortOrder,
    physicalCourtId: physical.id,
    sport: spec.sport,
    layout: spec.layout,
    layoutLabel: spec.label,
    units: spec.unitNames.map((u) => unitKey(physical.id, u)),
    capacity: spec.capacity,
  };
}

/** Which other layouts each layout blocks when booked (used by the "dependency preview" in Courts & layouts). */
export function dependencyMap(layouts: readonly Court[]): Record<Id, Id[]> {
  const out: Record<Id, Id[]> = {};
  for (const a of layouts) {
    out[a.id] = layouts.filter((b) => b.id !== a.id && (a.units ?? [a.id]).some((u) => (b.units ?? [b.id]).includes(u))).map((b) => b.id);
  }
  return out;
}
