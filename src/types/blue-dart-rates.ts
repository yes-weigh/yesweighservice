/**
 * Blue Dart tariff + geo/EDL rules (Firestore appSettings/logisticsCourierRates.bluedart).
 * Distinct from ST Courier envelope/box zone cards.
 */

export const BLUE_DART_REGIONS = [
  'NORTH',
  'EAST',
  'WEST',
  'SOUTH',
  'NE',
  'JK',
] as const;

export type BlueDartRegion = (typeof BLUE_DART_REGIONS)[number];

export function isBlueDartRegion(value: unknown): value is BlueDartRegion {
  return typeof value === 'string'
    && (BLUE_DART_REGIONS as readonly string[]).includes(value);
}

export const BLUE_DART_AIR_ZONES = [1, 2, 3, 4, 5] as const;
export type BlueDartAirZone = (typeof BLUE_DART_AIR_ZONES)[number];

export function isBlueDartAirZone(value: unknown): value is BlueDartAirZone {
  return typeof value === 'number'
    && (BLUE_DART_AIR_ZONES as readonly number[]).includes(value);
}

export const BLUE_DART_DP_ZONES = ['A1', 'A', 'B', 'C'] as const;
export type BlueDartDpZone = (typeof BLUE_DART_DP_ZONES)[number];

export function isBlueDartDpZone(value: unknown): value is BlueDartDpZone {
  return typeof value === 'string'
    && (BLUE_DART_DP_ZONES as readonly string[]).includes(value);
}

export const BLUE_DART_EDL_MODES = [
  'off',
  'ne_jk_only',
  'flat_fallback',
  'matrix_when_km',
] as const;

export type BlueDartEdlMode = (typeof BLUE_DART_EDL_MODES)[number];

export function isBlueDartEdlMode(value: unknown): value is BlueDartEdlMode {
  return typeof value === 'string'
    && (BLUE_DART_EDL_MODES as readonly string[]).includes(value);
}

/** Pin serviceability codes from BdService workbook. */
export const BLUE_DART_SERVICEABILITY = [
  'Yes',
  'No',
  'EDL',
  'TEM',
  'PER',
] as const;

export type BlueDartServiceability = (typeof BLUE_DART_SERVICEABILITY)[number];

export function isBlueDartServiceability(value: unknown): value is BlueDartServiceability {
  return typeof value === 'string'
    && (BLUE_DART_SERVICEABILITY as readonly string[]).includes(value);
}

export interface BlueDartFovRule {
  minInr: number;
  /** Percent of invoice value (e.g. 0.05 = 0.05%). */
  percentOfInvoice: number;
}

/** One EDL distance row × weight-band amounts (₹). */
export interface BlueDartEdlDistanceRow {
  distanceKmMin: number;
  distanceKmMax: number;
  /** Amounts for weight bands: 0-100, 101-250, 251-500, 501-1000, 1001-1500 kg. */
  amountsInr: [number, number, number, number, number];
}

export const BLUE_DART_EDL_WEIGHT_BAND_LABELS = [
  '0–100 kg',
  '101–250 kg',
  '251–500 kg',
  '501–1000 kg',
  '1001–1500 kg',
] as const;

/** Shared geo / surcharge / gap-fill fields (one panel in Settings). */
export interface BlueDartSharedRules {
  fuelSurchargePercent: number;
  cafPercent: number;
  gstPercent: number;
  originRegion: BlueDartRegion;
  edlMode: BlueDartEdlMode;
  /** Used when pin is EDL and hub-km unknown (mode flat_fallback / matrix_when_km). */
  edlFlatFallbackInr: number;
  edlNeJkPerKgInr: number;
  edlNeJkFloorInr: number;
  edlBeyond500KmPerKmInr: number;
  edlBeyond1500KgPerKgInr: number;
  /** When true, TEM/PER pins omit the service from quotes. */
  hideTemPer: boolean;
  rasPerKgInr: number;
  /** Display/canonical state names that attract RAS. */
  rasStates: string[];
  fov: BlueDartFovRule;
  /**
   * Normalized state key → region.
   * Keys are lowercase alphanumeric (see normalizeBlueDartPlace).
   */
  regionsByState: Record<string, BlueDartRegion>;
  /** Origin region → dest region → Air/Surface zone 1–5. */
  zoneMatrix: Record<BlueDartRegion, Record<BlueDartRegion, BlueDartAirZone>>;
  edlMatrix: BlueDartEdlDistanceRow[];
  productIds: {
    air: string;
    surface: string;
    domestic_priority: string;
  };
}

/** Air / Surface ₹/kg zone card. */
export interface BlueDartKgServiceRates {
  perKgInr: Record<BlueDartAirZone, number>;
  minimumChargeableWeightKg: number;
  minimumFreightInr: number;
  docketFeeInr: number;
  volumetricDivisor: number;
  /** null/undefined → use shared.fuelSurchargePercent */
  fuelSurchargePercent: number | null;
  cafPercent: number | null;
  idcPercent: number;
  efssPercent: number;
  pssPercent: number;
  rasPerKgInr: number | null;
  fov: BlueDartFovRule | null;
}

/** Domestic Priority 500g slab card. */
export interface BlueDartDomesticPriorityRates {
  first500gInr: Record<BlueDartDpZone, number>;
  addl500gInr: Record<BlueDartDpZone, number>;
  volumetricDivisor: number;
  fuelSurchargePercent: number | null;
  cafPercent: number | null;
  idcPercent: number;
  efssPercent: number;
  pssPercent: number;
}

export interface BlueDartSourceMeta {
  importedAt: string;
  bandLabel: string;
  files: string[];
}

/** Full Blue Dart block under logisticsCourierRates.bluedart */
export interface BlueDartConfig {
  shared: BlueDartSharedRules;
  air: BlueDartKgServiceRates;
  surface: BlueDartKgServiceRates;
  domestic_priority: BlueDartDomesticPriorityRates;
  source: BlueDartSourceMeta | null;
}

/** Firestore blueDartPincodes/{pincode} */
export interface BlueDartPincodeDoc {
  pincode: string;
  region: string;
  state: string;
  area: string;
  areaDesc: string;
  hubCode: string;
  dpService: BlueDartServiceability | string;
  dpZone: 'A' | 'B' | 'C' | '';
  apxService: BlueDartServiceability | string;
  sfcService: BlueDartServiceability | string;
  edlApx: boolean;
  edlSfc: boolean;
  /** Optional km from nearest hub — enables EDL matrix when present. */
  edlKm: number | null;
  apxLocIb: string;
  sfcLocIb: string;
}

export const BLUE_DART_PINCODES_COLLECTION = 'blueDartPincodes';
