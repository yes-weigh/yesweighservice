/**
 * Server spare freight quote — mirrors src/lib/spareFreightQuote.ts.
 */
import { parseBlueDartConfig } from './blue-dart-quote.js';
import { quoteTrackonParcels } from './trackon-quote.js';

const SPARE_FREIGHT_BILLABLE_KG = 1;

const BLUEDART_PARTNER_SERVICE = {
  bluedart_air: 'air',
  bluedart_surface: 'surface',
  bluedart_domestic: 'domestic_priority',
  bluedart: 'surface',
};

const TRACKON_PARTNERS = new Set(['trackon_air', 'trackon_surface', 'trackon']);

function nonNeg(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

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

function resolveRegion(state, regionsByState) {
  const key = normalizePlace(state);
  if (!key) return null;
  if (regionsByState[key]) return regionsByState[key];
  for (const [name, region] of Object.entries(regionsByState || {})) {
    if (key.includes(name) || name.includes(key)) return region;
  }
  return null;
}

function emptySpareQuote(flags = {}) {
  return {
    totalInr: 0,
    chargeableKg: 0,
    perKgInr: 0,
    fuelSurchargePercent: 0,
    fuelSurchargeInr: 0,
    skipped: Boolean(flags.skipped),
    rateMissing: Boolean(flags.rateMissing),
  };
}

function originRatesForPartner(rates, partnerId, site) {
  if (partnerId === 'st_courier') return rates.st_courier?.[site] || null;
  if (partnerId === 'delhivery') return rates.delhivery || null;
  return null;
}

function quoteStStyleSpare(originRates, zone) {
  const boxPerKgInr = nonNeg(originRates?.zones?.[zone]?.boxPerKgInr);
  const fuelSurchargePercent = nonNeg(originRates?.fuelSurchargePercent);
  if (!(boxPerKgInr > 0)) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: SPARE_FREIGHT_BILLABLE_KG,
      fuelSurchargePercent,
    };
  }
  const freightInr = boxPerKgInr * SPARE_FREIGHT_BILLABLE_KG;
  const fuelSurchargeInr = freightInr * (fuelSurchargePercent / 100);
  return {
    totalInr: ceilCourierChargeInr(freightInr + fuelSurchargeInr),
    chargeableKg: SPARE_FREIGHT_BILLABLE_KG,
    perKgInr: boxPerKgInr,
    fuelSurchargePercent,
    fuelSurchargeInr,
    skipped: false,
    rateMissing: false,
  };
}

function quoteBlueDartSimpleSpare(rates, partnerId, destination) {
  const service = BLUEDART_PARTNER_SERVICE[partnerId];
  if (!service || service === 'domestic_priority') {
    return emptySpareQuote({ skipped: true });
  }
  const cfg = parseBlueDartConfig(rates?.bluedart);
  const destRegion = resolveRegion(destination?.state, cfg.shared.regionsByState);
  const zone = destRegion
    ? cfg.shared.zoneMatrix[cfg.shared.originRegion]?.[destRegion]
    : null;
  if (!zone) return emptySpareQuote({ rateMissing: true });
  const perKgInr = nonNeg(cfg[service]?.perKgInr?.[zone]);
  if (!(perKgInr > 0)) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: SPARE_FREIGHT_BILLABLE_KG,
    };
  }
  return {
    totalInr: ceilCourierChargeInr(perKgInr * SPARE_FREIGHT_BILLABLE_KG),
    chargeableKg: SPARE_FREIGHT_BILLABLE_KG,
    perKgInr,
    fuelSurchargePercent: 0,
    fuelSurchargeInr: 0,
    skipped: false,
    rateMissing: false,
  };
}

function quoteTrackonSurfaceSpare(rates, destination) {
  const quoted = quoteTrackonParcels({
    config: rates?.trackon,
    service: 'surface',
    destination,
    parcels: [{ actualKg: SPARE_FREIGHT_BILLABLE_KG }],
  });
  if (quoted.notServiceable || quoted.rateMissing) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: quoted.chargeableKg || 0,
    };
  }
  const fuelSurchargePercent = nonNeg(quoted.fuelSurchargeInr > 0
    ? (rates?.trackon?.shared?.fuelSurchargePercent ?? 15)
    : (rates?.trackon?.shared?.fuelSurchargePercent ?? 15));
  return {
    totalInr: quoted.totalInr,
    chargeableKg: quoted.chargeableKg,
    perKgInr: quoted.chargeableKg > 0
      ? Math.round((quoted.freightInr / quoted.chargeableKg) * 100) / 100
      : 0,
    fuelSurchargePercent,
    fuelSurchargeInr: quoted.fuelSurchargeInr,
    skipped: false,
    rateMissing: false,
  };
}

/**
 * @param {{
 *   partnerId: string,
 *   site: 'cochin' | 'head_office',
 *   zone: string,
 *   destination?: { state?: string|null, city?: string|null, zip?: string|null }|null,
 *   rates: object,
 * }} input
 */
export function quoteSpareFreight(input) {
  const partnerId = String(input.partnerId || '').trim();
  if (
    !partnerId
    || partnerId === 'personal_collection'
    || partnerId === 'dtdc'
    || partnerId === 'ecosafe'
    || partnerId === 'aps'
  ) {
    return emptySpareQuote({ skipped: true });
  }
  if (TRACKON_PARTNERS.has(partnerId)) {
    return quoteTrackonSurfaceSpare(input.rates, input.destination);
  }
  if (BLUEDART_PARTNER_SERVICE[partnerId]) {
    return quoteBlueDartSimpleSpare(input.rates, partnerId, input.destination);
  }
  const originRates = originRatesForPartner(input.rates, partnerId, input.site);
  if (!originRates) return emptySpareQuote({ skipped: true });
  return quoteStStyleSpare(originRates, input.zone);
}
