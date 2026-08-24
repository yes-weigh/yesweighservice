import { lookupShippingPortCoords } from './shipping-port-coords';

export type LatLon = { lat: number; lon: number };

function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Typical Asia → west-coast India sea lane (Malacca, south of Sri Lanka). */
export function seaRouteWaypoints(from: LatLon, to: LatLon): LatLon[] {
  const points: LatLon[] = [from];
  const eastAsia = from.lon > 108;
  const malacca = from.lon > 95 && from.lon <= 108;
  const indiaWest = to.lon < 90 && to.lat < 25;

  if ((eastAsia || malacca) && indiaWest) {
    if (eastAsia) {
      points.push({ lat: 22.2, lon: 118.8 });
      points.push({ lat: 14.0, lon: 112.4 });
      points.push({ lat: 5.6, lon: 105.4 });
      points.push({ lat: 1.35, lon: 104.0 });
    }
    if (from.lon > 102 || eastAsia) {
      points.push({ lat: 2.9, lon: 100.6 });
    }
    points.push({ lat: 5.4, lon: 97.4 });
    points.push({ lat: 6.0, lon: 88.0 });
    points.push({ lat: 5.85, lon: 80.15 });
    if (to.lon < 78 && to.lat >= 8) {
      points.push({ lat: 8.15, lon: 76.75 });
    }
  }

  points.push(to);
  return points;
}

function routeLengths(points: LatLon[]): { lengths: number[]; totalKm: number } {
  const lengths = [0];
  let totalKm = 0;
  for (let i = 1; i < points.length; i += 1) {
    totalKm += haversineKm(points[i - 1], points[i]);
    lengths.push(totalKm);
  }
  return { lengths, totalKm };
}

export function interpolateRoute(points: LatLon[], t: number): LatLon {
  if (points.length === 0) return { lat: 0, lon: 0 };
  if (points.length === 1) return points[0];
  const clamped = Math.max(0, Math.min(1, t));
  const { lengths, totalKm } = routeLengths(points);
  if (totalKm <= 0) return points[points.length - 1];
  const target = clamped * totalKm;
  for (let i = 1; i < points.length; i += 1) {
    if (lengths[i] >= target) {
      const span = lengths[i] - lengths[i - 1];
      const u = span <= 0 ? 1 : (target - lengths[i - 1]) / span;
      const a = points[i - 1];
      const b = points[i];
      return {
        lat: a.lat + (b.lat - a.lat) * u,
        lon: a.lon + (b.lon - a.lon) * u,
      };
    }
  }
  return points[points.length - 1];
}

/** POL → ship (sailed) and ship → POD (remaining). */
export function splitRouteAtProgress(
  points: LatLon[],
  t: number,
): { ship: LatLon; traveled: LatLon[]; remaining: LatLon[] } {
  const ship = interpolateRoute(points, t);
  if (points.length < 2) {
    return { ship, traveled: [ship], remaining: [ship] };
  }
  const clamped = Math.max(0, Math.min(1, t));
  const { lengths, totalKm } = routeLengths(points);
  if (totalKm <= 0) {
    const end = points[points.length - 1];
    return { ship: end, traveled: points, remaining: [end] };
  }
  const target = clamped * totalKm;
  for (let i = 1; i < points.length; i += 1) {
    if (lengths[i] >= target) {
      return {
        ship,
        traveled: [...points.slice(0, i), ship],
        remaining: [ship, ...points.slice(i)],
      };
    }
  }
  const end = points[points.length - 1];
  return { ship: end, traveled: points, remaining: [end] };
}

function closestPointOnSegment(p: LatLon, a: LatLon, b: LatLon): { t: number; distKm: number } {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  const u = len2 <= 0
    ? 0
    : Math.max(0, Math.min(1, ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / len2));
  return {
    t: u,
    distKm: haversineKm(p, { lat: a.lat + u * dy, lon: a.lon + u * dx }),
  };
}

/** 0–1 progress of the nearest point on the planned sea lane to a live AIS position. */
export function nearestProgressOnRoute(points: LatLon[], live: LatLon): number {
  if (points.length < 2) return 0;
  const { lengths, totalKm } = routeLengths(points);
  if (totalKm <= 0) return 0;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  for (let i = 1; i < points.length; i += 1) {
    const span = lengths[i] - lengths[i - 1];
    const { t, distKm } = closestPointOnSegment(live, points[i - 1], points[i]);
    if (distKm < bestDist) {
      bestDist = distKm;
      bestAlong = lengths[i - 1] + t * span;
    }
  }
  return Math.max(0, Math.min(1, bestAlong / totalKm));
}

export function routeDistanceNm(points: LatLon[]): number {
  return routeLengths(points).totalKm / 1.852;
}

export function voyagePlannedSpeedKnots(
  distanceNm: number,
  etd: string | null | undefined,
  eta: string | null | undefined,
): number | null {
  const start = ymdUtcMs(etd);
  const end = ymdUtcMs(eta);
  if (start == null || end == null || end <= start || distanceNm <= 0) return null;
  const hours = (end - start) / 3_600_000;
  if (hours <= 0) return null;
  return distanceNm / hours;
}

function ymdUtcMs(value: string | null | undefined): number | null {
  const ymd = String(value ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const ms = Date.parse(`${ymd}T12:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function voyageProgressBetweenDates(
  etd: string | null | undefined,
  eta: string | null | undefined,
  now = Date.now(),
): number {
  const start = ymdUtcMs(etd);
  const end = ymdUtcMs(eta);
  if (start == null || end == null || end <= start) return 0.45;
  if (now <= start) return 0.02;
  if (now >= end) return 0.98;
  return (now - start) / (end - start);
}

/** Whole days from ETD to ETA (voyage duration). */
export function voyageTransitDays(
  etd: string | null | undefined,
  eta: string | null | undefined,
): number | null {
  const start = ymdUtcMs(etd);
  const end = ymdUtcMs(eta);
  if (start == null || end == null || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

/** Whole days from ETD until now (time already at sea). */
export function voyageElapsedDays(
  etd: string | null | undefined,
  now = Date.now(),
): number | null {
  const start = ymdUtcMs(etd);
  if (start == null) return null;
  return Math.max(0, Math.round((now - start) / 86_400_000));
}

/** Remaining steaming days at the live speed. */
export function voyageSteamingDays(remainingNm: number, sogKn: number | null | undefined): number | null {
  if (!(remainingNm > 0) || sogKn == null || sogKn < 0.3) return null;
  return Math.max(0, Math.round(remainingNm / sogKn / 24));
}

/** Whole local calendar days from today until ETA (0 if already due). */
export function voyageDaysUntilEta(
  eta: string | null | undefined,
  now = Date.now(),
): number | null {
  const ymd = String(eta ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split('-').map(Number);
  const etaNoon = new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
  if (!Number.isFinite(etaNoon)) return null;
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((etaNoon - today.getTime()) / 86_400_000));
}

export function resolveVoyagePorts(
  portOfLoading?: string | null,
  portOfDischarge?: string | null,
): { load: LatLon; discharge: LatLon } | null {
  const load = lookupShippingPortCoords(portOfLoading);
  const discharge = lookupShippingPortCoords(portOfDischarge || 'Cochin');
  if (!load || !discharge) return null;
  return { load, discharge };
}

export function prettyPortName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  if (/^nigbo$/i.test(trimmed)) return 'Ningbo';
  if (/jawaharlal|nehru port|\bjnpt\b/i.test(trimmed)) return 'Nhava Sheva';
  return trimmed.replace(/\b([a-z])/g, letter => letter.toUpperCase());
}
