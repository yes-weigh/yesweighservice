/**
 * Default Blue Dart commercials + geo seed (mirrors Excel / tariff images).
 *
 * AGENT: When ops drop new Blue Dart Excels/images:
 * 1. Update numbers in this file (defaults) AND scripts/seed-bluedart-rates.mjs
 *    (keep them in sync — seed does not import TS).
 * 2. If BdService pin file changed: update scripts/extract-bluedart-pincodes.py
 *    SRC path if the filename changed, then re-run npm run seed:bluedart.
 * 3. Prefer seed with --overwrite-rates only when intentionally replacing
 *    admin UI overrides already saved in Firestore.
 * 4. Keep Zoho productIds in sync with src/constants/freightLines.ts.
 * See header on src/types/blue-dart-rates.ts for Firestore layout.
 */
import type {
  BlueDartAirZone,
  BlueDartConfig,
  BlueDartDomesticPriorityRates,
  BlueDartEdlDistanceRow,
  BlueDartKgServiceRates,
  BlueDartOversizeSlab,
  BlueDartRegion,
  BlueDartSharedRules,
  BlueDartSurfaceRates,
} from '../types/blue-dart-rates';
import { BLUE_DART_AIR_ZONES, BLUE_DART_DP_ZONES, BLUE_DART_REGIONS } from '../types/blue-dart-rates';

/** Default Surface oversize: under 32 kg → 0% (add higher ceilings in Settings). */
export const DEFAULT_BLUE_DART_OVERSIZE_SLABS: BlueDartOversizeSlab[] = [
  { upToKg: 32, percent: 0 },
];

/** Normalize, dedupe by upToKg (last wins), sort ascending. Empty → default under 32 kg / 0%. */
export function normalizeBlueDartOversizeSlabs(raw: unknown): BlueDartOversizeSlab[] {
  const list = Array.isArray(raw) ? raw : [];
  const byUpTo = new Map<number, number>();
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const record = row as { upToKg?: unknown; minKg?: unknown; percent?: unknown };
    /** Accept legacy minKg (old “from kg” field) as upToKg. */
    const upToKg = Number(record.upToKg ?? record.minKg);
    const percent = Number(record.percent);
    if (!Number.isFinite(upToKg) || upToKg <= 0) continue;
    if (!Number.isFinite(percent) || percent < 0) continue;
    byUpTo.set(Math.round(upToKg * 1000) / 1000, percent);
  }
  if (byUpTo.size === 0) return DEFAULT_BLUE_DART_OVERSIZE_SLABS.map(s => ({ ...s }));
  return [...byUpTo.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([upToKg, percent]) => ({ upToKg, percent }));
}

/**
 * First slab where chargeable kg is under upToKg.
 * If weight is at/above every ceiling, use the last slab’s %.
 */
export function resolveBlueDartOversizePercent(
  slabs: BlueDartOversizeSlab[] | unknown,
  chargeableKg: number,
): number {
  const kg = typeof chargeableKg === 'number' && Number.isFinite(chargeableKg) ? chargeableKg : 0;
  const list = normalizeBlueDartOversizeSlabs(slabs);
  for (const slab of list) {
    if (kg < slab.upToKg) return slab.percent;
  }
  return list[list.length - 1]?.percent ?? 0;
}

/** Surface Band 13 volumetric: (L×B×H)/27000 CFT × 6 kg = LBH/4500. */
export const BLUE_DART_SURFACE_VOLUMETRIC_DIVISOR = 4500;
export const BLUE_DART_AIR_VOLUMETRIC_DIVISOR = 5000;
export const BLUE_DART_DP_VOLUMETRIC_DIVISOR = 5000;

/** State aliases → region (keys must match normalizeBlueDartPlace). */
export function defaultBlueDartRegionsByState(): Record<string, BlueDartRegion> {
  const map: Record<string, BlueDartRegion> = {};
  const add = (region: BlueDartRegion, names: string[]) => {
    for (const name of names) map[name] = region;
  };
  add('NORTH', [
    'himachal pradesh', 'hp', 'punjab', 'haryana', 'uttarakhand', 'uttaranchal',
    'uttar pradesh', 'up', 'rajasthan', 'delhi', 'nct of delhi', 'chandigarh',
  ]);
  add('EAST', [
    'bihar', 'orissa', 'odisha', 'west bengal', 'jharkhand',
  ]);
  add('WEST', [
    'maharashtra', 'madhya pradesh', 'mp', 'gujarat', 'gujrat',
    'chhattisgarh', 'chattisgarh', 'goa', 'diu daman', 'daman diu',
    'dadra nagar haveli', 'dadra and nagar haveli and daman and diu',
  ]);
  add('SOUTH', [
    'karnataka', 'tamil nadu', 'tamilnadu', 'tn', 'kerala', 'kl',
    'andhra pradesh', 'andhra pradesh', 'telangana', 'pondicherry',
    'puducherry', 'pondy', 'py',
  ]);
  add('NE', [
    'nagaland', 'mizoram', 'manipur', 'meghalaya', 'arunachal pradesh',
    'tripura', 'sikkim', 'assam',
  ]);
  add('JK', [
    'jammu', 'kashmir', 'ladakh', 'jammu and kashmir', 'jammu kashmir',
    'jammukashmir', 'jk',
  ]);
  return map;
}

/** Origin × dest → Zone 1–5 (from Blue Dart regional zoning matrix). */
export function defaultBlueDartZoneMatrix(): Record<
  BlueDartRegion,
  Record<BlueDartRegion, BlueDartAirZone>
> {
  const row = (
    north: BlueDartAirZone,
    east: BlueDartAirZone,
    west: BlueDartAirZone,
    south: BlueDartAirZone,
    ne: BlueDartAirZone,
    jk: BlueDartAirZone,
  ): Record<BlueDartRegion, BlueDartAirZone> => ({
    NORTH: north,
    EAST: east,
    WEST: west,
    SOUTH: south,
    NE: ne,
    JK: jk,
  });
  return {
    NORTH: row(1, 3, 2, 3, 5, 2),
    EAST: row(3, 1, 3, 4, 2, 5),
    WEST: row(2, 3, 1, 2, 5, 5),
    SOUTH: row(3, 4, 2, 1, 5, 5),
    NE: row(5, 2, 5, 5, 1, 5),
    JK: row(2, 5, 5, 5, 5, 1),
  };
}

export function defaultBlueDartEdlMatrix(): BlueDartEdlDistanceRow[] {
  return [
    { distanceKmMin: 20, distanceKmMax: 50, amountsInr: [550, 990, 1100, 1375, 1650] },
    { distanceKmMin: 51, distanceKmMax: 100, amountsInr: [825, 1210, 1375, 1650, 1925] },
    { distanceKmMin: 101, distanceKmMax: 150, amountsInr: [1100, 1650, 1925, 2200, 2750] },
    { distanceKmMin: 151, distanceKmMax: 200, amountsInr: [1375, 1925, 2200, 2475, 3300] },
    { distanceKmMin: 201, distanceKmMax: 250, amountsInr: [1650, 2200, 2750, 3300, 3960] },
    { distanceKmMin: 250, distanceKmMax: 300, amountsInr: [1925, 2500, 3150, 3800, 4560] },
    { distanceKmMin: 300, distanceKmMax: 350, amountsInr: [2200, 2800, 3550, 4300, 5160] },
    { distanceKmMin: 350, distanceKmMax: 400, amountsInr: [2475, 3100, 3950, 4800, 5760] },
    { distanceKmMin: 400, distanceKmMax: 450, amountsInr: [2750, 3400, 4350, 5300, 6360] },
    { distanceKmMin: 450, distanceKmMax: 500, amountsInr: [3025, 3700, 4750, 5800, 6960] },
  ];
}

export function defaultBlueDartSharedRules(): BlueDartSharedRules {
  return {
    fuelSurchargePercent: 92,
    cafPercent: 22,
    gstPercent: 0,
    originRegion: 'SOUTH',
    edlMode: 'flat_fallback',
    edlFlatFallbackInr: 0,
    edlNeJkPerKgInr: 15,
    edlNeJkFloorInr: 3000,
    edlBeyond500KmPerKmInr: 14,
    edlBeyond1500KgPerKgInr: 5,
    hideTemPer: true,
    rasPerKgInr: 3,
    rasStates: [
      'bihar',
      'jharkhand',
      'kerala',
      'jammu',
      'kashmir',
      'ladakh',
      'jammu and kashmir',
    ],
    fov: { minInr: 90, percentOfInvoice: 0.05 },
    regionsByState: defaultBlueDartRegionsByState(),
    zoneMatrix: defaultBlueDartZoneMatrix(),
    edlMatrix: defaultBlueDartEdlMatrix(),
    productIds: {
      air: '99381000031970648',
      surface: '99381000031970559',
      domestic_priority: '99381000031970625',
    },
  };
}

/** Apex / Air Express Package rates (Aug 2026 sheet). */
export function defaultBlueDartAirRates(): BlueDartKgServiceRates {
  return {
    perKgInr: { 1: 32, 2: 45, 3: 50, 4: 65, 5: 70 },
    minimumChargeableWeightKg: 10,
    minimumFreightInr: 260,
    docketFeeInr: 100,
    volumetricDivisor: BLUE_DART_AIR_VOLUMETRIC_DIVISOR,
    fuelSurchargePercent: null,
    cafPercent: null,
    idcPercent: 5,
    efssPercent: 10,
    pssPercent: 5,
    rasPerKgInr: null,
    fov: null,
  };
}

/** Surface Band 13. Festival season defaults to Oct→Jan (wraps year). */
export function defaultBlueDartSurfaceRates(): BlueDartSurfaceRates {
  return {
    perKgInr: { 1: 8, 2: 9, 3: 11, 4: 12, 5: 19 },
    minimumChargeableWeightKg: 10,
    minimumFreightInr: 160,
    docketFeeInr: 100,
    volumetricDivisor: BLUE_DART_SURFACE_VOLUMETRIC_DIVISOR,
    fuelSurchargePercent: null,
    cafPercent: null,
    idcPercent: 0,
    efssPercent: 0,
    pssPercent: 0,
    rasPerKgInr: null,
    fov: null,
    festivalSurchargePercent: 0,
    festivalSeasonStartMonth: 10,
    festivalSeasonEndMonth: 1,
    oversizeSlabs: DEFAULT_BLUE_DART_OVERSIZE_SLABS.map(s => ({ ...s })),
  };
}

/** Domestic Priority slabs. */
export function defaultBlueDartDomesticPriorityRates(): BlueDartDomesticPriorityRates {
  return {
    first500gInr: { A1: 28, A: 36, B: 41, C: 46 },
    addl500gInr: { A1: 28, A: 36, B: 41, C: 46 },
    volumetricDivisor: BLUE_DART_DP_VOLUMETRIC_DIVISOR,
    fuelSurchargePercent: null,
    cafPercent: null,
    idcPercent: 5,
    efssPercent: 10,
    pssPercent: 5,
  };
}

export function defaultBlueDartConfig(): BlueDartConfig {
  return {
    shared: defaultBlueDartSharedRules(),
    air: defaultBlueDartAirRates(),
    surface: defaultBlueDartSurfaceRates(),
    domestic_priority: defaultBlueDartDomesticPriorityRates(),
    source: null,
  };
}

export function blueDartConfigHasAnyRate(config: BlueDartConfig): boolean {
  const airOk = BLUE_DART_AIR_ZONES.some(z => config.air.perKgInr[z] > 0);
  const sfcOk = BLUE_DART_AIR_ZONES.some(z => config.surface.perKgInr[z] > 0);
  const dpOk = BLUE_DART_DP_ZONES.some(z => (
    config.domestic_priority.first500gInr[z] > 0
    || config.domestic_priority.addl500gInr[z] > 0
  ));
  return airOk || sfcOk || dpOk;
}

export { BLUE_DART_REGIONS };
