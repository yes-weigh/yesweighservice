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
  LogisticsCourierRates,
  StCourierOriginRates,
  StCourierRatesByOrigin,
  StCourierZone,
  StCourierZoneRates,
} from '../types/logistics-courier-rates';
import {
  ST_COURIER_ZONE_LABELS,
  ST_COURIER_ZONES,
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
 * Build zone table from new `zones` shape, or migrate legacy
 * `modeBaseInr` + `perKgInr.kerala` / `tamil_nadu` if present.
 */
function parseZoneTable(data: Record<string, unknown>): Record<StCourierZone, StCourierZoneRates> {
  const zones = {} as Record<StCourierZone, StCourierZoneRates>;
  for (const zone of ST_COURIER_ZONES) {
    zones[zone] = defaultStCourierZoneRates();
  }

  const zonesRaw = data.zones;
  if (zonesRaw && typeof zonesRaw === 'object') {
    const map = zonesRaw as Record<string, unknown>;
    for (const zone of ST_COURIER_ZONES) {
      zones[zone] = parseZoneRates(map[zone]);
    }
    // Legacy key aliases
    if (!map.tamil_nadu_pondy && map.tamil_nadu) {
      zones.tamil_nadu_pondy = parseZoneRates(map.tamil_nadu);
    }
    if (map.karnataka_andhra) {
      const combined = parseZoneRates(map.karnataka_andhra);
      if (!map.karnataka) zones.karnataka = combined;
      if (!map.andhra_pradesh) zones.andhra_pradesh = combined;
    }
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

  for (const zone of ST_COURIER_ZONES) {
    zones[zone] = {
      envelopeFixedInr: envelopeFixed,
      boxPerKgInr: zone === 'kerala'
        ? keralaPerKg
        : zone === 'tamil_nadu_pondy'
          ? tnPerKg
          : 0,
    };
  }
  return zones;
}

function parseOriginRates(raw: unknown): StCourierOriginRates {
  const defaults = defaultStCourierOriginRates();
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;

  return {
    volumetricDivisor: finiteNonNeg(data.volumetricDivisor, DEFAULT_ST_COURIER_VOLUMETRIC_DIVISOR) || DEFAULT_ST_COURIER_VOLUMETRIC_DIVISOR,
    useChargeableWeight: data.useChargeableWeight !== false,
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

export async function saveStCourierOriginRates(
  origin: StaffLogisticsSite,
  rates: StCourierOriginRates,
  updatedBy?: string | null,
): Promise<StCourierOriginRates> {
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
      st_courier: {
        [origin]: normalized,
      },
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );

  return normalized;
}

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
