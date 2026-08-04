import type { StaffLogisticsSite } from './staff-logistics';

/** Origin site for courier rate cards (same ids as ship-from). */
export type LogisticsOrigin = StaffLogisticsSite;

/** Partners that have editable rate cards (others stay booking-only). */
export const COURIER_RATE_PARTNER_IDS = [
  'st_courier',
  'trackon',
  'delhivery',
] as const;

export type CourierRatePartnerId = (typeof COURIER_RATE_PARTNER_IDS)[number];

export function isCourierRatePartnerId(value: unknown): value is CourierRatePartnerId {
  return typeof value === 'string'
    && (COURIER_RATE_PARTNER_IDS as readonly string[]).includes(value);
}

/**
 * Destination zones for courier rate cards — same 3 buckets as Delivery rules.
 */
export type StCourierZone =
  | 'kerala'
  | 'tamil_nadu_pondy'
  | 'other_states';

export const ST_COURIER_ZONES: StCourierZone[] = [
  'kerala',
  'tamil_nadu_pondy',
  'other_states',
];

export const ST_COURIER_ZONE_LABELS: Record<StCourierZone, string> = {
  kerala: 'Kerala',
  tamil_nadu_pondy: 'Tamil Nadu, Pondy',
  other_states: 'Other states',
};

export function isStCourierZone(value: unknown): value is StCourierZone {
  return typeof value === 'string' && (ST_COURIER_ZONES as readonly string[]).includes(value);
}

/** Per-zone rates: envelope is fixed ₹; box is ₹/kg. */
export interface StCourierZoneRates {
  envelopeFixedInr: number;
  boxPerKgInr: number;
}

/** Per-origin courier rate card (ST / Trackon / Delhivery share this shape). */
export interface StCourierOriginRates {
  /** Volumetric: chargeable = max(actualKg, L*W*H / divisor). */
  volumetricDivisor: number;
  /** When true, box pricing uses chargeable weight (LBH/variable). */
  useChargeableWeight: boolean;
  /**
   * Floor for box chargeable weight (kg). If the parcel is lighter than this,
   * billing uses this weight instead. 0 = no minimum.
   */
  minimumChargeableWeightKg: number;
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
 * Trackon / Delhivery start as ₹0 placeholders until rates are entered.
 */
export interface LogisticsCourierRates {
  st_courier: StCourierRatesByOrigin;
  trackon: StCourierRatesByOrigin;
  delhivery: StCourierRatesByOrigin;
  updatedAt: string;
  updatedBy?: string | null;
}
