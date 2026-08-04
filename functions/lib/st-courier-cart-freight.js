/**
 * Server-side ST cartonize + quote helpers for dealer checkout freight lines.
 * Mirrors src/lib/stCourierZone.ts + stCourierCartFreight.ts (keep in sync).
 */
import { FREIGHT_LINE_OPTIONS } from './freight-lines.js';
import {
  classifyOrderLineSegment,
  resolveLineInventorySite,
  segmentAllowsFreight,
} from './sales-order-segments.js';

const ST_ZONES = [
  'kerala',
  'tamil_nadu_pondy',
  'karnataka',
  'andhra_pradesh',
  'mumbai',
  'delhi',
  'rest_of_india',
];

const DEFAULT_DIVISOR = 5000;

function nonNeg(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function normalizePlace(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DELHI_CITY_RE = /\b(new delhi|delhi|noida|gurgaon|gurugram|ghaziabad|faridabad|ncr)\b/;
const MUMBAI_CITY_RE = /\b(mumbai|bombay|navi mumbai|thane|kalyan|panvel|vasai|virar)\b/;

export function inferStCourierZone(destination) {
  const state = normalizePlace(destination?.state);
  const city = normalizePlace(destination?.city);
  const combined = `${city} ${state}`.trim();
  if (!state && !city) return null;

  if (DELHI_CITY_RE.test(city) || DELHI_CITY_RE.test(combined)) return 'delhi';
  if (MUMBAI_CITY_RE.test(city) || MUMBAI_CITY_RE.test(combined)) return 'mumbai';

  if (state === 'kerala' || state === 'kl' || state.includes('kerala')) return 'kerala';

  if (
    state === 'puducherry' || state === 'pondicherry' || state === 'pondy' || state === 'py'
    || state.includes('puducherry') || state.includes('pondicherry')
    || city === 'puducherry' || city === 'pondicherry'
    || city.includes('pondicherry') || city.includes('puducherry')
  ) {
    return 'tamil_nadu_pondy';
  }

  if (
    state === 'tamil nadu' || state === 'tamilnadu' || state === 'tn'
    || state.includes('tamil nadu') || state.includes('tamilnadu')
  ) {
    return 'tamil_nadu_pondy';
  }

  if (state === 'karnataka' || state === 'ka' || state.includes('karnataka')) {
    return 'karnataka';
  }

  if (
    state === 'andhra pradesh' || state === 'andhrapradesh' || state === 'ap'
    || state.includes('andhra')
    || state === 'telangana' || state === 'ts' || state.includes('telangana')
  ) {
    return 'andhra_pradesh';
  }

  if (state === 'delhi' || state === 'dl' || state === 'nct of delhi' || state.includes('delhi')) {
    return 'delhi';
  }

  if (state === 'maharashtra' || state === 'mh' || state.includes('maharashtra')) {
    return 'rest_of_india';
  }

  return 'rest_of_india';
}

function cartonOk(carton) {
  if (!carton || typeof carton !== 'object') return false;
  return [carton.lengthCm, carton.breadthCm, carton.heightCm, carton.weightKg]
    .every(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
}

function volumetricKg(dims, divisor) {
  const lengthCm = nonNeg(dims?.lengthCm);
  const widthCm = nonNeg(dims?.widthCm);
  const heightCm = nonNeg(dims?.heightCm);
  const d = divisor > 0 ? divisor : DEFAULT_DIVISOR;
  if (!lengthCm || !widthCm || !heightCm) return 0;
  return (lengthCm * widthCm * heightCm) / d;
}

function defaultZoneTable() {
  const zones = {};
  for (const zone of ST_ZONES) {
    zones[zone] = { envelopeFixedInr: 0, boxPerKgInr: 0 };
  }
  return zones;
}

function parseOriginRates(raw) {
  const zones = defaultZoneTable();
  if (!raw || typeof raw !== 'object') {
    return {
      volumetricDivisor: DEFAULT_DIVISOR,
      useChargeableWeight: true,
      minimumChargeableWeightKg: 0,
      fuelSurchargePercent: 0,
      zones,
    };
  }
  const zonesRaw = raw.zones && typeof raw.zones === 'object' ? raw.zones : {};
  for (const zone of ST_ZONES) {
    const z = zonesRaw[zone] && typeof zonesRaw[zone] === 'object' ? zonesRaw[zone] : {};
    zones[zone] = {
      envelopeFixedInr: nonNeg(Number(z.envelopeFixedInr)),
      boxPerKgInr: nonNeg(Number(z.boxPerKgInr)),
    };
  }
  return {
    volumetricDivisor: nonNeg(Number(raw.volumetricDivisor)) || DEFAULT_DIVISOR,
    useChargeableWeight: raw.useChargeableWeight !== false,
    minimumChargeableWeightKg: nonNeg(Number(raw.minimumChargeableWeightKg)),
    fuelSurchargePercent: nonNeg(Number(raw.fuelSurchargePercent)),
    zones,
  };
}

export function parseLogisticsCourierRates(data) {
  const empty = () => ({
    cochin: parseOriginRates(null),
    head_office: parseOriginRates(null),
  });
  if (!data || typeof data !== 'object') {
    return { st_courier: empty(), trackon: empty(), delhivery: empty() };
  }
  const partner = (key) => {
    const raw = data[key] && typeof data[key] === 'object' ? data[key] : {};
    return {
      cochin: parseOriginRates(raw.cochin),
      head_office: parseOriginRates(raw.head_office),
    };
  };
  return {
    st_courier: partner('st_courier'),
    trackon: partner('trackon'),
    delhivery: partner('delhivery'),
  };
}

function cartonizeLine(line) {
  const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
  if (qty <= 0) return [];
  const segment = classifyOrderLineSegment(line);
  if (!segmentAllowsFreight(segment) || segment === 'software') return [];

  const info = line.packageInfo || null;
  const master = info?.masterCarton || null;
  const singles = (Array.isArray(info?.singleBox) ? info.singleBox : [])
    .filter(cartonOk);
  const masterOk = cartonOk(master);
  const masterQty = masterOk && typeof master.quantity === 'number' && master.quantity > 0
    ? Math.floor(master.quantity)
    : 0;

  const parcels = [];
  let remaining = qty;

  if (masterOk && masterQty > 0) {
    const masters = Math.floor(remaining / masterQty);
    for (let i = 0; i < masters; i += 1) {
      parcels.push({
        actualKg: Number(master.weightKg),
        dims: {
          lengthCm: master.lengthCm,
          widthCm: master.breadthCm,
          heightCm: master.heightCm,
        },
      });
    }
    remaining -= masters * masterQty;
  }

  if (remaining > 0 && singles.length) {
    for (let u = 0; u < remaining; u += 1) {
      for (const box of singles) {
        parcels.push({
          actualKg: Number(box.weightKg),
          dims: {
            lengthCm: box.lengthCm,
            widthCm: box.breadthCm,
            heightCm: box.heightCm,
          },
        });
      }
    }
  }

  return parcels;
}

function quoteParcels(zone, rates, parcels) {
  let chargeableBeforeMin = 0;
  for (const parcel of parcels) {
    const vol = volumetricKg(parcel.dims, rates.volumetricDivisor);
    const base = rates.useChargeableWeight
      ? Math.max(parcel.actualKg, vol)
      : parcel.actualKg;
    chargeableBeforeMin += base;
  }
  const minKg = nonNeg(rates.minimumChargeableWeightKg);
  const chargeableKg = Math.max(chargeableBeforeMin, minKg);
  const boxPerKgInr = nonNeg(rates.zones?.[zone]?.boxPerKgInr);
  const freightInr = boxPerKgInr * chargeableKg;
  const fuelSurchargeInr = freightInr * (nonNeg(rates.fuelSurchargePercent) / 100);
  return {
    chargeableKg,
    totalInr: Math.round((freightInr + fuelSurchargeInr) * 100) / 100,
  };
}

function freightOption(sku) {
  return FREIGHT_LINE_OPTIONS.find(opt => String(opt.sku).toUpperCase() === String(sku).toUpperCase())
    || FREIGHT_LINE_OPTIONS[0];
}

function makeFreightLine({ sku, rate, site, hostSegment }) {
  const opt = freightOption(sku);
  const amount = Math.round(nonNeg(rate) * 100) / 100;
  return {
    productId: opt.productId,
    itemId: opt.productId,
    name: opt.name,
    sku: opt.sku,
    imageUrl: null,
    description: null,
    rate: amount,
    catalogRate: amount,
    unit: 'nos',
    quantity: 1,
    lineTotal: amount,
    stockStatus: 'in_stock',
    categoryName: null,
    categoryId: null,
    taxPercentage: 0,
    hsn: null,
    warehouses: [],
    freightInventorySite: site,
    freightHostSegment: hostSegment,
  };
}

function mapPackageCarton(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lengthCm = Number(raw.lengthCm);
  const breadthCm = Number(raw.breadthCm);
  const heightCm = Number(raw.heightCm);
  const weightKg = Number(raw.weightKg);
  const quantity = raw.quantity == null ? null : Number(raw.quantity);
  return {
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    weightKg: Number.isFinite(weightKg) ? weightKg : null,
    lengthCm: Number.isFinite(lengthCm) ? lengthCm : null,
    breadthCm: Number.isFinite(breadthCm) ? breadthCm : null,
    heightCm: Number.isFinite(heightCm) ? heightCm : null,
  };
}

export function mapPackageInfo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const masterCarton = mapPackageCarton(raw.masterCarton);
  let singleBox = null;
  if (Array.isArray(raw.singleBox)) {
    singleBox = raw.singleBox.map(mapPackageCarton).filter(Boolean);
  } else if (raw.singleBox && typeof raw.singleBox === 'object') {
    const one = mapPackageCarton(raw.singleBox);
    singleBox = one ? [one] : null;
  }
  if (!masterCarton && !(singleBox && singleBox.length)) return null;
  return { masterCarton, singleBox };
}

/**
 * Build auto freight lines for dealer checkout (product ST quote + spare minimum).
 * Always emits a line per product/spare site bucket (amount may be ₹0).
 */
export function buildDealerAutoFreightLines({
  lines,
  destination,
  courierRates,
  spareFreightMinimumInr = 0,
}) {
  const rates = parseLogisticsCourierRates(courierRates);
  const zone = inferStCourierZone(destination) || 'rest_of_india';
  const spareMin = nonNeg(Number(spareFreightMinimumInr));

  /** @type {Map<string, object[]>} */
  const productParcelsBySite = new Map();
  /** @type {Set<string>} */
  const spareSites = new Set();
  /** @type {Set<string>} */
  const productSites = new Set();

  for (const line of lines || []) {
    if (line?.freightInventorySite || line?.freightHostSegment) continue;
    const segment = classifyOrderLineSegment(line);
    if (!segmentAllowsFreight(segment)) continue;
    const site = resolveLineInventorySite(segment, line.warehouses);
    if (segment === 'spare') {
      spareSites.add(site);
      continue;
    }
    productSites.add(site);
    const parcels = cartonizeLine(line);
    if (!parcels.length) continue;
    const key = site;
    const list = productParcelsBySite.get(key) || [];
    list.push(...parcels);
    productParcelsBySite.set(key, list);
  }

  const freightLines = [];

  for (const site of ['cochin', 'head_office']) {
    if (!productSites.has(site)) continue;
    const parcels = productParcelsBySite.get(site) || [];
    const quoted = parcels.length
      ? quoteParcels(zone, rates.st_courier[site], parcels)
      : { totalInr: 0 };
    freightLines.push(makeFreightLine({
      sku: 'STFRC',
      rate: quoted.totalInr,
      site,
      hostSegment: 'product',
    }));
  }

  for (const site of ['cochin', 'head_office']) {
    if (!spareSites.has(site)) continue;
    freightLines.push(makeFreightLine({
      sku: 'STFRC',
      rate: spareMin,
      site,
      hostSegment: 'spare',
    }));
  }

  return freightLines;
}
