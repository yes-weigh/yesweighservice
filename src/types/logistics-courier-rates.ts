import type { StaffLogisticsSite } from './staff-logistics';

/** Origin site for courier rate cards (same ids as ship-from). */
export type LogisticsOrigin = StaffLogisticsSite;

/**
 * ST Courier destination zones (rate-table keys).
 * Labels may combine regions (e.g. Tamil Nadu / Pondy).
 */
export type StCourierZone =
  | 'kerala'
  | 'tamil_nadu_pondy'
  | 'karnataka'
  | 'andhra_pradesh'
  | 'mumbai'
  | 'delhi'
  | 'rest_of_india';

export const ST_COURIER_ZONES: StCourierZone[] = [
  'kerala',
  'tamil_nadu_pondy',
  'karnataka',
  'andhra_pradesh',
  'mumbai',
  'delhi',
  'rest_of_india',
];

export const ST_COURIER_ZONE_LABELS: Record<StCourierZone, string> = {
  kerala: 'Kerala',
  tamil_nadu_pondy: 'Tamil Nadu / Pondy',
  karnataka: 'Karnataka',
  andhra_pradesh: 'Andhra Pradesh',
  mumbai: 'Mumbai',
  delhi: 'Delhi',
  rest_of_india: 'Rest of India',
};

export function isStCourierZone(value: unknown): value is StCourierZone {
  return typeof value === 'string' && (ST_COURIER_ZONES as readonly string[]).includes(value);
}

/** Per-zone rates: envelope is fixed ₹; box is ₹/kg. */
export interface StCourierZoneRates {
  envelopeFixedInr: number;
  boxPerKgInr: number;
}

/** Per-origin ST Courier rate card. */
export interface StCourierOriginRates {
  /** Volumetric: chargeable = max(actualKg, L*W*H / divisor). */
  volumetricDivisor: number;
  /** When true, box pricing uses chargeable weight (LBH/variable). */
  useChargeableWeight: boolean;
  fuelSurchargePercent: number;
  /** Destination zone rate table. */
  zones: Record<StCourierZone, StCourierZoneRates>;
}

export interface StCourierRatesByOrigin {
  cochin: StCourierOriginRates;
  head_office: StCourierOriginRates;
}

/**
 * Courier rate cards under appSettings/logisticsCourierRates.
 * Partners beyond ST Courier get slots later with the same origin shape.
 */
export interface LogisticsCourierRates {
  st_courier: StCourierRatesByOrigin;
  updatedAt: string;
  updatedBy?: string | null;
}
