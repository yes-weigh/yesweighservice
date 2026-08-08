/**
 * Trackon (Phoenix Cargo franchise) tariff under appSettings/logisticsCourierRates.trackon.
 *
 * Source: Phoenix Cargo Cochin quotation to Interweighing (27 Feb 2026).
 *
 * ## Services → booking partners / Zoho
 * - air → trackon_air → TRAIR (99381000032106054)
 * - surface → trackon_surface → TRFRC (99381000031675164)
 *
 * ## Modes
 * - Air: flat slabs 250g / 500g / 1kg (+ configurable addl per 500g above 1kg). Northern stations only on the sheet.
 * - Surface north: ₹/kg
 * - Surface south: light slabs to 1kg, then bulk ₹/kg with min payload (4 kg)
 */

export const TRACKON_SERVICE_IDS = ['air', 'surface'] as const;
export type TrackonServiceId = (typeof TRACKON_SERVICE_IDS)[number];

export function isTrackonServiceId(value: unknown): value is TrackonServiceId {
  return typeof value === 'string'
    && (TRACKON_SERVICE_IDS as readonly string[]).includes(value);
}

/** Air / northern surface stations from the top tariff table. */
export const TRACKON_NORTH_DESTINATION_IDS = [
  'mumbai',
  'delhi',
  'andhra_pradesh',
  'kolkata',
  'northern_sectors',
] as const;

export type TrackonNorthDestinationId = (typeof TRACKON_NORTH_DESTINATION_IDS)[number];

/** Southern surface stations from the bottom tariff table. */
export const TRACKON_SOUTH_DESTINATION_IDS = [
  'chennai',
  'bangalore',
  'coimbatore',
  'salem',
  'tamil_nadu',
  'karnataka',
  'kerala',
  'kerala_hilly',
] as const;

export type TrackonSouthDestinationId = (typeof TRACKON_SOUTH_DESTINATION_IDS)[number];

export type TrackonDestinationId =
  | TrackonNorthDestinationId
  | TrackonSouthDestinationId;

export const TRACKON_DESTINATION_LABELS: Record<TrackonDestinationId, string> = {
  mumbai: 'Mumbai',
  delhi: 'Delhi',
  andhra_pradesh: 'Andhra Pradesh',
  kolkata: 'Kolkata',
  northern_sectors: 'Northern Sectors',
  chennai: 'Chennai',
  bangalore: 'Bangalore',
  coimbatore: 'Coimbatore',
  salem: 'Salem',
  tamil_nadu: 'Tamil Nadu',
  karnataka: 'Karnataka',
  kerala: 'Kerala',
  kerala_hilly: 'Wayanad, Idukki, Kasargod',
};

/** Flat air (or southern light-surface) slabs in rupees. */
export interface TrackonWeightSlabs {
  upTo250gInr: number;
  upTo500gInr: number;
  upTo1000gInr: number;
  /**
   * Charged per additional 500 g (or part) above 1 kg.
   * Seeded as (upTo1000 − upTo500) when the sheet omits an add-on.
   */
  additionalPer500gInr: number;
}

export interface TrackonAirDestinationRates extends TrackonWeightSlabs {}

export interface TrackonNorthSurfaceRates {
  perKgInr: number;
}

export interface TrackonSouthSurfaceRates extends TrackonWeightSlabs {
  bulkPerKgInr: number;
}

export interface TrackonSharedRules {
  fuelSurchargePercent: number;
  volumetricDivisor: number;
  /** Any single side above this (cm) doubles volumetric weight. */
  oversizedSideCm: number;
  /** Floor for northern surface ₹/kg billing (0 = no floor beyond ceil kg). */
  northernMinimumChargeableKg: number;
  /** Southern bulk minimum payload (sheet: 4 kg). */
  southernBulkMinimumKg: number;
}

export interface TrackonAirRates {
  destinations: Record<TrackonNorthDestinationId, TrackonAirDestinationRates>;
}

export interface TrackonSurfaceRates {
  northern: Record<TrackonNorthDestinationId, TrackonNorthSurfaceRates>;
  southern: Record<TrackonSouthDestinationId, TrackonSouthSurfaceRates>;
}

export interface TrackonSourceMeta {
  label: string;
  dated: string;
  notes?: string;
}

export interface TrackonConfig {
  shared: TrackonSharedRules;
  air: TrackonAirRates;
  surface: TrackonSurfaceRates;
  source: TrackonSourceMeta | null;
}
