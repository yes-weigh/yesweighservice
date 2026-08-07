/**
 * Server-side Trackon parse + quote.
 * MIRROR of src/lib/trackonQuote.ts + trackonRatesParse + trackonDestination +
 * src/constants/trackonRates.ts — keep in sync when updating tariffs.
 */

const NORTH_IDS = [
  'mumbai',
  'delhi',
  'andhra_pradesh',
  'kolkata',
  'northern_sectors',
];

const SOUTH_IDS = [
  'chennai',
  'bangalore',
  'coimbatore',
  'salem',
  'tamil_nadu',
  'karnataka',
  'kerala',
  'kerala_hilly',
];

function nonNeg(value, fallback = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function ceilInr(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

function ceilKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

function normalizePlace(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slabs(upTo250, upTo500, upTo1000, addl) {
  const additional = addl != null ? addl : Math.max(0, upTo1000 - upTo500);
  return {
    upTo250gInr: upTo250,
    upTo500gInr: upTo500,
    upTo1000gInr: upTo1000,
    additionalPer500gInr: additional,
  };
}

function southRow(a, b, c, bulk) {
  return { ...slabs(a, b, c), bulkPerKgInr: bulk };
}

export function defaultTrackonConfig() {
  return {
    shared: {
      fuelSurchargePercent: 15,
      volumetricDivisor: 5000,
      oversizedSideCm: 100,
      northernMinimumChargeableKg: 1,
      southernBulkMinimumKg: 4,
    },
    air: {
      destinations: {
        mumbai: slabs(45, 50, 110),
        delhi: slabs(45, 50, 120),
        andhra_pradesh: slabs(45, 55, 120),
        kolkata: slabs(55, 60, 150),
        northern_sectors: slabs(55, 60, 150),
      },
    },
    surface: {
      northern: {
        mumbai: { perKgInr: 55 },
        delhi: { perKgInr: 60 },
        andhra_pradesh: { perKgInr: 60 },
        kolkata: { perKgInr: 70 },
        northern_sectors: { perKgInr: 70 },
      },
      southern: {
        chennai: southRow(40, 35, 40, 35),
        bangalore: southRow(40, 40, 45, 35),
        coimbatore: southRow(40, 35, 40, 35),
        salem: southRow(40, 35, 40, 35),
        tamil_nadu: southRow(40, 35, 40, 35),
        karnataka: southRow(40, 40, 45, 35),
        kerala: southRow(30, 17, 17, 17),
        kerala_hilly: southRow(30, 20, 20, 20),
      },
    },
    source: {
      label: 'Phoenix Cargo — Trackon franchise (Cochin)',
      dated: '2026-02-27',
    },
  };
}

function parseSlabs(raw, fallback) {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const upTo250gInr = nonNeg(raw.upTo250gInr, fallback.upTo250gInr);
  const upTo500gInr = nonNeg(raw.upTo500gInr, fallback.upTo500gInr);
  const upTo1000gInr = nonNeg(raw.upTo1000gInr, fallback.upTo1000gInr);
  const defaultAddl = Math.max(0, upTo1000gInr - upTo500gInr);
  return {
    upTo250gInr,
    upTo500gInr,
    upTo1000gInr,
    additionalPer500gInr: nonNeg(raw.additionalPer500gInr, defaultAddl),
  };
}

function isLegacyStTrackonShape(raw) {
  if (raw.air != null || raw.surface != null || raw.shared != null) return false;
  if (raw.zones != null || raw.cochin != null || raw.head_office != null) return true;
  if (raw.boxPerKgInr != null || raw.envelopeFixedInr != null) return true;
  return false;
}

export function parseTrackonConfig(raw) {
  const defaults = defaultTrackonConfig();
  if (!raw || typeof raw !== 'object') return defaults;
  if (isLegacyStTrackonShape(raw)) return defaults;

  const sharedRaw = raw.shared && typeof raw.shared === 'object' ? raw.shared : {};
  const shared = {
    fuelSurchargePercent: nonNeg(sharedRaw.fuelSurchargePercent, defaults.shared.fuelSurchargePercent),
    volumetricDivisor: nonNeg(sharedRaw.volumetricDivisor, defaults.shared.volumetricDivisor)
      || defaults.shared.volumetricDivisor,
    oversizedSideCm: nonNeg(sharedRaw.oversizedSideCm, defaults.shared.oversizedSideCm)
      || defaults.shared.oversizedSideCm,
    northernMinimumChargeableKg: nonNeg(
      sharedRaw.northernMinimumChargeableKg,
      defaults.shared.northernMinimumChargeableKg,
    ),
    southernBulkMinimumKg: nonNeg(
      sharedRaw.southernBulkMinimumKg,
      defaults.shared.southernBulkMinimumKg,
    ) || defaults.shared.southernBulkMinimumKg,
  };

  const airRaw = raw.air && typeof raw.air === 'object' ? raw.air : {};
  const airDestRaw = airRaw.destinations && typeof airRaw.destinations === 'object'
    ? airRaw.destinations
    : airRaw;
  const airDestinations = {};
  for (const id of NORTH_IDS) {
    airDestinations[id] = parseSlabs(airDestRaw[id], defaults.air.destinations[id]);
  }

  const surfaceRaw = raw.surface && typeof raw.surface === 'object' ? raw.surface : {};
  const northRaw = surfaceRaw.northern && typeof surfaceRaw.northern === 'object'
    ? surfaceRaw.northern
    : {};
  const southRaw = surfaceRaw.southern && typeof surfaceRaw.southern === 'object'
    ? surfaceRaw.southern
    : {};
  const northern = {};
  for (const id of NORTH_IDS) {
    const row = northRaw[id];
    northern[id] = {
      perKgInr: nonNeg(
        row && typeof row === 'object' ? row.perKgInr : null,
        defaults.surface.northern[id].perKgInr,
      ),
    };
  }
  const southern = {};
  for (const id of SOUTH_IDS) {
    const base = parseSlabs(southRaw[id], defaults.surface.southern[id]);
    const row = southRaw[id] && typeof southRaw[id] === 'object' ? southRaw[id] : {};
    southern[id] = {
      ...base,
      bulkPerKgInr: nonNeg(row.bulkPerKgInr, defaults.surface.southern[id].bulkPerKgInr),
    };
  }

  return {
    shared,
    air: { destinations: airDestinations },
    surface: { northern, southern },
    source: defaults.source,
  };
}

function resolveTrackonDestination(destination) {
  const state = normalizePlace(destination?.state);
  const city = normalizePlace(destination?.city);
  if (!state && !city) return null;

  const hilly = ['wayanad', 'idukki', 'kasargod', 'kasaragod'];
  const isHilly = hilly.some(t => `${city} ${state}`.includes(t));
  const isKerala = state === 'kerala' || state === 'kl' || state.includes('kerala');
  if (isKerala) return isHilly ? 'kerala_hilly' : 'kerala';

  if (city.includes('chennai') || city.includes('madras')) return 'chennai';
  if (city.includes('bangalore') || city.includes('bengaluru')) return 'bangalore';
  if (city.includes('coimbatore')) return 'coimbatore';
  if (city === 'salem' || city.startsWith('salem ')) return 'salem';

  if (
    state.includes('tamil')
    || state === 'tn'
    || state.includes('puducherry')
    || state.includes('pondicherry')
    || state === 'pondy'
    || state === 'py'
  ) {
    return 'tamil_nadu';
  }
  if (state === 'karnataka' || state === 'ka' || state.includes('karnataka')) {
    return 'karnataka';
  }
  if (city.includes('mumbai') || city.includes('bombay') || city.includes('thane')) {
    return 'mumbai';
  }
  if (state.includes('delhi') || city.includes('delhi')) return 'delhi';
  if (state.includes('andhra') || state.includes('telangana') || state === 'ap' || state === 'ts') {
    return 'andhra_pradesh';
  }
  if (city.includes('kolkata') || state.includes('west bengal') || state === 'wb') {
    return 'kolkata';
  }
  return 'northern_sectors';
}

function volumetricKg(dims, divisor, oversizedSideCm) {
  const lengthCm = nonNeg(dims?.lengthCm);
  const widthCm = nonNeg(dims?.widthCm);
  const heightCm = nonNeg(dims?.heightCm);
  const d = divisor > 0 ? divisor : 5000;
  if (!lengthCm || !widthCm || !heightCm) return 0;
  let vol = (lengthCm * widthCm * heightCm) / d;
  const limit = oversizedSideCm > 0 ? oversizedSideCm : 100;
  if (lengthCm > limit || widthCm > limit || heightCm > limit) vol *= 2;
  return vol;
}

function freightFromSouthSlabs(row, billableKg) {
  if (billableKg <= 0) return 0;
  if (billableKg <= 0.25) return nonNeg(row.upTo250gInr);
  if (billableKg <= 0.5) return nonNeg(row.upTo500gInr);
  if (billableKg <= 1) return nonNeg(row.upTo1000gInr);
  const addlUnits = Math.ceil((billableKg - 1) / 0.5);
  return nonNeg(row.upTo1000gInr) + addlUnits * nonNeg(row.additionalPer500gInr);
}

/** Air: flat upto 1 kg; then ₹ per each 500 g (or part) above 1 kg. */
function freightFromAirSlabs(row, billableKg) {
  if (billableKg <= 0) return 0;
  if (billableKg <= 1) return nonNeg(row.upTo1000gInr);
  const addlUnits = Math.ceil((billableKg - 1) / 0.5);
  return nonNeg(row.upTo1000gInr) + addlUnits * nonNeg(row.additionalPer500gInr);
}

export function quoteTrackonParcels({
  config,
  service = 'surface',
  destination = null,
  destinationId = null,
  parcels = [],
}) {
  const parsed = parseTrackonConfig(config);
  const destId = destinationId || resolveTrackonDestination(destination);
  const empty = (flags = {}) => ({
    destinationId: destId,
    service,
    volumetricKg: 0,
    chargeableKg: 0,
    billableKg: 0,
    freightInr: 0,
    fuelSurchargeInr: 0,
    totalInr: 0,
    notServiceable: Boolean(flags.notServiceable),
    rateMissing: Boolean(flags.rateMissing),
    sku: 'TRFRC',
  });

  if (!destId) return empty({ rateMissing: true });
  if (service === 'air' && !NORTH_IDS.includes(destId)) {
    return empty({ notServiceable: true });
  }

  let volumetricKgTotal = 0;
  let billableKg = 0;
  for (const parcel of parcels) {
    const actual = nonNeg(parcel.actualKg);
    const vol = volumetricKg(
      parcel.dims,
      parsed.shared.volumetricDivisor,
      parsed.shared.oversizedSideCm,
    );
    volumetricKgTotal += vol;
    billableKg += Math.max(actual, vol);
  }

  let freightInr = 0;
  let chargeableKg = 0;

  if (service === 'air') {
    const row = parsed.air.destinations[destId];
    freightInr = freightFromAirSlabs(row, billableKg);
    chargeableKg = billableKg <= 1 ? billableKg : ceilKg(billableKg);
  } else if (SOUTH_IDS.includes(destId)) {
    const row = parsed.surface.southern[destId];
    if (billableKg <= 1) {
      freightInr = freightFromSouthSlabs(row, billableKg);
      chargeableKg = billableKg;
    } else {
      const minBulk = nonNeg(parsed.shared.southernBulkMinimumKg) || 4;
      chargeableKg = ceilKg(Math.max(billableKg, minBulk));
      freightInr = nonNeg(row.bulkPerKgInr) * chargeableKg;
    }
  } else if (NORTH_IDS.includes(destId)) {
    const row = parsed.surface.northern[destId];
    const minKg = nonNeg(parsed.shared.northernMinimumChargeableKg);
    chargeableKg = ceilKg(Math.max(billableKg, minKg));
    freightInr = nonNeg(row.perKgInr) * chargeableKg;
  } else {
    return empty({ notServiceable: true });
  }

  if (!(freightInr > 0) && billableKg > 0) {
    return {
      ...empty({ rateMissing: true }),
      volumetricKg: volumetricKgTotal,
      chargeableKg,
      billableKg,
    };
  }

  const fuelSurchargeInr = freightInr * (nonNeg(parsed.shared.fuelSurchargePercent) / 100);

  return {
    destinationId: destId,
    service,
    volumetricKg: volumetricKgTotal,
    chargeableKg,
    billableKg,
    freightInr,
    fuelSurchargeInr,
    totalInr: ceilInr(freightInr + fuelSurchargeInr),
    notServiceable: false,
    rateMissing: false,
    sku: 'TRFRC',
  };
}
