/**
 * Server-side ST cartonize + quote helpers for dealer checkout freight lines.
 * Mirrors src/lib/stCourierZone.ts + stCourierCartFreight.ts (keep in sync).
 */
import { FREIGHT_LINE_OPTIONS } from './freight-lines.js';
import {
  parseBlueDartConfig,
  quoteBlueDartParcels,
} from './blue-dart-quote.js';
import {
  classifyOrderLineSegment,
  resolveLineInventorySite,
  segmentAllowsFreight,
} from './sales-order-segments.js';

const ST_ZONES = [
  'kerala',
  'tamil_nadu_pondy',
  'other_states',
];

function isStCourierZone(value) {
  return typeof value === 'string' && ST_ZONES.includes(value);
}

export function resolveFreightZone(destination, freightZone) {
  const inferred = inferStCourierZone(destination) || 'other_states';
  const selected = isStCourierZone(freightZone) ? freightZone : inferred;
  return {
    inferredZone: inferred,
    zone: selected,
    zoneOverridden: selected !== inferred,
  };
}

const DEFAULT_DIVISOR = 5000;

function nonNeg(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/** Round courier ₹ up to the next whole rupee (59.2 → 60). */
function ceilCourierChargeInr(value) {
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

export function inferStCourierZone(destination) {
  const state = normalizePlace(destination?.state);
  const city = normalizePlace(destination?.city);
  if (!state && !city) return null;

  if (state === 'kerala' || state === 'kl' || state.includes('kerala')) return 'kerala';

  if (
    state === 'puducherry' || state === 'pondicherry' || state === 'pondy' || state === 'py'
    || state.includes('puducherry') || state.includes('pondicherry')
    || city === 'puducherry' || city === 'pondicherry'
    || city.includes('pondicherry') || city.includes('puducherry')
    || state === 'tamil nadu' || state === 'tamilnadu' || state === 'tn'
    || state.includes('tamil nadu') || state.includes('tamilnadu')
  ) {
    return 'tamil_nadu_pondy';
  }

  return 'other_states';
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
  const pickZone = (...keys) => {
    for (const key of keys) {
      if (zonesRaw[key] && typeof zonesRaw[key] === 'object') return zonesRaw[key];
    }
    return {};
  };
  const assign = (zone, z) => {
    zones[zone] = {
      envelopeFixedInr: nonNeg(Number(z.envelopeFixedInr)),
      boxPerKgInr: nonNeg(Number(z.boxPerKgInr)),
    };
  };
  assign('kerala', pickZone('kerala'));
  assign('tamil_nadu_pondy', pickZone('tamil_nadu_pondy', 'tamil_nadu'));
  assign('other_states', pickZone(
    'other_states',
    'rest_of_india',
    'mumbai',
    'delhi',
    'karnataka',
    'andhra_pradesh',
  ));
  return {
    volumetricDivisor: nonNeg(Number(raw.volumetricDivisor)) || DEFAULT_DIVISOR,
    useChargeableWeight: raw.useChargeableWeight !== false,
    minimumChargeableWeightKg: nonNeg(Number(raw.minimumChargeableWeightKg)),
    fuelSurchargePercent: nonNeg(Number(raw.fuelSurchargePercent)),
    zones,
  };
}

const ZONE_KEYS = ['kerala', 'tamil_nadu_pondy', 'other_states'];

function parseSharedPartnerRates(raw) {
  if (!raw || typeof raw !== 'object') return parseOriginRates(null);
  // Legacy by-origin → prefer head_office if it has any prices.
  if (raw.cochin != null || raw.head_office != null) {
    const head = parseOriginRates(raw.head_office);
    const cochin = parseOriginRates(raw.cochin);
    const headHas = ZONE_KEYS.some(z => (
      (head.zones?.[z]?.boxPerKgInr || 0) > 0
      || (head.zones?.[z]?.envelopeFixedInr || 0) > 0
    ));
    return headHas ? head : cochin;
  }
  return parseOriginRates(raw);
}

export function parseLogisticsCourierRates(data) {
  const emptyByOrigin = () => ({
    cochin: parseOriginRates(null),
    head_office: parseOriginRates(null),
  });
  if (!data || typeof data !== 'object') {
    return {
      st_courier: emptyByOrigin(),
      trackon: parseOriginRates(null),
      delhivery: parseOriginRates(null),
      bluedart: parseBlueDartConfig(null),
    };
  }
  const stRaw = data.st_courier && typeof data.st_courier === 'object' ? data.st_courier : {};
  return {
    st_courier: {
      cochin: parseOriginRates(stRaw.cochin),
      head_office: parseOriginRates(stRaw.head_office),
    },
    trackon: parseSharedPartnerRates(data.trackon),
    delhivery: parseSharedPartnerRates(data.delhivery),
    bluedart: parseBlueDartConfig(data.bluedart),
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
    totalInr: ceilCourierChargeInr(freightInr + fuelSurchargeInr),
  };
}

function freightOption(sku) {
  return FREIGHT_LINE_OPTIONS.find(opt => String(opt.sku).toUpperCase() === String(sku).toUpperCase())
    || FREIGHT_LINE_OPTIONS[0];
}

function makeFreightLine({ sku, rate, site, hostSegment }) {
  const opt = freightOption(sku);
  const amount = ceilCourierChargeInr(rate);
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

const PARTNER_FREIGHT_SKU = {
  st_courier: 'STFRC',
  trackon: 'TRFRC',
  delhivery: 'DELFRC',
  bluedart: 'BDFRC',
};

function normalizeCourierBySite(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const site of ['cochin', 'head_office']) {
    const id = String(raw[site] ?? '').trim();
    if (id) out[site] = id;
  }
  return out;
}

function partnerOriginRates(rates, partnerId, site) {
  if (partnerId === 'bluedart') return null;
  if (partnerId === 'st_courier') {
    return rates.st_courier?.[site] || null;
  }
  if (partnerId === 'trackon' || partnerId === 'delhivery') {
    return rates[partnerId] || null;
  }
  return null;
}

/**
 * Build auto freight lines for dealer checkout.
 * Pickup → no freight lines. Otherwise one freight SKU line per product/spare site bucket.
 */
export function buildDealerAutoFreightLines({
  lines,
  destination,
  courierRates,
  spareFreightMinimumInr = 0,
  courierBySite = {},
  freightZone = null,
  blueDartPin = null,
  blueDartService = 'surface',
  invoiceValueInr = 0,
}) {
  const rates = parseLogisticsCourierRates(courierRates);
  const { zone } = resolveFreightZone(destination, freightZone);
  const spareMin = nonNeg(Number(spareFreightMinimumInr));
  const selected = normalizeCourierBySite(courierBySite);

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
    const list = productParcelsBySite.get(site) || [];
    list.push(...parcels);
    productParcelsBySite.set(site, list);
  }

  const freightLines = [];
  const sites = new Set([...productSites, ...spareSites]);

  for (const site of ['cochin', 'head_office']) {
    if (!sites.has(site)) continue;
    const partnerId = selected[site] || 'st_courier';
    if (partnerId === 'personal_collection') continue;

    let sku = PARTNER_FREIGHT_SKU[partnerId] || 'STFRC';
    const originRates = partnerOriginRates(rates, partnerId, site) || rates.st_courier[site];

    if (productSites.has(site)) {
      const parcels = productParcelsBySite.get(site) || [];
      let totalInr = 0;
      if (partnerId === 'bluedart') {
        const bd = parcels.length
          ? quoteBlueDartParcels({
            config: rates.bluedart,
            service: blueDartService,
            destState: destination?.state,
            pin: blueDartPin,
            parcels,
            invoiceValueInr,
          })
          : { totalInr: 0, sku: 'BDFRC' };
        totalInr = bd.totalInr || 0;
        sku = bd.sku || sku;
      } else {
        const quoted = parcels.length
          ? quoteParcels(zone, originRates, parcels)
          : { totalInr: 0 };
        totalInr = quoted.totalInr;
      }
      freightLines.push(makeFreightLine({
        sku,
        rate: totalInr,
        site,
        hostSegment: 'product',
      }));
    }

    if (spareSites.has(site)) {
      freightLines.push(makeFreightLine({
        sku,
        rate: ceilCourierChargeInr(spareMin),
        site,
        hostSegment: 'spare',
      }));
    }
  }

  return freightLines;
}
