/**
 * Blue Dart freight quote engine (client).
 *
 * Inputs: BlueDartConfig from Firestore + optional blueDartPincodes/{zip} +
 * shipping state + parcel weight/dims (+ invoice value for FOV).
 *
 * Zone resolution:
 * - Air/Surface: shared.originRegion × dest state→region → zoneMatrix → Zone 1–5
 * - DP: Kerala dest (+ Kerala origin) → A1; else pin.dpZone A/B/C
 *
 * v1 charge stack (HARDCODED order — change here + functions/lib/blue-dart-quote.js):
 *   base (₹/kg or 500g slabs, with min freight/weight)
 *   → PSS% + IDC% on base
 *   → FS% then CAF% (shared, or per-service override)
 *   → EFSS%
 *   → docket (Air/Surface)
 *   → RAS ₹/kg if dest in rasStates
 *   → FOV max(min, % of invoice)
 *   → EDL (NE/J&K special, else flat_fallback / matrix_when_km)
 *   → GST% on subtotal
 *   → ceilCourierChargeInr
 *
 * Skipped VAS (not wired): FOD, DOD, DG, demurrage, appointment/SEZ, laptop box, ECC.
 * Keep server mirror in functions/lib/blue-dart-quote.js in sync.
 */
import { isRasDestination, resolveBlueDartRegion } from './blueDartPlace';
import { resolveBlueDartAirZone, resolveBlueDartDpZone } from './blueDartZone';
import { ceilCourierChargeInr } from './stCourierQuote';
import type {
  BlueDartAirZone,
  BlueDartConfig,
  BlueDartDpZone,
  BlueDartEdlDistanceRow,
  BlueDartKgServiceRates,
  BlueDartPincodeDoc,
  BlueDartServiceability,
  BlueDartSharedRules,
} from '../types/blue-dart-rates';
import { isBlueDartServiceability } from '../types/blue-dart-rates';
import type { BlueDartServiceId } from '../types/logistics-courier-rates';
import { BLUE_DART_SERVICE_META } from '../types/logistics-courier-rates';

export type BlueDartQuoteDims = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type BlueDartQuoteBreakdown = {
  service: BlueDartServiceId;
  sku: string;
  zoneLabel: string;
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  baseFreightInr: number;
  docketFeeInr: number;
  pssInr: number;
  idcInr: number;
  fuelSurchargeInr: number;
  cafInr: number;
  efssInr: number;
  rasInr: number;
  fovInr: number;
  edlInr: number;
  subtotalExGstInr: number;
  gstInr: number;
  totalInr: number;
  rateMissing: boolean;
  notServiceable: boolean;
  notServiceableReason: string | null;
};

function nonNeg(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

export function blueDartVolumetricKg(dims: BlueDartQuoteDims, divisor: number): number {
  const l = nonNeg(dims.lengthCm);
  const w = nonNeg(dims.widthCm);
  const h = nonNeg(dims.heightCm);
  const d = divisor > 0 ? divisor : 5000;
  if (!l || !w || !h) return 0;
  return (l * w * h) / d;
}

export function blueDartChargeableKg(input: {
  actualKg: number;
  dims: BlueDartQuoteDims;
  volumetricDivisor: number;
  minimumChargeableWeightKg: number;
}): number {
  const actual = nonNeg(input.actualKg);
  const vol = blueDartVolumetricKg(input.dims, input.volumetricDivisor);
  const raw = Math.max(actual, vol);
  const min = nonNeg(input.minimumChargeableWeightKg);
  return min > 0 ? Math.max(raw, min) : raw;
}

function parseServiceability(raw: unknown): BlueDartServiceability | string {
  const value = String(raw ?? '').trim();
  if (isBlueDartServiceability(value)) return value;
  return value || 'No';
}

export function blueDartServiceAllowed(input: {
  service: BlueDartServiceId;
  pin: BlueDartPincodeDoc | null | undefined;
  hideTemPer: boolean;
}): { allowed: boolean; isEdl: boolean; reason: string | null } {
  if (!input.pin) {
    return { allowed: true, isEdl: false, reason: null };
  }
  const code = parseServiceability(
    input.service === 'air'
      ? input.pin.apxService
      : input.service === 'surface'
        ? input.pin.sfcService
        : input.pin.dpService,
  );
  if (code === 'Yes') return { allowed: true, isEdl: false, reason: null };
  if (code === 'EDL') return { allowed: true, isEdl: true, reason: null };
  if (code === 'TEM' || code === 'PER') {
    if (input.hideTemPer) {
      return { allowed: false, isEdl: false, reason: `Pin marked ${code}` };
    }
    return { allowed: true, isEdl: false, reason: null };
  }
  if (code === 'No' || !code) {
    return { allowed: false, isEdl: false, reason: 'Not serviceable for this pin' };
  }
  return { allowed: false, isEdl: false, reason: `Unknown serviceability (${code})` };
}

function edlWeightBandIndex(kg: number): number {
  if (kg <= 100) return 0;
  if (kg <= 250) return 1;
  if (kg <= 500) return 2;
  if (kg <= 1000) return 3;
  return 4;
}

function lookupEdlMatrixAmount(
  matrix: BlueDartEdlDistanceRow[],
  edlKm: number,
  chargeableKg: number,
): number | null {
  const row = matrix.find(r => edlKm >= r.distanceKmMin && edlKm <= r.distanceKmMax);
  if (!row) return null;
  return nonNeg(row.amountsInr[edlWeightBandIndex(chargeableKg)]);
}

export function computeBlueDartEdlInr(input: {
  shared: BlueDartSharedRules;
  destState: string | null | undefined;
  isEdl: boolean;
  chargeableKg: number;
  edlKm: number | null | undefined;
}): number {
  if (!input.isEdl || input.shared.edlMode === 'off') return 0;

  const region = resolveBlueDartRegion(input.destState, input.shared.regionsByState);
  if (region === 'NE' || region === 'JK') {
    const perKg = nonNeg(input.shared.edlNeJkPerKgInr) * nonNeg(input.chargeableKg);
    return Math.max(perKg, nonNeg(input.shared.edlNeJkFloorInr));
  }

  if (input.shared.edlMode === 'ne_jk_only') return 0;

  const km = input.edlKm != null && Number.isFinite(input.edlKm) ? Number(input.edlKm) : null;

  if (km != null && km > 0 && input.shared.edlMode === 'matrix_when_km') {
    if (km > 500 || input.chargeableKg > 1500) {
      const byKm = km > 500 ? km * nonNeg(input.shared.edlBeyond500KmPerKmInr) : 0;
      const byKg = input.chargeableKg > 1500
        ? input.chargeableKg * nonNeg(input.shared.edlBeyond1500KgPerKgInr)
        : 0;
      const matrix = lookupEdlMatrixAmount(input.shared.edlMatrix, Math.min(km, 500), input.chargeableKg) ?? 0;
      return Math.max(byKm, byKg, matrix);
    }
    return lookupEdlMatrixAmount(input.shared.edlMatrix, km, input.chargeableKg) ?? 0;
  }

  if (
    input.shared.edlMode === 'flat_fallback'
    || input.shared.edlMode === 'matrix_when_km'
  ) {
    return nonNeg(input.shared.edlFlatFallbackInr);
  }
  return 0;
}

function resolveFsCaf(
  shared: BlueDartSharedRules,
  serviceFs: number | null,
  serviceCaf: number | null,
): { fs: number; caf: number } {
  return {
    fs: serviceFs != null && Number.isFinite(serviceFs) ? nonNeg(serviceFs) : nonNeg(shared.fuelSurchargePercent),
    caf: serviceCaf != null && Number.isFinite(serviceCaf) ? nonNeg(serviceCaf) : nonNeg(shared.cafPercent),
  };
}

function fovInr(
  shared: BlueDartSharedRules,
  serviceFov: { minInr: number; percentOfInvoice: number } | null,
  invoiceValueInr: number,
): number {
  const rule = serviceFov ?? shared.fov;
  const fromPct = nonNeg(invoiceValueInr) * (nonNeg(rule.percentOfInvoice) / 100);
  return Math.max(nonNeg(rule.minInr), fromPct);
}

function quoteKgService(input: {
  service: 'air' | 'surface';
  config: BlueDartConfig;
  zone: BlueDartAirZone;
  chargeableKg: number;
  invoiceValueInr: number;
  destState: string | null | undefined;
  isEdl: boolean;
  edlKm: number | null | undefined;
}): Omit<BlueDartQuoteBreakdown, 'service' | 'sku' | 'zoneLabel' | 'actualKg' | 'volumetricKg' | 'notServiceable' | 'notServiceableReason'> {
  const rates: BlueDartKgServiceRates = input.config[input.service];
  const perKg = nonNeg(rates.perKgInr[input.zone]);
  const rateMissing = !(perKg > 0);
  let base = perKg * input.chargeableKg;
  if (rates.minimumFreightInr > 0) base = Math.max(base, rates.minimumFreightInr);
  const docket = nonNeg(rates.docketFeeInr);
  const pss = base * (nonNeg(rates.pssPercent) / 100);
  const idc = base * (nonNeg(rates.idcPercent) / 100);
  const afterPssIdc = base + pss + idc;
  const { fs, caf } = resolveFsCaf(input.config.shared, rates.fuelSurchargePercent, rates.cafPercent);
  const fuel = afterPssIdc * (fs / 100);
  const afterFuel = afterPssIdc + fuel;
  const cafInr = afterFuel * (caf / 100);
  const afterCaf = afterFuel + cafInr;
  const efss = afterCaf * (nonNeg(rates.efssPercent) / 100);
  const rasRate = rates.rasPerKgInr != null
    ? nonNeg(rates.rasPerKgInr)
    : nonNeg(input.config.shared.rasPerKgInr);
  const ras = isRasDestination(input.destState, input.config.shared.rasStates)
    ? rasRate * input.chargeableKg
    : 0;
  const fov = fovInr(input.config.shared, rates.fov, input.invoiceValueInr);
  const edl = computeBlueDartEdlInr({
    shared: input.config.shared,
    destState: input.destState,
    isEdl: input.isEdl,
    chargeableKg: input.chargeableKg,
    edlKm: input.edlKm,
  });
  const subtotal = afterCaf + efss + docket + ras + fov + edl;
  const gst = subtotal * (nonNeg(input.config.shared.gstPercent) / 100);
  const total = ceilCourierChargeInr(subtotal + gst);
  return {
    chargeableKg: input.chargeableKg,
    baseFreightInr: base,
    docketFeeInr: docket,
    pssInr: pss,
    idcInr: idc,
    fuelSurchargeInr: fuel,
    cafInr,
    efssInr: efss,
    rasInr: ras,
    fovInr: fov,
    edlInr: edl,
    subtotalExGstInr: subtotal,
    gstInr: gst,
    totalInr: total,
    rateMissing,
  };
}

function quoteDomesticPriority(input: {
  config: BlueDartConfig;
  zone: BlueDartDpZone;
  chargeableKg: number;
}): Omit<BlueDartQuoteBreakdown, 'service' | 'sku' | 'zoneLabel' | 'actualKg' | 'volumetricKg' | 'notServiceable' | 'notServiceableReason' | 'docketFeeInr' | 'rasInr' | 'fovInr' | 'edlInr'> & {
  docketFeeInr: number;
  rasInr: number;
  fovInr: number;
  edlInr: number;
} {
  const rates = input.config.domestic_priority;
  const first = nonNeg(rates.first500gInr[input.zone]);
  const addl = nonNeg(rates.addl500gInr[input.zone]);
  const rateMissing = !(first > 0);
  const grams = input.chargeableKg * 1000;
  const slabs = Math.max(1, Math.ceil(grams / 500));
  const base = first + Math.max(0, slabs - 1) * addl;
  const pss = base * (nonNeg(rates.pssPercent) / 100);
  const idc = base * (nonNeg(rates.idcPercent) / 100);
  const afterPssIdc = base + pss + idc;
  const { fs, caf } = resolveFsCaf(input.config.shared, rates.fuelSurchargePercent, rates.cafPercent);
  const fuel = afterPssIdc * (fs / 100);
  const afterFuel = afterPssIdc + fuel;
  const cafInr = afterFuel * (caf / 100);
  const afterCaf = afterFuel + cafInr;
  const efss = afterCaf * (nonNeg(rates.efssPercent) / 100);
  const subtotal = afterCaf + efss;
  const gst = subtotal * (nonNeg(input.config.shared.gstPercent) / 100);
  return {
    chargeableKg: input.chargeableKg,
    baseFreightInr: base,
    docketFeeInr: 0,
    pssInr: pss,
    idcInr: idc,
    fuelSurchargeInr: fuel,
    cafInr,
    efssInr: efss,
    rasInr: 0,
    fovInr: 0,
    edlInr: 0,
    subtotalExGstInr: subtotal,
    gstInr: gst,
    totalInr: ceilCourierChargeInr(subtotal + gst),
    rateMissing,
  };
}

export function quoteBlueDartShipment(input: {
  config: BlueDartConfig;
  service: BlueDartServiceId;
  destState: string | null | undefined;
  pin?: BlueDartPincodeDoc | null;
  actualKg: number;
  dims: BlueDartQuoteDims;
  invoiceValueInr?: number;
}): BlueDartQuoteBreakdown {
  const meta = BLUE_DART_SERVICE_META[input.service];
  const access = blueDartServiceAllowed({
    service: input.service,
    pin: input.pin,
    hideTemPer: input.config.shared.hideTemPer,
  });

  const empty = (extra: Partial<BlueDartQuoteBreakdown>): BlueDartQuoteBreakdown => ({
    service: input.service,
    sku: meta.sku,
    zoneLabel: '—',
    actualKg: nonNeg(input.actualKg),
    volumetricKg: 0,
    chargeableKg: 0,
    baseFreightInr: 0,
    docketFeeInr: 0,
    pssInr: 0,
    idcInr: 0,
    fuelSurchargeInr: 0,
    cafInr: 0,
    efssInr: 0,
    rasInr: 0,
    fovInr: 0,
    edlInr: 0,
    subtotalExGstInr: 0,
    gstInr: 0,
    totalInr: 0,
    rateMissing: true,
    notServiceable: !access.allowed,
    notServiceableReason: access.reason,
    ...extra,
  });

  if (!access.allowed) {
    return empty({});
  }

  if (input.service === 'domestic_priority') {
    const zone = resolveBlueDartDpZone({
      destState: input.destState,
      pin: input.pin,
    });
    if (!zone) {
      return empty({ notServiceable: true, notServiceableReason: 'Cannot resolve DP zone' });
    }
    const divisor = input.config.domestic_priority.volumetricDivisor;
    const volumetricKg = blueDartVolumetricKg(input.dims, divisor);
    const chargeableKg = blueDartChargeableKg({
      actualKg: input.actualKg,
      dims: input.dims,
      volumetricDivisor: divisor,
      minimumChargeableWeightKg: 0.5,
    });
    const q = quoteDomesticPriority({
      config: input.config,
      zone,
      chargeableKg,
    });
    return {
      service: input.service,
      sku: meta.sku,
      zoneLabel: `DP ${zone}`,
      actualKg: nonNeg(input.actualKg),
      volumetricKg,
      notServiceable: false,
      notServiceableReason: null,
      ...q,
    };
  }

  const zone = resolveBlueDartAirZone({
    shared: input.config.shared,
    destState: input.destState,
  });
  if (!zone) {
    return empty({ notServiceable: true, notServiceableReason: 'Cannot resolve Air/Surface zone' });
  }
  const rates = input.config[input.service];
  const volumetricKg = blueDartVolumetricKg(input.dims, rates.volumetricDivisor);
  const chargeableKg = blueDartChargeableKg({
    actualKg: input.actualKg,
    dims: input.dims,
    volumetricDivisor: rates.volumetricDivisor,
    minimumChargeableWeightKg: rates.minimumChargeableWeightKg,
  });
  const q = quoteKgService({
    service: input.service,
    config: input.config,
    zone,
    chargeableKg,
    invoiceValueInr: nonNeg(input.invoiceValueInr),
    destState: input.destState,
    isEdl: access.isEdl,
    edlKm: input.pin?.edlKm ?? null,
  });
  return {
    service: input.service,
    sku: meta.sku,
    zoneLabel: `Zone ${zone}`,
    actualKg: nonNeg(input.actualKg),
    volumetricKg,
    notServiceable: false,
    notServiceableReason: null,
    ...q,
  };
}

/** Sum parcel quotes for multi-parcel shipments (one AWB — docket/FOV/EDL once). */
export function quoteBlueDartParcels(input: {
  config: BlueDartConfig;
  service: BlueDartServiceId;
  destState: string | null | undefined;
  pin?: BlueDartPincodeDoc | null;
  parcels: Array<{ actualKg: number; dims: BlueDartQuoteDims }>;
  invoiceValueInr?: number;
}): BlueDartQuoteBreakdown {
  if (!input.parcels.length) {
    return quoteBlueDartShipment({
      ...input,
      actualKg: 0,
      dims: { lengthCm: 0, widthCm: 0, heightCm: 0 },
    });
  }

  // Combine into one shipment weight (sum actual; max volumetric envelope approx via sum of vols).
  let actualKg = 0;
  let maxL = 0;
  let maxW = 0;
  let sumH = 0;
  for (const p of input.parcels) {
    actualKg += nonNeg(p.actualKg);
    maxL = Math.max(maxL, nonNeg(p.dims.lengthCm));
    maxW = Math.max(maxW, nonNeg(p.dims.widthCm));
    sumH += nonNeg(p.dims.heightCm);
  }

  // Prefer summing volumetric kg via a synthetic dims that preserves total volume.
  const totalVolume = input.parcels.reduce((acc, p) => {
    const l = nonNeg(p.dims.lengthCm);
    const w = nonNeg(p.dims.widthCm);
    const h = nonNeg(p.dims.heightCm);
    return acc + l * w * h;
  }, 0);
  const side = totalVolume > 0 ? Math.cbrt(totalVolume) : 0;

  return quoteBlueDartShipment({
    config: input.config,
    service: input.service,
    destState: input.destState,
    pin: input.pin,
    actualKg,
    dims: side > 0
      ? { lengthCm: side, widthCm: side, heightCm: side }
      : { lengthCm: maxL, widthCm: maxW, heightCm: sumH },
    invoiceValueInr: input.invoiceValueInr,
  });
}
