import type {
  BlueDartAirZone,
  BlueDartConfig,
  BlueDartDomesticPriorityRates,
  BlueDartEdlDistanceRow,
  BlueDartKgServiceRates,
  BlueDartRegion,
  BlueDartSharedRules,
} from '../types/blue-dart-rates';
import { BLUE_DART_AIR_ZONES, BLUE_DART_DP_ZONES, BLUE_DART_REGIONS } from '../types/blue-dart-rates';

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
    gstPercent: 18,
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
      air: 'BDAIR',
      surface: 'BDFRC',
      domestic_priority: 'BDDP',
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

/** Surface Band 13. */
export function defaultBlueDartSurfaceRates(): BlueDartKgServiceRates {
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
