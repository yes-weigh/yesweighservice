import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_ST_COURIER_VOLUMETRIC_DIVISOR,
  defaultLogisticsCourierRates,
  defaultStCourierOriginRates,
  defaultStCourierZoneRates,
  LOGISTICS_COURIER_RATES_DOC_ID,
} from '../constants/logisticsCourierRates';
import { defaultBlueDartConfig } from '../constants/blueDartRates';
import { defaultTrackonConfig } from '../constants/trackonRates';
import {
  STAFF_LOGISTICS_SITES,
  isStaffLogisticsSite,
  type StaffLogisticsSite,
} from '../types/staff-logistics';
import type { BlueDartConfig } from '../types/blue-dart-rates';
import type { TrackonConfig } from '../types/trackon-rates';
import type {
  BlueDartServiceId,
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
import { blueDartConfigsEqual, parseBlueDartConfig } from './blueDartRatesParse';
import { parseTrackonConfig, trackonConfigsEqual } from './trackonRatesParse';

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

function parseStCourierRatesByOrigin(raw: unknown): StCourierRatesByOrigin {
  const defaults = defaultLogisticsCourierRates().st_courier;
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;
  return {
    cochin: parseOriginRates(data.cochin),
    head_office: parseOriginRates(data.head_office),
  };
}

/** Shared card, or legacy { cochin, head_office } → prefer head_office then cochin. */
function parseSharedPartnerRates(raw: unknown): StCourierOriginRates {
  if (!raw || typeof raw !== 'object') return defaultStCourierOriginRates();
  const data = raw as Record<string, unknown>;
  if (data.cochin != null || data.head_office != null) {
    const head = parseOriginRates(data.head_office);
    const cochin = parseOriginRates(data.cochin);
    const headHasRates = ST_COURIER_ZONES.some(z => (
      head.zones[z].boxPerKgInr > 0 || head.zones[z].envelopeFixedInr > 0
    ));
    return headHasRates ? head : cochin;
  }
  return parseOriginRates(data);
}

export function parseLogisticsCourierRates(data: Record<string, unknown> | undefined): LogisticsCourierRates {
  const defaults = defaultLogisticsCourierRates();
  if (!data) return defaults;
  return {
    st_courier: parseStCourierRatesByOrigin(data.st_courier),
    trackon: parseTrackonConfig(data.trackon),
    delhivery: parseSharedPartnerRates(data.delhivery),
    bluedart: parseBlueDartConfig(data.bluedart),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

/**
 * Resolve ST-style rate card for a priced partner.
 * Origin is used only for ST Courier; ignored for shared-card partners.
 * Blue Dart / Trackon are not ST-shaped — use their config helpers / quote* instead.
 */
export function originRatesForPartner(
  rates: LogisticsCourierRates,
  partnerId: CourierRatePartnerId,
  origin: StaffLogisticsSite,
  _blueDartService: BlueDartServiceId = 'surface',
): StCourierOriginRates {
  if (partnerId === 'bluedart' || partnerId === 'trackon') {
    return defaultStCourierOriginRates();
  }
  if (partnerId === 'st_courier') {
    return rates.st_courier[origin];
  }
  return rates[partnerId];
}

export function blueDartConfigOf(rates: LogisticsCourierRates): BlueDartConfig {
  return rates.bluedart ?? defaultBlueDartConfig();
}

export function trackonConfigOf(rates: LogisticsCourierRates): TrackonConfig {
  return rates.trackon ?? defaultTrackonConfig();
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
  blueDartService: BlueDartServiceId = 'surface',
): Promise<StCourierOriginRates> {
  if (!isCourierRatePartnerId(partner)) {
    throw new Error('Select a valid courier partner.');
  }
  if (partner === 'bluedart') {
    throw new Error('Use saveBlueDartConfig for Blue Dart tariffs.');
  }
  if (partner === 'trackon') {
    throw new Error('Use saveTrackonConfig for Trackon tariffs.');
  }
  if (partner === 'st_courier' && !isStaffLogisticsSite(origin)) {
    throw new Error('Select a valid logistics origin.');
  }
  void blueDartService;

  const normalized = parseOriginRates(rates);
  if (normalized.volumetricDivisor <= 0) {
    throw new Error('Volumetric divisor must be greater than zero.');
  }

  const updatedAt = new Date().toISOString();
  let partnerPayload: Record<string, unknown>;
  if (partner === 'st_courier') {
    partnerPayload = {
      st_courier: {
        [origin]: normalized,
      },
    };
  } else {
    partnerPayload = {
      [partner]: normalized,
    };
  }

  await setDoc(
    doc(db, 'appSettings', LOGISTICS_COURIER_RATES_DOC_ID),
    {
      ...partnerPayload,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );

  return normalized;
}

export async function saveBlueDartConfig(
  config: BlueDartConfig,
  updatedBy?: string | null,
): Promise<BlueDartConfig> {
  const normalized = parseBlueDartConfig(config);
  if (normalized.air.volumetricDivisor <= 0
    || normalized.surface.volumetricDivisor <= 0
    || normalized.domestic_priority.volumetricDivisor <= 0) {
    throw new Error('Volumetric divisor must be greater than zero.');
  }

  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_COURIER_RATES_DOC_ID),
    {
      bluedart: normalized,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );
  return normalized;
}

export async function saveTrackonConfig(
  config: TrackonConfig,
  updatedBy?: string | null,
): Promise<TrackonConfig> {
  const normalized = parseTrackonConfig(config);
  if (normalized.shared.volumetricDivisor <= 0) {
    throw new Error('Volumetric divisor must be greater than zero.');
  }

  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_COURIER_RATES_DOC_ID),
    {
      trackon: normalized,
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

export {
  COURIER_RATE_PARTNER_IDS,
  isCourierRatePartnerId,
  blueDartConfigsEqual,
  trackonConfigsEqual,
};

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
