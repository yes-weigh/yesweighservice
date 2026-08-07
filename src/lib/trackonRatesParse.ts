import { defaultTrackonConfig } from '../constants/trackonRates';
import type {
  TrackonAirDestinationRates,
  TrackonConfig,
  TrackonNorthDestinationId,
  TrackonNorthSurfaceRates,
  TrackonSharedRules,
  TrackonSouthDestinationId,
  TrackonSouthSurfaceRates,
  TrackonSourceMeta,
  TrackonWeightSlabs,
} from '../types/trackon-rates';
import {
  TRACKON_NORTH_DESTINATION_IDS,
  TRACKON_SOUTH_DESTINATION_IDS,
} from '../types/trackon-rates';

function finiteNonNeg(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function parseSlabs(raw: unknown, fallback: TrackonWeightSlabs): TrackonWeightSlabs {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const data = raw as Record<string, unknown>;
  const upTo250gInr = finiteNonNeg(data.upTo250gInr, fallback.upTo250gInr);
  const upTo500gInr = finiteNonNeg(data.upTo500gInr, fallback.upTo500gInr);
  const upTo1000gInr = finiteNonNeg(data.upTo1000gInr, fallback.upTo1000gInr);
  const defaultAddl = Math.max(0, upTo1000gInr - upTo500gInr);
  return {
    upTo250gInr,
    upTo500gInr,
    upTo1000gInr,
    additionalPer500gInr: finiteNonNeg(data.additionalPer500gInr, defaultAddl),
  };
}

function parseShared(raw: unknown, fallback: TrackonSharedRules): TrackonSharedRules {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const data = raw as Record<string, unknown>;
  return {
    fuelSurchargePercent: finiteNonNeg(data.fuelSurchargePercent, fallback.fuelSurchargePercent),
    volumetricDivisor: finiteNonNeg(data.volumetricDivisor, fallback.volumetricDivisor) || fallback.volumetricDivisor,
    oversizedSideCm: finiteNonNeg(data.oversizedSideCm, fallback.oversizedSideCm) || fallback.oversizedSideCm,
    northernMinimumChargeableKg: finiteNonNeg(
      data.northernMinimumChargeableKg,
      fallback.northernMinimumChargeableKg,
    ),
    southernBulkMinimumKg: finiteNonNeg(
      data.southernBulkMinimumKg,
      fallback.southernBulkMinimumKg,
    ) || fallback.southernBulkMinimumKg,
  };
}

function parseAirDest(
  raw: unknown,
  fallback: TrackonAirDestinationRates,
): TrackonAirDestinationRates {
  return parseSlabs(raw, fallback);
}

function parseNorthSurface(
  raw: unknown,
  fallback: TrackonNorthSurfaceRates,
): TrackonNorthSurfaceRates {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const data = raw as Record<string, unknown>;
  return { perKgInr: finiteNonNeg(data.perKgInr, fallback.perKgInr) };
}

function parseSouthSurface(
  raw: unknown,
  fallback: TrackonSouthSurfaceRates,
): TrackonSouthSurfaceRates {
  const slabs = parseSlabs(raw, fallback);
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const data = raw as Record<string, unknown>;
  return {
    ...slabs,
    bulkPerKgInr: finiteNonNeg(data.bulkPerKgInr, fallback.bulkPerKgInr),
  };
}

function parseSource(raw: unknown): TrackonSourceMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  const dated = typeof data.dated === 'string' ? data.dated.trim() : '';
  if (!label && !dated) return null;
  return {
    label: label || 'Trackon',
    dated: dated || '',
    notes: typeof data.notes === 'string' ? data.notes : undefined,
  };
}

/**
 * Detect legacy ST-shaped Trackon card (`zones.kerala` …) and replace with defaults.
 * Multi-mode config has `air` + `surface` keys.
 */
function isLegacyStTrackonShape(raw: Record<string, unknown>): boolean {
  if (raw.air != null || raw.surface != null || raw.shared != null) return false;
  if (raw.zones != null || raw.cochin != null || raw.head_office != null) return true;
  if (raw.boxPerKgInr != null || raw.envelopeFixedInr != null) return true;
  return false;
}

export function parseTrackonConfig(raw: unknown): TrackonConfig {
  const defaults = defaultTrackonConfig();
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;
  if (isLegacyStTrackonShape(data)) return defaults;

  const shared = parseShared(data.shared, defaults.shared);

  const airRaw = data.air && typeof data.air === 'object'
    ? data.air as Record<string, unknown>
    : {};
  const airDestRaw = airRaw.destinations && typeof airRaw.destinations === 'object'
    ? airRaw.destinations as Record<string, unknown>
    : airRaw;
  const airDestinations = {} as Record<TrackonNorthDestinationId, TrackonAirDestinationRates>;
  for (const id of TRACKON_NORTH_DESTINATION_IDS) {
    airDestinations[id] = parseAirDest(airDestRaw[id], defaults.air.destinations[id]);
  }

  const surfaceRaw = data.surface && typeof data.surface === 'object'
    ? data.surface as Record<string, unknown>
    : {};
  const northRaw = surfaceRaw.northern && typeof surfaceRaw.northern === 'object'
    ? surfaceRaw.northern as Record<string, unknown>
    : {};
  const southRaw = surfaceRaw.southern && typeof surfaceRaw.southern === 'object'
    ? surfaceRaw.southern as Record<string, unknown>
    : {};

  const northern = {} as Record<TrackonNorthDestinationId, TrackonNorthSurfaceRates>;
  for (const id of TRACKON_NORTH_DESTINATION_IDS) {
    northern[id] = parseNorthSurface(northRaw[id], defaults.surface.northern[id]);
  }
  const southern = {} as Record<TrackonSouthDestinationId, TrackonSouthSurfaceRates>;
  for (const id of TRACKON_SOUTH_DESTINATION_IDS) {
    southern[id] = parseSouthSurface(southRaw[id], defaults.surface.southern[id]);
  }

  return {
    shared,
    air: { destinations: airDestinations },
    surface: { northern, southern },
    source: parseSource(data.source) ?? defaults.source,
  };
}

export function trackonConfigsEqual(a: TrackonConfig, b: TrackonConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
