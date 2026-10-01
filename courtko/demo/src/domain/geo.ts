/** Geospatial helpers (production uses PostGIS geography + ST_DWithin; see design doc 11). */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Approximate distance label; never implies more precision than the location permits. */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(0.1, Math.round(km * 10) / 10).toFixed(1)} km`;
  if (km < 10) return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * Data minimization (doc 15): precise device coordinates are rounded to 3 decimals (~110 m) before use
 * and are never persisted.
 */
export function coarsen(p: LatLng, decimals = 3): LatLng {
  const f = 10 ** decimals;
  return { lat: Math.round(p.lat * f) / f, lng: Math.round(p.lng * f) / f };
}

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** Rough bounding box of the Philippines, used to sanity-check venue pins. */
export function isInPhilippines(p: LatLng): boolean {
  return p.lat >= 4.2 && p.lat <= 21.5 && p.lng >= 116.0 && p.lng <= 127.2;
}
