import { defaultBlueDartConfig } from './blueDartRates';
import { defaultTrackonConfig } from './trackonRates';
import type {
  LogisticsCourierRates,
  StCourierOriginRates,
  StCourierRatesByOrigin,
  StCourierZone,
  StCourierZoneRates,
} from '../types/logistics-courier-rates';
import {
  COURIER_RATE_PARTNER_IDS,
  ST_COURIER_ZONES,
} from '../types/logistics-courier-rates';

export const LOGISTICS_COURIER_RATES_DOC_ID = 'logisticsCourierRates';

export const DEFAULT_ST_COURIER_VOLUMETRIC_DIVISOR = 5000;

export function defaultStCourierZoneRates(): StCourierZoneRates {
  return {
    envelopeFixedInr: 0,
    boxPerKgInr: 0,
  };
}

export function defaultStCourierZoneTable(): Record<StCourierZone, StCourierZoneRates> {
  const zones = {} as Record<StCourierZone, StCourierZoneRates>;
  for (const zone of ST_COURIER_ZONES) {
    zones[zone] = defaultStCourierZoneRates();
  }
  return zones;
}

export function defaultStCourierOriginRates(): StCourierOriginRates {
  return {
    volumetricDivisor: DEFAULT_ST_COURIER_VOLUMETRIC_DIVISOR,
    useChargeableWeight: true,
    minimumChargeableWeightKg: 0,
    fuelSurchargePercent: 0,
    zones: defaultStCourierZoneTable(),
  };
}

export function defaultStCourierRatesByOrigin(): StCourierRatesByOrigin {
  return {
    cochin: defaultStCourierOriginRates(),
    head_office: defaultStCourierOriginRates(),
  };
}

export function defaultLogisticsCourierRates(): LogisticsCourierRates {
  return {
    st_courier: defaultStCourierRatesByOrigin(),
    trackon: defaultTrackonConfig(),
    delhivery: defaultStCourierOriginRates(),
    bluedart: defaultBlueDartConfig(),
    updatedAt: '',
    updatedBy: null,
  };
}

export { COURIER_RATE_PARTNER_IDS, defaultBlueDartConfig, defaultTrackonConfig };
