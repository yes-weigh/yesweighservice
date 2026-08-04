import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_ST_COURIER_VOLUMETRIC_DIVISOR,
  defaultLogisticsCourierRates,
  defaultStCourierOriginRates,
  defaultStCourierZoneRates,
  LOGISTICS_COURIER_RATES_DOC_ID,
} from '../constants/logisticsCourierRates';
import {
  STAFF_LOGISTICS_SITES,
  isStaffLogisticsSite,
  type StaffLogisticsSite,
} from '../types/staff-logistics';
import type {
  CourierRatePartnerId,
  LogisticsCourierRates,
  StCourierOriginRates,
  StCourierRatesByOrigin,
  StCourierZone,
  StCourierZoneRates,
} from '../types/logistics-courier-rates';
import {
  COURIER_RATE_PARTNER_IDS,
  ST_COURIER_ZONE_LABELS,
  ST_COURIER_ZONES,
  isCourierRatePartnerId,
  isStCourierZone,
} from '../types/logistics-courier-rates';

function finiteNonNeg(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function parseZoneRates(raw: unknown): StCourierZoneRates {
  const defaults = defaultStCourierZoneRates();
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;
  return {
    envelopeFixedInr: finiteNonNeg(data.envelopeFixedInr, defaults.envelopeFixedInr),
    boxPerKgInr: finiteNonNeg(data.boxPerKgInr, defaults.boxPerKgInr),
  };
}

/**
 * Build the 3-zone table from `zones`, migrating legacy multi-zone / flat shapes.
 */
function parseZoneTable(data: Record<string, unknown>): Record<StCourierZone, StCourierZoneRates> {
  const zones = {} as Record<StCourierZone, StCourierZoneRates>;
  for (const zone of ST_COURIER_ZONES) {
    zones[zone] = defaultStCourierZoneRates();
  }

  const zonesRaw = data.zones;
  if (zonesRaw && typeof zonesRaw === 'object') {
    const map = zonesRaw as Record<string, unknown>;
    zones.kerala = parseZoneRates(map.kerala);
    zones.tamil_nadu_pondy = parseZoneRates(
      map.tamil_nadu_pondy ?? map.tamil_nadu,
    );
    // Prefer explicit other_states; else legacy rest_of_india / metro leftovers.
    zones.other_states = parseZoneRates(
      map.other_states
      ?? map.rest_of_india
      ?? map.mumbai
      ?? map.delhi
      ?? map.karnataka
      ?? map.andhra_pradesh,
    );
    return zones;
  }

  // Legacy flat mode base + 2-zone per-kg
  const modeRaw = data.modeBaseInr && typeof data.modeBaseInr === 'object'
    ? data.modeBaseInr as Record<string, unknown>
    : {};
  const perKgRaw = data.perKgInr && typeof data.perKgInr === 'object'
    ? data.perKgInr as Record<string, unknown>
    : {};
  const envelopeFixed = finiteNonNeg(modeRaw.envelope, 0);
  const keralaPerKg = finiteNonNeg(perKgRaw.kerala, 0);
  const tnPerKg = finiteNonNeg(perKgRaw.tamil_nadu ?? perKgRaw.tamil_nadu_pondy, 0);

  zones.kerala = { envelopeFixedInr: envelopeFixed, boxPerKgInr: keralaPerKg };
  zones.tamil_nadu_pondy = { envelopeFixedInr: envelopeFixed, boxPerKgInr: tnPerKg };
  zones.other_states = { envelopeFixedInr: envelopeFixed, boxPerKgInr: 0 };
  return zones;
}

function parseOriginRates(raw: unknown): StCourierOriginRates {
  const defaults = defaultStCourierOriginRates();
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;

  return {
    volumetricDivisor: finiteNonNeg(data.volumetricDivisor, DEFAULT_ST_COURIER_VOLUMETRIC_DIVISOR) || DEFAULT_ST_COURIER_VOLUMETRIC_DIVISOR,
    useChargeableWeight: data.useChargeableWeight !== false,
    minimumChargeableWeightKg: finiteNonNeg(
      data.minimumChargeableWeightKg,
      defaults.minimumChargeableWeightKg,
    ),
    fuelSurchargePercent: finiteNonNeg(data.fuelSurchargePercent, defaults.fuelSurchargePercent),
    zones: parseZoneTable(data),
  };
}

function parseStCourierRates(raw: unknown): StCourierRatesByOrigin {
  const defaults = defaultLogisticsCourierRates().st_courier;
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;
  return {
    cochin: parseOriginRates(data.cochin),
    head_office: parseOriginRates(data.head_office),
  };
}

export function parseLogisticsCourierRates(data: Record<string, unknown> | undefined): LogisticsCourierRates {
  const defaults = defaultLogisticsCourierRates();
  if (!data) return defaults;
  return {
    st_courier: parseStCourierRates(data.st_courier),
    trackon: parseStCourierRates(data.trackon),
    delhivery: parseStCourierRates(data.delhivery),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

export async function loadLogisticsCourierRates(): Promise<LogisticsCourierRates> {
  try {
    const snap = await getDoc(doc(db, 'appSettings', LOGISTICS_COURIER_RATES_DOC_ID));
    if (!snap.exists()) return defaultLogisticsCourierRates();
    return parseLogisticsCourierRates(snap.data() as Record<string, unknown>);
  } catch {
    return defaultLogisticsCourierRates();
  }
}

export async function saveCourierOriginRates(
  partner: CourierRatePartnerId,
  origin: StaffLogisticsSite,
  rates: StCourierOriginRates,
  updatedBy?: string | null,
): Promise<StCourierOriginRates> {
  if (!isCourierRatePartnerId(partner)) {
    throw new Error('Select a valid courier partner.');
  }
  if (!isStaffLogisticsSite(origin)) {
    throw new Error('Select a valid logistics origin.');
  }

  const normalized = parseOriginRates(rates);
  if (normalized.volumetricDivisor <= 0) {
    throw new Error('Volumetric divisor must be greater than zero.');
  }

  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_COURIER_RATES_DOC_ID),
    {
      [partner]: {
        [origin]: normalized,
      },
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );

  return normalized;
}

/** @deprecated Use saveCourierOriginRates('st_courier', …) */
export async function saveStCourierOriginRates(
  origin: StaffLogisticsSite,
  rates: StCourierOriginRates,
  updatedBy?: string | null,
): Promise<StCourierOriginRates> {
  return saveCourierOriginRates('st_courier', origin, rates, updatedBy);
}

export { COURIER_RATE_PARTNER_IDS, isCourierRatePartnerId };

export async function saveStCourierRatesByOrigin(
  byOrigin: StCourierRatesByOrigin,
  updatedBy?: string | null,
): Promise<StCourierRatesByOrigin> {
  const normalized: StCourierRatesByOrigin = {
    cochin: parseOriginRates(byOrigin.cochin),
    head_office: parseOriginRates(byOrigin.head_office),
  };

  for (const site of STAFF_LOGISTICS_SITES) {
    if (normalized[site].volumetricDivisor <= 0) {
      throw new Error(`Volumetric divisor for ${site} must be greater than zero.`);
    }
  }

  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_COURIER_RATES_DOC_ID),
    {
      st_courier: normalized,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );

  return normalized;
}

export function stCourierZoneLabel(zone: StCourierZone): string {
  return ST_COURIER_ZONE_LABELS[zone] ?? zone;
}

export { isStCourierZone };
