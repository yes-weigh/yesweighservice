/**
 * Server-side Blue Dart parse + quote.
 * MIRROR of src/lib/blueDartQuote.ts + blueDartRatesParse + blueDartZone —
 * keep charge stack and defaults in sync when updating tariffs.
 *
 * Used by functions/lib/st-courier-cart-freight.js buildDealerAutoFreightLines
 * when partner is bluedart (pin loaded in dealer-orders.js).
 *
 * Re-burn / schema notes: see header on src/types/blue-dart-rates.ts
 */

const BLUE_DART_SERVICES = ['air', 'surface', 'domestic_priority'];
const REGIONS = ['NORTH', 'EAST', 'WEST', 'SOUTH', 'NE', 'JK'];
const AIR_ZONES = [1, 2, 3, 4, 5];
const DP_ZONES = ['A1', 'A', 'B', 'C'];

function nonNeg(value, fallback = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function ceilInr(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

function normalizePlace(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function defaultRegionsByState() {
  const map = {};
  const add = (region, names) => {
    for (const name of names) map[name] = region;
  };
  add('NORTH', [
    'himachal pradesh', 'hp', 'punjab', 'haryana', 'uttarakhand', 'uttaranchal',
    'uttar pradesh', 'up', 'rajasthan', 'delhi', 'nct of delhi', 'chandigarh',
  ]);
  add('EAST', ['bihar', 'orissa', 'odisha', 'west bengal', 'jharkhand']);
  add('WEST', [
    'maharashtra', 'madhya pradesh', 'mp', 'gujarat', 'gujrat',
    'chhattisgarh', 'chattisgarh', 'goa', 'diu daman', 'daman diu',
  ]);
  add('SOUTH', [
    'karnataka', 'tamil nadu', 'tamilnadu', 'tn', 'kerala', 'kl',
    'andhra pradesh', 'telangana', 'pondicherry', 'puducherry', 'pondy', 'py',
  ]);
  add('NE', [
    'nagaland', 'mizoram', 'manipur', 'meghalaya', 'arunachal pradesh',
    'tripura', 'sikkim', 'assam',
  ]);
  add('JK', [
    'jammu', 'kashmir', 'ladakh', 'jammu and kashmir', 'jammu kashmir', 'jk',
  ]);
  return map;
}

function defaultZoneMatrix() {
  const row = (n, e, w, s, ne, jk) => ({
    NORTH: n, EAST: e, WEST: w, SOUTH: s, NE: ne, JK: jk,
  });
  return {
    NORTH: row(1, 3, 2, 3, 5, 2),
    EAST: row(3, 1, 3, 4, 2, 5),
    WEST: row(2, 3, 1, 2, 5, 5),
    SOUTH: row(3, 4, 2, 1, 5, 5),
    NE: row(5, 2, 5, 5, 1, 5),
    JK: row(2, 5, 5, 5, 5, 1),
  };
}

function defaultEdlMatrix() {
  return [
    { distanceKmMin: 20, distanceKmMax: 50, amountsInr: [550, 990, 1100, 1375, 1650] },
    { distanceKmMin: 51, distanceKmMax: 100, amountsInr: [825, 1210, 1375, 1650, 1925] },
    { distanceKmMin: 101, distanceKmMax: 150, amountsInr: [1100, 1650, 1925, 2200, 2750] },
    { distanceKmMin: 151, distanceKmMax: 200, amountsInr: [1375, 1925, 2200, 2475, 3300] },
    { distanceKmMin: 201, distanceKmMax: 250, amountsInr: [1650, 2200, 2750, 3300, 3960] },
    { distanceKmMin: 250, distanceKmMax: 300, amountsInr: [1925, 2500, 3150, 3800, 4560] },
    { distanceKmMin: 300, distanceKmMax: 350, amountsInr: [2200, 2800, 3550, 4300, 5160] },
    { distanceKmMin: 350, distanceKmMax: 400, amountsInr: [2475, 3100, 3950, 4800, 5760] },
    { distanceKmMin: 400, distanceKmMax: 450, amountsInr: [2750, 3400, 4350, 5300, 6360] },
    { distanceKmMin: 450, distanceKmMax: 500, amountsInr: [3025, 3700, 4750, 5800, 6960] },
  ];
}

function defaultShared() {
  return {
    fuelSurchargePercent: 92,
    cafPercent: 22,
    gstPercent: 18,
    originRegion: 'SOUTH',
    edlMode: 'flat_fallback',
    edlFlatFallbackInr: 0,
    edlNeJkPerKgInr: 15,
    edlNeJkFloorInr: 3000,
    edlBeyond500KmPerKmInr: 14,
    edlBeyond1500KgPerKgInr: 5,
    hideTemPer: true,
    rasPerKgInr: 3,
    rasStates: [
      'bihar', 'jharkhand', 'kerala', 'jammu', 'kashmir', 'ladakh', 'jammu and kashmir',
    ],
    fov: { minInr: 90, percentOfInvoice: 0.05 },
    regionsByState: defaultRegionsByState(),
    zoneMatrix: defaultZoneMatrix(),
    edlMatrix: defaultEdlMatrix(),
    productIds: { air: 'BDAIR', surface: 'BDFRC', domestic_priority: 'BDDP' },
  };
}

function defaultAir() {
  return {
    perKgInr: { 1: 32, 2: 45, 3: 50, 4: 65, 5: 70 },
    minimumChargeableWeightKg: 10,
    minimumFreightInr: 260,
    docketFeeInr: 100,
    volumetricDivisor: 5000,
    fuelSurchargePercent: null,
    cafPercent: null,
    idcPercent: 5,
    efssPercent: 10,
    pssPercent: 5,
    rasPerKgInr: null,
    fov: null,
  };
}

function defaultSurface() {
  return {
    perKgInr: { 1: 8, 2: 9, 3: 11, 4: 12, 5: 19 },
    minimumChargeableWeightKg: 10,
    minimumFreightInr: 160,
    docketFeeInr: 100,
    volumetricDivisor: 4500,
    fuelSurchargePercent: null,
    cafPercent: null,
    idcPercent: 0,
    efssPercent: 0,
    pssPercent: 0,
    rasPerKgInr: null,
    fov: null,
    festivalSurchargePercent: 0,
    festivalSeasonStartMonth: 10,
    festivalSeasonEndMonth: 1,
  };
}

function clampMonth(value, fallback) {
  const n = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  if (n < 1 || n > 12) return fallback;
  return n;
}

function isFestivalSeasonMonth(month, startMonth, endMonth) {
  const m = Math.round(month);
  const start = Math.round(startMonth);
  const end = Math.round(endMonth);
  if (m < 1 || m > 12 || start < 1 || start > 12 || end < 1 || end > 12) return false;
  if (start === end) return m === start;
  if (start < end) return m >= start && m <= end;
  return m >= start || m <= end;
}

function surfaceFestivalPercent(surface, at = new Date()) {
  const pct = nonNeg(surface?.festivalSurchargePercent);
  if (!(pct > 0)) return 0;
  const month = at.getMonth() + 1;
  return isFestivalSeasonMonth(
    month,
    surface.festivalSeasonStartMonth,
    surface.festivalSeasonEndMonth,
  )
    ? pct
    : 0;
}

function defaultDp() {
  return {
    first500gInr: { A1: 28, A: 36, B: 41, C: 46 },
    addl500gInr: { A1: 28, A: 36, B: 41, C: 46 },
    volumetricDivisor: 5000,
    fuelSurchargePercent: null,
    cafPercent: null,
    idcPercent: 5,
    efssPercent: 10,
    pssPercent: 5,
  };
}

export function defaultBlueDartConfig() {
  return {
    shared: defaultShared(),
    air: defaultAir(),
    surface: defaultSurface(),
    domestic_priority: defaultDp(),
    source: null,
  };
}

function isConfigShape(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.shared && typeof raw.shared === 'object') return true;
  if (raw.air?.perKgInr || raw.surface?.perKgInr || raw.domestic_priority?.first500gInr) {
    return true;
  }
  return false;
}

function parseKg(raw, defaults) {
  if (!raw || typeof raw !== 'object') {
    return { ...defaults, perKgInr: { ...defaults.perKgInr } };
  }
  const perKgInr = { ...defaults.perKgInr };
  const src = raw.perKgInr && typeof raw.perKgInr === 'object' ? raw.perKgInr : {};
  for (const z of AIR_ZONES) {
    const v = Number(src[z] ?? src[String(z)]);
    if (Number.isFinite(v) && v >= 0) perKgInr[z] = v;
  }
  return {
    perKgInr,
    minimumChargeableWeightKg: nonNeg(Number(raw.minimumChargeableWeightKg), defaults.minimumChargeableWeightKg),
    minimumFreightInr: nonNeg(Number(raw.minimumFreightInr), defaults.minimumFreightInr),
    docketFeeInr: nonNeg(Number(raw.docketFeeInr), defaults.docketFeeInr),
    volumetricDivisor: nonNeg(Number(raw.volumetricDivisor), defaults.volumetricDivisor) || defaults.volumetricDivisor,
    fuelSurchargePercent: raw.fuelSurchargePercent == null ? null : nonNeg(Number(raw.fuelSurchargePercent)),
    cafPercent: raw.cafPercent == null ? null : nonNeg(Number(raw.cafPercent)),
    idcPercent: nonNeg(Number(raw.idcPercent), defaults.idcPercent),
    efssPercent: nonNeg(Number(raw.efssPercent), defaults.efssPercent),
    pssPercent: nonNeg(Number(raw.pssPercent), defaults.pssPercent),
    rasPerKgInr: raw.rasPerKgInr == null ? null : nonNeg(Number(raw.rasPerKgInr)),
    fov: raw.fov && typeof raw.fov === 'object'
      ? {
        minInr: nonNeg(Number(raw.fov.minInr), 90),
        percentOfInvoice: nonNeg(Number(raw.fov.percentOfInvoice), 0.05),
      }
      : null,
  };
}

function parseDp(raw) {
  const defaults = defaultDp();
  if (!raw || typeof raw !== 'object') return defaults;
  const first = { ...defaults.first500gInr };
  const addl = { ...defaults.addl500gInr };
  for (const z of DP_ZONES) {
    if (raw.first500gInr?.[z] != null) first[z] = nonNeg(Number(raw.first500gInr[z]), first[z]);
    if (raw.addl500gInr?.[z] != null) addl[z] = nonNeg(Number(raw.addl500gInr[z]), addl[z]);
  }
  return {
    first500gInr: first,
    addl500gInr: addl,
    volumetricDivisor: nonNeg(Number(raw.volumetricDivisor), defaults.volumetricDivisor) || defaults.volumetricDivisor,
    fuelSurchargePercent: raw.fuelSurchargePercent == null ? null : nonNeg(Number(raw.fuelSurchargePercent)),
    cafPercent: raw.cafPercent == null ? null : nonNeg(Number(raw.cafPercent)),
    idcPercent: nonNeg(Number(raw.idcPercent), defaults.idcPercent),
    efssPercent: nonNeg(Number(raw.efssPercent), defaults.efssPercent),
    pssPercent: nonNeg(Number(raw.pssPercent), defaults.pssPercent),
  };
}

function parseShared(raw) {
  const defaults = defaultShared();
  if (!raw || typeof raw !== 'object') return defaults;
  return {
    ...defaults,
    ...raw,
    fuelSurchargePercent: nonNeg(Number(raw.fuelSurchargePercent), defaults.fuelSurchargePercent),
    cafPercent: nonNeg(Number(raw.cafPercent), defaults.cafPercent),
    gstPercent: nonNeg(Number(raw.gstPercent), defaults.gstPercent),
    originRegion: REGIONS.includes(raw.originRegion) ? raw.originRegion : defaults.originRegion,
    edlMode: ['off', 'ne_jk_only', 'flat_fallback', 'matrix_when_km'].includes(raw.edlMode)
      ? raw.edlMode
      : defaults.edlMode,
    edlFlatFallbackInr: nonNeg(Number(raw.edlFlatFallbackInr), defaults.edlFlatFallbackInr),
    edlNeJkPerKgInr: nonNeg(Number(raw.edlNeJkPerKgInr), defaults.edlNeJkPerKgInr),
    edlNeJkFloorInr: nonNeg(Number(raw.edlNeJkFloorInr), defaults.edlNeJkFloorInr),
    edlBeyond500KmPerKmInr: nonNeg(Number(raw.edlBeyond500KmPerKmInr), defaults.edlBeyond500KmPerKmInr),
    edlBeyond1500KgPerKgInr: nonNeg(Number(raw.edlBeyond1500KgPerKgInr), defaults.edlBeyond1500KgPerKgInr),
    hideTemPer: raw.hideTemPer !== false,
    rasPerKgInr: nonNeg(Number(raw.rasPerKgInr), defaults.rasPerKgInr),
    rasStates: Array.isArray(raw.rasStates) ? raw.rasStates.map(String) : defaults.rasStates,
    fov: raw.fov && typeof raw.fov === 'object'
      ? {
        minInr: nonNeg(Number(raw.fov.minInr), defaults.fov.minInr),
        percentOfInvoice: nonNeg(Number(raw.fov.percentOfInvoice), defaults.fov.percentOfInvoice),
      }
      : defaults.fov,
    regionsByState: {
      ...defaults.regionsByState,
      ...(raw.regionsByState && typeof raw.regionsByState === 'object' ? raw.regionsByState : {}),
    },
    zoneMatrix: raw.zoneMatrix && typeof raw.zoneMatrix === 'object'
      ? { ...defaults.zoneMatrix, ...raw.zoneMatrix }
      : defaults.zoneMatrix,
    edlMatrix: Array.isArray(raw.edlMatrix) && raw.edlMatrix.length
      ? raw.edlMatrix
      : defaults.edlMatrix,
    productIds: {
      air: String(raw.productIds?.air || defaults.productIds.air),
      surface: String(raw.productIds?.surface || defaults.productIds.surface),
      domestic_priority: String(
        raw.productIds?.domestic_priority || defaults.productIds.domestic_priority,
      ),
    },
  };
}

function parseSurface(raw) {
  const defaults = defaultSurface();
  const base = parseKg(raw, defaults);
  if (!raw || typeof raw !== 'object') {
    return { ...defaults, ...base, perKgInr: { ...base.perKgInr } };
  }
  return {
    ...base,
    festivalSurchargePercent: nonNeg(
      Number(raw.festivalSurchargePercent),
      defaults.festivalSurchargePercent,
    ),
    festivalSeasonStartMonth: clampMonth(
      raw.festivalSeasonStartMonth,
      defaults.festivalSeasonStartMonth,
    ),
    festivalSeasonEndMonth: clampMonth(
      raw.festivalSeasonEndMonth,
      defaults.festivalSeasonEndMonth,
    ),
  };
}

export function parseBlueDartConfig(raw) {
  const defaults = defaultBlueDartConfig();
  if (!isConfigShape(raw)) return defaults;
  return {
    shared: parseShared(raw.shared),
    air: parseKg(raw.air, defaultAir()),
    surface: parseSurface(raw.surface),
    domestic_priority: parseDp(raw.domestic_priority),
    source: raw.source && typeof raw.source === 'object' ? raw.source : null,
  };
}

function resolveRegion(state, regionsByState) {
  const key = normalizePlace(state);
  if (!key) return null;
  if (regionsByState[key]) return regionsByState[key];
  for (const [name, region] of Object.entries(regionsByState)) {
    if (key.includes(name) || name.includes(key)) return region;
  }
  return null;
}

function isRas(state, rasStates) {
  const key = normalizePlace(state);
  if (!key) return false;
  return rasStates.some((raw) => {
    const ras = normalizePlace(raw);
    return ras && (key === ras || key.includes(ras) || ras.includes(key));
  });
}

function isKerala(state) {
  const key = normalizePlace(state);
  return key === 'kerala' || key === 'kl' || key.includes('kerala');
}

function serviceCode(pin, service) {
  if (!pin) return 'Yes';
  if (service === 'air') return String(pin.apxService || 'No');
  if (service === 'surface') return String(pin.sfcService || 'No');
  return String(pin.dpService || 'No');
}

function allowed(pin, service, hideTemPer) {
  const code = serviceCode(pin, service);
  if (code === 'Yes') return { ok: true, edl: false };
  if (code === 'EDL') return { ok: true, edl: true };
  if ((code === 'TEM' || code === 'PER') && !hideTemPer) return { ok: true, edl: false };
  if (!pin) return { ok: true, edl: false };
  return { ok: false, edl: false };
}

function volumetricKg(dims, divisor) {
  const l = nonNeg(dims?.lengthCm);
  const w = nonNeg(dims?.widthCm);
  const h = nonNeg(dims?.heightCm);
  const d = divisor > 0 ? divisor : 5000;
  if (!l || !w || !h) return 0;
  return (l * w * h) / d;
}

function chargeableKg(actualKg, dims, divisor, minKg) {
  const raw = Math.max(nonNeg(actualKg), volumetricKg(dims, divisor));
  const min = nonNeg(minKg);
  return min > 0 ? Math.max(raw, min) : raw;
}

function edlInr(shared, destState, isEdl, kg, edlKm) {
  if (!isEdl || shared.edlMode === 'off') return 0;
  const region = resolveRegion(destState, shared.regionsByState);
  if (region === 'NE' || region === 'JK') {
    return Math.max(nonNeg(shared.edlNeJkPerKgInr) * kg, nonNeg(shared.edlNeJkFloorInr));
  }
  if (shared.edlMode === 'ne_jk_only') return 0;
  const km = edlKm != null && Number.isFinite(edlKm) ? Number(edlKm) : null;
  if (km != null && km > 0 && shared.edlMode === 'matrix_when_km') {
    // simplified: flat fallback when out of matrix range
    const row = (shared.edlMatrix || []).find(r => km >= r.distanceKmMin && km <= r.distanceKmMax);
    if (row) {
      let idx = 4;
      if (kg <= 100) idx = 0;
      else if (kg <= 250) idx = 1;
      else if (kg <= 500) idx = 2;
      else if (kg <= 1000) idx = 3;
      return nonNeg(row.amountsInr?.[idx]);
    }
  }
  return nonNeg(shared.edlFlatFallbackInr);
}

function fsCaf(shared, serviceFs, serviceCaf) {
  return {
    fs: serviceFs != null ? nonNeg(serviceFs) : nonNeg(shared.fuelSurchargePercent),
    caf: serviceCaf != null ? nonNeg(serviceCaf) : nonNeg(shared.cafPercent),
  };
}

export function quoteBlueDartParcels({
  config,
  service = 'surface',
  destState,
  pin = null,
  parcels = [],
  invoiceValueInr = 0,
}) {
  const cfg = parseBlueDartConfig(config);
  const skuMap = {
    air: 'BDAIR',
    surface: 'BDFRC',
    domestic_priority: 'BDDP',
  };
  const sku = skuMap[service] || 'BDFRC';
  const access = allowed(pin, service, cfg.shared.hideTemPer);
  if (!access.ok) {
    return { totalInr: 0, chargeableKg: 0, sku: sku, rateMissing: true, notServiceable: true };
  }

  let actualKg = 0;
  let volume = 0;
  for (const p of parcels) {
    actualKg += nonNeg(p.actualKg);
    volume += nonNeg(p.dims?.lengthCm) * nonNeg(p.dims?.widthCm) * nonNeg(p.dims?.heightCm);
  }
  const side = volume > 0 ? Math.cbrt(volume) : 0;
  const dims = { lengthCm: side, widthCm: side, heightCm: side };

  if (service === 'domestic_priority') {
    const rates = cfg.domestic_priority;
    const zone = isKerala(destState)
      ? 'A1'
      : (['A', 'B', 'C'].includes(String(pin?.dpZone || '').toUpperCase())
        ? String(pin.dpZone).toUpperCase()
        : null);
    if (!zone) {
      return { totalInr: 0, chargeableKg: 0, sku, rateMissing: true, notServiceable: true };
    }
    const kg = chargeableKg(actualKg, dims, rates.volumetricDivisor, 0.5);
    const first = nonNeg(rates.first500gInr[zone]);
    const addl = nonNeg(rates.addl500gInr[zone]);
    if (!(first > 0)) {
      return { totalInr: 0, chargeableKg: kg, sku, rateMissing: true, notServiceable: false };
    }
    const slabs = Math.max(1, Math.ceil((kg * 1000) / 500));
    const base = first + Math.max(0, slabs - 1) * addl;
    const pss = base * (nonNeg(rates.pssPercent) / 100);
    const idc = base * (nonNeg(rates.idcPercent) / 100);
    const after = base + pss + idc;
    const { fs, caf } = fsCaf(cfg.shared, rates.fuelSurchargePercent, rates.cafPercent);
    const fuel = after * (fs / 100);
    const afterFuel = after + fuel;
    const cafInr = afterFuel * (caf / 100);
    const afterCaf = afterFuel + cafInr;
    const efss = afterCaf * (nonNeg(rates.efssPercent) / 100);
    const subtotal = afterCaf + efss;
    const gst = subtotal * (nonNeg(cfg.shared.gstPercent) / 100);
    return {
      totalInr: ceilInr(subtotal + gst),
      chargeableKg: kg,
      sku,
      rateMissing: false,
      notServiceable: false,
    };
  }

  const rates = cfg[service] || cfg.surface;
  const destRegion = resolveRegion(destState, cfg.shared.regionsByState);
  const zone = destRegion
    ? cfg.shared.zoneMatrix[cfg.shared.originRegion]?.[destRegion]
    : null;
  if (!zone) {
    return { totalInr: 0, chargeableKg: 0, sku, rateMissing: true, notServiceable: true };
  }
  const kg = chargeableKg(
    actualKg,
    dims,
    rates.volumetricDivisor,
    rates.minimumChargeableWeightKg,
  );
  const perKg = nonNeg(rates.perKgInr[zone]);
  if (!(perKg > 0)) {
    return { totalInr: 0, chargeableKg: kg, sku, rateMissing: true, notServiceable: false };
  }
  let base = perKg * kg;
  if (rates.minimumFreightInr > 0) base = Math.max(base, rates.minimumFreightInr);
  const docket = nonNeg(rates.docketFeeInr);
  const festivalPct = service === 'surface'
    ? surfaceFestivalPercent(cfg.surface)
    : 0;
  const festival = base * (festivalPct / 100);
  const pss = service === 'surface'
    ? 0
    : base * (nonNeg(rates.pssPercent) / 100);
  const idc = base * (nonNeg(rates.idcPercent) / 100);
  const after = base + pss + festival + idc;
  const { fs, caf } = fsCaf(cfg.shared, rates.fuelSurchargePercent, rates.cafPercent);
  const fuel = after * (fs / 100);
  const afterFuel = after + fuel;
  const cafInr = afterFuel * (caf / 100);
  const afterCaf = afterFuel + cafInr;
  const efss = afterCaf * (nonNeg(rates.efssPercent) / 100);
  const rasRate = rates.rasPerKgInr != null ? nonNeg(rates.rasPerKgInr) : nonNeg(cfg.shared.rasPerKgInr);
  const ras = isRas(destState, cfg.shared.rasStates) ? rasRate * kg : 0;
  const fovRule = rates.fov || cfg.shared.fov;
  const fov = Math.max(
    nonNeg(fovRule.minInr),
    nonNeg(invoiceValueInr) * (nonNeg(fovRule.percentOfInvoice) / 100),
  );
  const edl = edlInr(cfg.shared, destState, access.edl, kg, pin?.edlKm ?? null);
  const subtotal = afterCaf + efss + docket + ras + fov + edl;
  const gst = subtotal * (nonNeg(cfg.shared.gstPercent) / 100);
  return {
    totalInr: ceilInr(subtotal + gst),
    chargeableKg: kg,
    sku,
    rateMissing: false,
    notServiceable: false,
  };
}

export { BLUE_DART_SERVICES };
