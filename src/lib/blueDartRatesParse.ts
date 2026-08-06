import {
  defaultBlueDartAirRates,
  defaultBlueDartConfig,
  defaultBlueDartDomesticPriorityRates,
  defaultBlueDartEdlMatrix,
  defaultBlueDartRegionsByState,
  defaultBlueDartSharedRules,
  defaultBlueDartSurfaceRates,
  defaultBlueDartZoneMatrix,
  normalizeBlueDartOversizeSlabs,
} from '../constants/blueDartRates';
import type {
  BlueDartAirZone,
  BlueDartConfig,
  BlueDartDomesticPriorityRates,
  BlueDartDpZone,
  BlueDartEdlDistanceRow,
  BlueDartEdlMode,
  BlueDartFovRule,
  BlueDartKgServiceRates,
  BlueDartRegion,
  BlueDartSharedRules,
  BlueDartSourceMeta,
  BlueDartSurfaceRates,
} from '../types/blue-dart-rates';
import {
  BLUE_DART_AIR_ZONES,
  BLUE_DART_DP_ZONES,
  BLUE_DART_REGIONS,
  isBlueDartAirZone,
  isBlueDartEdlMode,
  isBlueDartRegion,
} from '../types/blue-dart-rates';

function finiteNonNeg(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function finiteNonNegOrNull(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseFov(raw: unknown, fallback: BlueDartFovRule): BlueDartFovRule {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const data = raw as Record<string, unknown>;
  return {
    minInr: finiteNonNeg(data.minInr, fallback.minInr),
    percentOfInvoice: finiteNonNeg(data.percentOfInvoice, fallback.percentOfInvoice),
  };
}

function parseAirZoneTable(
  raw: unknown,
  fallback: Record<BlueDartAirZone, number>,
): Record<BlueDartAirZone, number> {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  const map = raw as Record<string, unknown>;
  for (const z of BLUE_DART_AIR_ZONES) {
    const v = map[String(z)] ?? map[z];
    out[z] = finiteNonNeg(typeof v === 'number' ? v : Number(v), fallback[z]);
  }
  return out;
}

function parseDpZoneTable(
  raw: unknown,
  fallback: Record<BlueDartDpZone, number>,
): Record<BlueDartDpZone, number> {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  const map = raw as Record<string, unknown>;
  for (const z of BLUE_DART_DP_ZONES) {
    out[z] = finiteNonNeg(map[z], fallback[z]);
  }
  return out;
}

function parseEdlMatrix(raw: unknown): BlueDartEdlDistanceRow[] {
  const defaults = defaultBlueDartEdlMatrix();
  if (!Array.isArray(raw) || !raw.length) return defaults;
  const rows: BlueDartEdlDistanceRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const data = item as Record<string, unknown>;
    const amountsRaw = Array.isArray(data.amountsInr) ? data.amountsInr : [];
    const amounts = [0, 1, 2, 3, 4].map(i => finiteNonNeg(Number(amountsRaw[i]), 0)) as [
      number, number, number, number, number,
    ];
    rows.push({
      distanceKmMin: finiteNonNeg(data.distanceKmMin, 0),
      distanceKmMax: finiteNonNeg(data.distanceKmMax, 0),
      amountsInr: amounts,
    });
  }
  return rows.length ? rows : defaults;
}

function parseZoneMatrix(raw: unknown): BlueDartSharedRules['zoneMatrix'] {
  const defaults = defaultBlueDartZoneMatrix();
  if (!raw || typeof raw !== 'object') return defaults;
  const out = { ...defaults };
  const map = raw as Record<string, unknown>;
  for (const origin of BLUE_DART_REGIONS) {
    const rowRaw = map[origin];
    if (!rowRaw || typeof rowRaw !== 'object') continue;
    const row = { ...defaults[origin] };
    const rowMap = rowRaw as Record<string, unknown>;
    for (const dest of BLUE_DART_REGIONS) {
      const v = Number(rowMap[dest]);
      if (isBlueDartAirZone(v)) row[dest] = v;
    }
    out[origin] = row;
  }
  return out;
}

function parseRegionsByState(raw: unknown): Record<string, BlueDartRegion> {
  const defaults = defaultBlueDartRegionsByState();
  if (!raw || typeof raw !== 'object') return defaults;
  const out: Record<string, BlueDartRegion> = { ...defaults };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isBlueDartRegion(value)) out[String(key).trim().toLowerCase()] = value;
  }
  return out;
}

function parseShared(raw: unknown): BlueDartSharedRules {
  const defaults = defaultBlueDartSharedRules();
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;
  const edlMode: BlueDartEdlMode = isBlueDartEdlMode(data.edlMode)
    ? data.edlMode
    : defaults.edlMode;
  /** Ship-from is always SOUTH (Kerala warehouses) — not configurable. */
  const originRegion: BlueDartRegion = 'SOUTH';
  const productIdsRaw = data.productIds && typeof data.productIds === 'object'
    ? data.productIds as Record<string, unknown>
    : {};
  const rasStates = Array.isArray(data.rasStates)
    ? data.rasStates.map(s => String(s)).filter(Boolean)
    : defaults.rasStates;

  return {
    fuelSurchargePercent: finiteNonNeg(data.fuelSurchargePercent, defaults.fuelSurchargePercent),
    cafPercent: finiteNonNeg(data.cafPercent, defaults.cafPercent),
    /** Always 0 — Blue Dart freight is quoted ex-GST; tax is on the SO. */
    gstPercent: 0,
    originRegion,
    edlMode,
    edlFlatFallbackInr: finiteNonNeg(data.edlFlatFallbackInr, defaults.edlFlatFallbackInr),
    edlNeJkPerKgInr: finiteNonNeg(data.edlNeJkPerKgInr, defaults.edlNeJkPerKgInr),
    edlNeJkFloorInr: finiteNonNeg(data.edlNeJkFloorInr, defaults.edlNeJkFloorInr),
    edlBeyond500KmPerKmInr: finiteNonNeg(
      data.edlBeyond500KmPerKmInr,
      defaults.edlBeyond500KmPerKmInr,
    ),
    edlBeyond1500KgPerKgInr: finiteNonNeg(
      data.edlBeyond1500KgPerKgInr,
      defaults.edlBeyond1500KgPerKgInr,
    ),
    hideTemPer: data.hideTemPer !== false,
    rasPerKgInr: finiteNonNeg(data.rasPerKgInr, defaults.rasPerKgInr),
    rasStates,
    fov: parseFov(data.fov, defaults.fov),
    regionsByState: parseRegionsByState(data.regionsByState),
    zoneMatrix: parseZoneMatrix(data.zoneMatrix),
    edlMatrix: parseEdlMatrix(data.edlMatrix),
    productIds: {
      air: typeof productIdsRaw.air === 'string' && productIdsRaw.air.trim()
        ? productIdsRaw.air.trim()
        : defaults.productIds.air,
      surface: typeof productIdsRaw.surface === 'string' && productIdsRaw.surface.trim()
        ? productIdsRaw.surface.trim()
        : defaults.productIds.surface,
      domestic_priority: typeof productIdsRaw.domestic_priority === 'string'
        && productIdsRaw.domestic_priority.trim()
        ? productIdsRaw.domestic_priority.trim()
        : defaults.productIds.domestic_priority,
    },
  };
}

function clampMonth(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  if (n < 1 || n > 12) return fallback;
  return n;
}

function parseKgService(raw: unknown, defaults: BlueDartKgServiceRates): BlueDartKgServiceRates {
  if (!raw || typeof raw !== 'object') return { ...defaults, perKgInr: { ...defaults.perKgInr } };
  const data = raw as Record<string, unknown>;
  return {
    perKgInr: parseAirZoneTable(data.perKgInr ?? data.zones, defaults.perKgInr),
    minimumChargeableWeightKg: finiteNonNeg(
      data.minimumChargeableWeightKg,
      defaults.minimumChargeableWeightKg,
    ),
    minimumFreightInr: finiteNonNeg(data.minimumFreightInr, defaults.minimumFreightInr),
    docketFeeInr: finiteNonNeg(data.docketFeeInr, defaults.docketFeeInr),
    volumetricDivisor: finiteNonNeg(data.volumetricDivisor, defaults.volumetricDivisor) || defaults.volumetricDivisor,
    fuelSurchargePercent: finiteNonNegOrNull(data.fuelSurchargePercent),
    cafPercent: finiteNonNegOrNull(data.cafPercent),
    idcPercent: finiteNonNeg(data.idcPercent, defaults.idcPercent),
    efssPercent: finiteNonNeg(data.efssPercent, defaults.efssPercent),
    pssPercent: finiteNonNeg(data.pssPercent, defaults.pssPercent),
    rasPerKgInr: finiteNonNegOrNull(data.rasPerKgInr),
    fov: data.fov == null ? null : parseFov(data.fov, { minInr: 90, percentOfInvoice: 0.05 }),
  };
}

function parseSurfaceService(raw: unknown): BlueDartSurfaceRates {
  const defaults = defaultBlueDartSurfaceRates();
  const base = parseKgService(raw, defaults);
  if (!raw || typeof raw !== 'object') return { ...defaults, ...base, perKgInr: { ...base.perKgInr } };
  const data = raw as Record<string, unknown>;
  return {
    ...base,
    /** Surface never uses CAF; diesel FS is stored on fuelSurchargePercent. */
    cafPercent: null,
    /** Surface tariff has no IDC (Air/DP only). */
    idcPercent: 0,
    festivalSurchargePercent: finiteNonNeg(
      data.festivalSurchargePercent,
      defaults.festivalSurchargePercent,
    ),
    festivalSeasonStartMonth: clampMonth(
      data.festivalSeasonStartMonth,
      defaults.festivalSeasonStartMonth,
    ),
    festivalSeasonEndMonth: clampMonth(
      data.festivalSeasonEndMonth,
      defaults.festivalSeasonEndMonth,
    ),
    oversizeSlabs: normalizeBlueDartOversizeSlabs(
      data.oversizeSlabs ?? defaults.oversizeSlabs,
    ),
    dieselB2bDiscountPercent: Math.min(
      100,
      finiteNonNeg(data.dieselB2bDiscountPercent, defaults.dieselB2bDiscountPercent),
    ),
    eccPerShipmentInr: finiteNonNeg(data.eccPerShipmentInr, defaults.eccPerShipmentInr),
  };
}

function parseDp(raw: unknown): BlueDartDomesticPriorityRates {
  const defaults = defaultBlueDartDomesticPriorityRates();
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;
  return {
    first500gInr: parseDpZoneTable(data.first500gInr, defaults.first500gInr),
    addl500gInr: parseDpZoneTable(data.addl500gInr, defaults.addl500gInr),
    volumetricDivisor: finiteNonNeg(data.volumetricDivisor, defaults.volumetricDivisor)
      || defaults.volumetricDivisor,
    fuelSurchargePercent: finiteNonNegOrNull(data.fuelSurchargePercent),
    cafPercent: finiteNonNegOrNull(data.cafPercent),
    idcPercent: finiteNonNeg(data.idcPercent, defaults.idcPercent),
    efssPercent: finiteNonNeg(data.efssPercent, defaults.efssPercent),
    pssPercent: finiteNonNeg(data.pssPercent, defaults.pssPercent),
  };
}

function parseSource(raw: unknown): BlueDartSourceMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  return {
    importedAt: typeof data.importedAt === 'string' ? data.importedAt : '',
    bandLabel: typeof data.bandLabel === 'string' ? data.bandLabel : '',
    files: Array.isArray(data.files) ? data.files.map(String) : [],
  };
}

/** True when payload is the new BlueDartConfig shape (has shared or perKg tables). */
export function isBlueDartConfigShape(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const data = raw as Record<string, unknown>;
  if (data.shared != null && typeof data.shared === 'object') return true;
  const air = data.air;
  if (air && typeof air === 'object' && (air as Record<string, unknown>).perKgInr != null) {
    return true;
  }
  const surface = data.surface;
  if (surface && typeof surface === 'object' && (surface as Record<string, unknown>).perKgInr != null) {
    return true;
  }
  const dp = data.domestic_priority;
  if (dp && typeof dp === 'object' && (dp as Record<string, unknown>).first500gInr != null) {
    return true;
  }
  return false;
}

export function parseBlueDartConfig(raw: unknown): BlueDartConfig {
  const defaults = defaultBlueDartConfig();
  if (!raw || typeof raw !== 'object') return defaults;

  // Legacy ST-shaped Blue Dart cards → keep seeded tariff defaults (ignore envelope/box).
  if (!isBlueDartConfigShape(raw)) {
    return defaults;
  }

  const data = raw as Record<string, unknown>;
  return {
    shared: parseShared(data.shared),
    air: parseKgService(data.air, defaultBlueDartAirRates()),
    surface: parseSurfaceService(data.surface),
    domestic_priority: parseDp(data.domestic_priority),
    source: parseSource(data.source),
  };
}

export function blueDartConfigsEqual(a: BlueDartConfig, b: BlueDartConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
