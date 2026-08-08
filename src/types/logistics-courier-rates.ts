import type { BlueDartConfig } from './blue-dart-rates';
import type { TrackonConfig, TrackonServiceId } from './trackon-rates';
import type { StaffLogisticsSite } from './staff-logistics';

export type { BlueDartConfig } from './blue-dart-rates';
export type { TrackonConfig, TrackonServiceId } from './trackon-rates';
export {
  TRACKON_SERVICE_IDS,
  isTrackonServiceId,
} from './trackon-rates';

/** Origin site for courier rate cards (same ids as ship-from). */
export type LogisticsOrigin = StaffLogisticsSite;

/** Partners that have editable rate cards (others stay booking-only). */
export const COURIER_RATE_PARTNER_IDS = [
  'st_courier',
  'trackon',
  'delhivery',
  'bluedart',
] as const;

export type CourierRatePartnerId = (typeof COURIER_RATE_PARTNER_IDS)[number];

export function isCourierRatePartnerId(value: unknown): value is CourierRatePartnerId {
  return typeof value === 'string'
    && (COURIER_RATE_PARTNER_IDS as readonly string[]).includes(value);
}

/** Only ST Courier rates differ by ship-from site. */
export function partnerUsesOriginRates(partnerId: CourierRatePartnerId): boolean {
  return partnerId === 'st_courier';
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

/** Rate card fields (volumetric rules + zone prices). */
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

/** ST Courier only — separate cards per ship-from site. */
export interface StCourierRatesByOrigin {
  cochin: StCourierOriginRates;
  head_office: StCourierOriginRates;
}

/**
 * Blue Dart Zoho freight services (each has its own rate card).
 * SKUs: BDAIR, BDFRC, BDDP.
 */
export const BLUE_DART_SERVICE_IDS = [
  'surface',
  'air',
  'domestic_priority',
] as const;

export type BlueDartServiceId = (typeof BLUE_DART_SERVICE_IDS)[number];

export function isBlueDartServiceId(value: unknown): value is BlueDartServiceId {
  return typeof value === 'string'
    && (BLUE_DART_SERVICE_IDS as readonly string[]).includes(value);
}

export const BLUE_DART_SERVICE_META: Record<BlueDartServiceId, {
  label: string;
  sku: 'BDAIR' | 'BDFRC' | 'BDDP';
}> = {
  air: {
    label: 'Air',
    sku: 'BDAIR',
  },
  surface: {
    label: 'Surface',
    sku: 'BDFRC',
  },
  domestic_priority: {
    label: 'Domestic Priority',
    sku: 'BDDP',
  },
};

/**
 * Courier rate cards under appSettings/logisticsCourierRates.
 * ST is per origin; Delhivery shares one ST-shaped card.
 * Blue Dart + Trackon use dedicated multi-mode tariffs (not ST envelope/box).
 */
export interface LogisticsCourierRates {
  st_courier: StCourierRatesByOrigin;
  trackon: TrackonConfig;
  delhivery: StCourierOriginRates;
  bluedart: BlueDartConfig;
  updatedAt: string;
  updatedBy?: string | null;
}

export const TRACKON_SERVICE_META: Record<TrackonServiceId, {
  label: string;
  sku: 'TRAIR' | 'TRFRC';
}> = {
  air: {
    label: 'Air',
    sku: 'TRAIR',
  },
  surface: {
    label: 'Surface',
    sku: 'TRFRC',
  },
};
