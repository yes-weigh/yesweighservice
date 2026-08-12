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
 *   Air (matches Apex “Rate Calculation for 10KG” sample):
 *     base → docket → FOV → PSS% + IDC% on base
 *     → FS% on that subtotal → CAF% → EFSS%
 *     → RAS ₹/kg → EDL → ceil
 *   Surface (matches Surface rates.xlsx sample):
 *     base → festival% on base → docket → FOV
 *     → diesel FS% on that subtotal (no CAF, no IDC)
 *     → EFSS% on after-FS
 *     → OS/OW flat ₹ → RAS ₹/kg → ECC (Delhi) → EDL → ceil
 *   Domestic Priority (DOMESTIC PRIORITY sheet):
 *     billable kg = max(actual, vol) stepped up every 500 g (not whole-kg ceil)
 *     → basic (first 500 g + addl 500 g slabs)
 *     → PSS% + IDC% on basic → FS% → CAF% → EFSS% → ceil
 *
 * Skipped VAS (not wired): FOD, DOD, DG, demurrage, appointment/SEZ, laptop box.
 * Keep server mirror in functions/lib/blue-dart-quote.js in sync.
 */
import {
  BLUE_DART_DP_SLAB_KG,
  blueDartAirMaxChargeableExceeded,
  blueDartAirMaxChargeableReason,
  blueDartDpMaxChargeableExceeded,
  blueDartDpMaxChargeableReason,
  blueDartEffectiveCafPercent,
  blueDartEffectiveFuelSurchargePercent,
  blueDartSurfaceEffectiveDieselFsPercent,
  defaultBlueDartAirRates,
  defaultBlueDartSurfaceRates,
  resolveBlueDartOversizeAmountInr,
} from '../constants/blueDartRates';
import { isBlueDartEccDestination, isRasDestination, resolveBlueDartRegion } from './blueDartPlace';
import { resolveBlueDartAirZone, resolveBlueDartDpZone } from './blueDartZone';
import { ceilCourierChargeInr } from './stCourierQuote';
import type {
  BlueDartAirZone,
  BlueDartConfig,
  BlueDartDomesticPriorityRates,
  BlueDartDpZone,
  BlueDartEdlDistanceRow,
  BlueDartKgServiceRates,
  BlueDartPincodeDoc,
  BlueDartServiceability,
  BlueDartSharedRules,
  BlueDartSurfaceRates,
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
  /** Zone ₹/kg for Air/Surface; null for Domestic Priority (500 g slabs). */
  perKgInr: number | null;
  /** Domestic Priority: first 500 g slab ₹ (null for Air/Surface). */
  first500gInr: number | null;
  /** Domestic Priority: each addl 500 g ₹ (null for Air/Surface). */
  addl500gInr: number | null;
  baseFreightInr: number;
  docketFeeInr: number;
  pssInr: number;
  festivalSurchargeInr: number;
  oversizeInr: number;
  idcInr: number;
  fuelSurchargeInr: number;
  cafInr: number;
  efssInr: number;
  rasInr: number;
  fovInr: number;
  /** Environment Compensation Charge — Surface, Delhi dest only. */
  eccInr: number;
  edlInr: number;
  subtotalExGstInr: number;
  gstInr: number;
  totalInr: number;
  rateMissing: boolean;
  notServiceable: boolean;
  notServiceableReason: string | null;
};

/** Ordered charge lines for SO freight calc UI (mirrors Settings stack). */
export type BlueDartFreightCalcStep = {
  label: string;
  /** Short hint under the label (e.g. Docket → “flat · inside FS base”). */
  detail?: string;
  amountInr: number;
};

/**
 * Build the visible charge stack for an SO freight card.
 * Surface order matches Settings → “How Surface adds up”
 * (Basic → Festival → Docket/FOV inside FS base → Diesel FS → EFSS → VAS).
 *
 * Docket / FOV / ECC / EDL are once per shipment — only included when
 * `includeShipmentFees` is true (primary line). OS/OW uses per-box total via
 * `oversizeInrOverride` (not scaled by kg share).
 */
export function blueDartFreightCalcSteps(
  q: BlueDartQuoteBreakdown,
  options?: {
    chargeableKgOverride?: number;
    amountScale?: number;
    /** When false, omit Docket / FOV / ECC / EDL (already shown on another line). */
    includeShipmentFees?: boolean;
    /** Sum of OS/OW for this line’s boxes; when set, replaces scaled shipment oversize. */
    oversizeInrOverride?: number;
  },
): BlueDartFreightCalcStep[] {
  const scale = options?.amountScale != null && Number.isFinite(options.amountScale)
    ? Math.max(0, options.amountScale)
    : 1;
  const kg = options?.chargeableKgOverride != null && options.chargeableKgOverride > 0
    ? options.chargeableKgOverride
    : q.chargeableKg;
  const includeShipmentFees = options?.includeShipmentFees !== false;
  const steps: BlueDartFreightCalcStep[] = [];
  const pushScaled = (label: string, amountInr: number, detail?: string) => {
    const scaled = Math.round(amountInr * scale * 100) / 100;
    if (scaled > 0) steps.push({ label, detail, amountInr: scaled });
  };
  const pushFlat = (label: string, amountInr: number, detail?: string) => {
    const n = Math.round(amountInr * 100) / 100;
    if (n > 0) steps.push({ label, detail, amountInr: n });
  };

  if (q.service === 'surface') {
    if (q.perKgInr != null && q.perKgInr > 0 && kg > 0) {
      pushFlat('Basic freight', q.perKgInr * kg, `₹${q.perKgInr}/kg × ${kg} kg`);
    } else {
      pushScaled('Basic freight', q.baseFreightInr);
    }
    pushScaled('+ Festival', q.festivalSurchargeInr, 'of basic');
    if (includeShipmentFees) {
      pushFlat('+ Docket', q.docketFeeInr, 'flat · once per shipment · inside FS base');
      pushFlat('+ FOV', q.fovInr, 'flat · once per shipment · inside FS base');
    }
    pushScaled('+ Diesel FS', q.fuelSurchargeInr, 'of Subtotal A (basic + festival + docket + FOV)');
    pushScaled('+ EFSS', q.efssInr, 'of Subtotal B');
    if (options?.oversizeInrOverride != null) {
      pushFlat('+ OS/OW', options.oversizeInrOverride, 'per box · after % stack');
    } else {
      pushScaled('+ OS/OW', q.oversizeInr, 'per box · after % stack');
    }
    pushScaled('+ RAS', q.rasInr, '₹/kg · after % stack');
    if (includeShipmentFees) {
      pushFlat('+ ECC', q.eccInr, 'flat · once per shipment');
      pushFlat('+ EDL', q.edlInr, 'flat · once per shipment');
    }
    pushScaled('+ GST', q.gstInr);
    return steps;
  }

  if (q.service === 'domestic_priority') {
    pushScaled('Basic (500 g slabs)', q.baseFreightInr);
    pushScaled('+ PSS', q.pssInr, 'of basic');
    pushScaled('+ IDC', q.idcInr, 'of basic');
    pushScaled('+ Fuel surcharge', q.fuelSurchargeInr);
    pushScaled('+ CAF', q.cafInr);
    pushScaled('+ EFSS', q.efssInr);
    pushScaled('+ GST', q.gstInr);
    return steps;
  }

  /** Air — Apex sample: Docket + FOV inside FS base. */
  if (q.perKgInr != null && q.perKgInr > 0 && kg > 0) {
    pushFlat('Basic freight', q.perKgInr * kg, `₹${q.perKgInr}/kg × ${kg} kg`);
  } else {
    pushScaled('Basic freight', q.baseFreightInr);
  }
  if (includeShipmentFees) {
    pushFlat('+ Docket', q.docketFeeInr, 'flat · once per shipment · inside FS base');
    pushFlat('+ FOV', q.fovInr, 'flat · once per shipment · inside FS base');
  }
  pushScaled('+ PSS', q.pssInr, 'of basic');
  pushScaled('+ IDC', q.idcInr, 'of basic');
  pushScaled(
    '+ Fuel surcharge',
    q.fuelSurchargeInr,
    'of Subtotal A (basic + docket + FOV + PSS + IDC)',
  );
  pushScaled('+ CAF', q.cafInr, 'of After FS');
  pushScaled('+ EFSS', q.efssInr, 'of After CAF');
  pushScaled('+ RAS', q.rasInr, '₹/kg · after % stack');
  if (includeShipmentFees) {
    pushFlat('+ EDL', q.edlInr, 'flat · once per shipment');
  }
  pushScaled('+ GST', q.gstInr);
  return steps;
}

/** Piece chargeable kg for OS/OW (no consignment minimum). */
export function blueDartPieceChargeableKg(
  actualKg: number,
  dims: BlueDartQuoteDims,
  volumetricDivisor: number,
): number {
  const actual = nonNeg(actualKg);
  const vol = blueDartVolumetricKg(dims, volumetricDivisor);
  return ceilChargeableKg(Math.max(actual, vol));
}

/** Sum Surface OS/OW across boxes (each box looked up on its own chargeable kg). */
export function blueDartParcelsOversizeInr(
  slabs: BlueDartConfig['surface']['oversizeSlabs'],
  parcels: Array<{ actualKg: number; dims: BlueDartQuoteDims }>,
  volumetricDivisor: number,
): number {
  let total = 0;
  for (const parcel of parcels) {
    const pieceKg = blueDartPieceChargeableKg(
      parcel.actualKg,
      parcel.dims,
      volumetricDivisor,
    );
    if (pieceKg > 0) {
      total += resolveBlueDartOversizeAmountInr(slabs, pieceKg);
    }
  }
  return total;
}

function nonNeg(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/** Month 1–12; season wraps the year when start > end (e.g. 10→1 = Oct–Jan). */
export function isBlueDartFestivalSeasonMonth(
  month: number,
  startMonth: number,
  endMonth: number,
): boolean {
  const m = Math.round(month);
  const start = Math.round(startMonth);
  const end = Math.round(endMonth);
  if (m < 1 || m > 12 || start < 1 || start > 12 || end < 1 || end > 12) return false;
  if (start === end) return m === start;
  if (start < end) return m >= start && m <= end;
  return m >= start || m <= end;
}

export function blueDartSurfaceFestivalPercent(
  surface: BlueDartSurfaceRates,
  at: Date = new Date(),
): number {
  const pct = nonNeg(surface.festivalSurchargePercent);
  if (!(pct > 0)) return 0;
  const month = at.getMonth() + 1;
  return isBlueDartFestivalSeasonMonth(
    month,
    surface.festivalSeasonStartMonth,
    surface.festivalSeasonEndMonth,
  )
    ? pct
    : 0;
}

/** Round LBH / chargeable kg up to the next whole kilogram (2.1 → 3). */
function ceilChargeableKg(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value);
}

export function blueDartVolumetricKg(dims: BlueDartQuoteDims, divisor: number): number {
  const l = nonNeg(dims.lengthCm);
  const w = nonNeg(dims.widthCm);
  const h = nonNeg(dims.heightCm);
  const d = divisor > 0 ? divisor : 5000;
  if (!l || !w || !h) return 0;
  return ceilChargeableKg((l * w * h) / d);
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
  return ceilChargeableKg(min > 0 ? Math.max(raw, min) : raw);
}

/** Raw volumetric kg for Domestic Priority (no whole-kg ceil). */
export function blueDartDpVolumetricKg(
  dims: BlueDartQuoteDims,
  divisor: number,
): number {
  const l = nonNeg(dims.lengthCm);
  const w = nonNeg(dims.widthCm);
  const h = nonNeg(dims.heightCm);
  const d = divisor > 0 ? divisor : 5000;
  if (!l || !w || !h) return 0;
  return (l * w * h) / d;
}

/** Round billable weight up to the next 500 g slab (0.3 → 0.5, 0.6 → 1). */
export function ceilBlueDartDpChargeableKg(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / BLUE_DART_DP_SLAB_KG - 1e-9) * BLUE_DART_DP_SLAB_KG;
}

/**
 * Domestic Priority chargeable weight: higher of actual / volumetric,
 * then stepped every 500 g (sheet: first 500 g + each addl 500 g).
 */
export function blueDartDpChargeableKg(input: {
  actualKg: number;
  dims: BlueDartQuoteDims;
  volumetricDivisor: number;
}): { chargeableKg: number; volumetricKg: number; slabs: number } {
  const actual = nonNeg(input.actualKg);
  const volumetricKg = blueDartDpVolumetricKg(input.dims, input.volumetricDivisor);
  const chargeableKg = ceilBlueDartDpChargeableKg(Math.max(actual, volumetricKg));
  const slabs = chargeableKg > 0
    ? Math.round(chargeableKg / BLUE_DART_DP_SLAB_KG)
    : 0;
  return { chargeableKg, volumetricKg, slabs };
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
    fs: blueDartEffectiveFuelSurchargePercent(shared, serviceFs),
    caf: blueDartEffectiveCafPercent(shared, serviceCaf),
  };
}

/** Surface: diesel FS after B2B discount (no shared Fuel / CAF). */
function resolveSurfaceFsCaf(surface: BlueDartSurfaceRates): { fs: number; caf: number } {
  return {
    fs: blueDartSurfaceEffectiveDieselFsPercent(surface),
    caf: 0,
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
  /** Quote “as of” date — Surface festival season uses this month. */
  at?: Date;
  /**
   * Surface OS/OW total. When set (multi-box), use this instead of looking up
   * slabs on the combined shipment chargeable kg.
   */
  oversizeInr?: number;
}): Omit<BlueDartQuoteBreakdown, 'service' | 'sku' | 'zoneLabel' | 'actualKg' | 'volumetricKg' | 'notServiceable' | 'notServiceableReason'> {
  const rates: BlueDartKgServiceRates = input.config[input.service];
  const perKg = nonNeg(rates.perKgInr[input.zone]);
  const rateMissing = !(perKg > 0);
  let base = perKg * input.chargeableKg;
  if (rates.minimumFreightInr > 0) base = Math.max(base, rates.minimumFreightInr);
  const docket = nonNeg(rates.docketFeeInr);
  const festivalPct = input.service === 'surface'
    ? blueDartSurfaceFestivalPercent(input.config.surface, input.at ?? new Date())
    : 0;
  const festival = base * (festivalPct / 100);
  const pss = input.service === 'surface'
    ? 0
    : base * (nonNeg(rates.pssPercent) / 100);
  /** Surface has no IDC — Air only here. */
  const idc = input.service === 'surface'
    ? 0
    : base * (nonNeg(rates.idcPercent) / 100);
  const oversize = input.service === 'surface'
    ? (input.oversizeInr != null
      ? nonNeg(input.oversizeInr)
      : resolveBlueDartOversizeAmountInr(
        input.config.surface.oversizeSlabs,
        input.chargeableKg,
      ))
    : 0;
  const fov = fovInr(input.config.shared, rates.fov, input.invoiceValueInr);
  const rasRate = rates.rasPerKgInr != null
    ? nonNeg(rates.rasPerKgInr)
    : nonNeg(input.config.shared.rasPerKgInr);
  const ras = isRasDestination(input.destState, input.config.shared.rasStates)
    ? rasRate * input.chargeableKg
    : 0;
  const ecc = input.service === 'surface'
    && isBlueDartEccDestination(input.destState)
    ? nonNeg(input.config.surface.eccPerShipmentInr)
    : 0;
  const edl = computeBlueDartEdlInr({
    shared: input.config.shared,
    destState: input.destState,
    isEdl: input.isEdl,
    chargeableKg: input.chargeableKg,
    edlKm: input.edlKm,
  });

  let fuel = 0;
  let cafInr = 0;
  let efss = 0;
  let subtotal = 0;

  if (input.service === 'surface') {
    /** Sample sheet: FS on Basic + Docket + FOV (+ festival when in season). */
    const fsBase = base + festival + docket + fov;
    const { fs } = resolveSurfaceFsCaf(input.config.surface);
    fuel = fsBase * (fs / 100);
    const afterFuel = fsBase + fuel;
    efss = afterFuel * (nonNeg(rates.efssPercent) / 100);
    /** OS/OW + RAS + ECC + EDL are VAS — after % stack. */
    subtotal = afterFuel + efss + oversize + ras + ecc + edl;
  } else {
    /**
     * Apex “Rate Calculation for 10KG” sample:
     * Basic + Docket + FOV + PSS + IDC → FS% → CAF% → EFSS% → RAS/EDL.
     */
    const fsBase = base + docket + fov + pss + idc;
    const { fs, caf } = resolveFsCaf(
      input.config.shared,
      rates.fuelSurchargePercent,
      rates.cafPercent,
    );
    fuel = fsBase * (fs / 100);
    const afterFuel = fsBase + fuel;
    cafInr = afterFuel * (caf / 100);
    const afterCaf = afterFuel + cafInr;
    efss = afterCaf * (nonNeg(rates.efssPercent) / 100);
    /** RAS + EDL are VAS — after % stack (not in Apex sample table). */
    subtotal = afterCaf + efss + ras + edl;
  }

  const total = ceilCourierChargeInr(subtotal);
  return {
    chargeableKg: input.chargeableKg,
    perKgInr: perKg,
    first500gInr: null,
    addl500gInr: null,
    baseFreightInr: base,
    docketFeeInr: docket,
    pssInr: pss,
    festivalSurchargeInr: festival,
    oversizeInr: oversize,
    idcInr: idc,
    fuelSurchargeInr: fuel,
    cafInr,
    efssInr: efss,
    rasInr: ras,
    fovInr: fov,
    eccInr: ecc,
    edlInr: edl,
    subtotalExGstInr: subtotal,
    gstInr: 0,
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
  /** Chargeable kg is already stepped to 500 g; convert to slab count. */
  const slabs = input.chargeableKg > 0
    ? Math.max(1, Math.round(input.chargeableKg / BLUE_DART_DP_SLAB_KG))
    : 0;
  const base = slabs > 0
    ? first + Math.max(0, slabs - 1) * addl
    : 0;
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
  return {
    chargeableKg: input.chargeableKg,
    perKgInr: null,
    first500gInr: first,
    addl500gInr: addl,
    baseFreightInr: base,
    docketFeeInr: 0,
    pssInr: pss,
    festivalSurchargeInr: 0,
    oversizeInr: 0,
    idcInr: idc,
    fuelSurchargeInr: fuel,
    cafInr,
    efssInr: efss,
    rasInr: 0,
    fovInr: 0,
    eccInr: 0,
    edlInr: 0,
    subtotalExGstInr: subtotal,
    gstInr: 0,
    totalInr: ceilCourierChargeInr(subtotal),
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
    perKgInr: null,
    first500gInr: null,
    addl500gInr: null,
    baseFreightInr: 0,
    docketFeeInr: 0,
    pssInr: 0,
    festivalSurchargeInr: 0,
    oversizeInr: 0,
    idcInr: 0,
    fuelSurchargeInr: 0,
    cafInr: 0,
    efssInr: 0,
    rasInr: 0,
    fovInr: 0,
    eccInr: 0,
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
    const {
      chargeableKg,
      volumetricKg,
    } = blueDartDpChargeableKg({
      actualKg: input.actualKg,
      dims: input.dims,
      volumetricDivisor: divisor,
    });
    if (blueDartDpMaxChargeableExceeded(chargeableKg)) {
      return empty({
        zoneLabel: `DP ${zone}`,
        actualKg: nonNeg(input.actualKg),
        volumetricKg,
        chargeableKg,
        rateMissing: false,
        notServiceable: true,
        notServiceableReason: blueDartDpMaxChargeableReason(chargeableKg),
      });
    }
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
  if (input.service === 'air' && blueDartAirMaxChargeableExceeded(chargeableKg)) {
    return empty({
      zoneLabel: `Zone ${zone}`,
      volumetricKg,
      chargeableKg,
      rateMissing: false,
      notServiceable: true,
      notServiceableReason: blueDartAirMaxChargeableReason(chargeableKg),
    });
  }
  /** OS/OW is per box — use piece kg (no consignment minimum). */
  const oversizeInr = input.service === 'surface'
    ? resolveBlueDartOversizeAmountInr(
      input.config.surface.oversizeSlabs,
      blueDartPieceChargeableKg(input.actualKg, input.dims, rates.volumetricDivisor),
    )
    : undefined;
  const q = quoteKgService({
    service: input.service,
    config: input.config,
    zone,
    chargeableKg,
    invoiceValueInr: nonNeg(input.invoiceValueInr),
    destState: input.destState,
    isEdl: access.isEdl,
    edlKm: input.pin?.edlKm ?? null,
    oversizeInr,
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

/**
 * Multi-box shipment on one AWB:
 * - Docket / FOV / ECC / EDL once per shipment
 * - Chargeable kg = sum of per-box max(actual, volumetric), then consignment minimum
 * - Surface OS/OW summed per box (each box’s own chargeable kg)
 */
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

  if (input.parcels.length === 1) {
    const only = input.parcels[0]!;
    return quoteBlueDartShipment({
      config: input.config,
      service: input.service,
      destState: input.destState,
      pin: input.pin,
      actualKg: only.actualKg,
      dims: only.dims,
      invoiceValueInr: input.invoiceValueInr,
    });
  }

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
    actualKg: 0,
    volumetricKg: 0,
    chargeableKg: 0,
    perKgInr: null,
    first500gInr: null,
    addl500gInr: null,
    baseFreightInr: 0,
    docketFeeInr: 0,
    pssInr: 0,
    festivalSurchargeInr: 0,
    oversizeInr: 0,
    idcInr: 0,
    fuelSurchargeInr: 0,
    cafInr: 0,
    efssInr: 0,
    rasInr: 0,
    fovInr: 0,
    eccInr: 0,
    edlInr: 0,
    subtotalExGstInr: 0,
    gstInr: 0,
    totalInr: 0,
    rateMissing: true,
    notServiceable: !access.allowed,
    notServiceableReason: access.reason,
    ...extra,
  });

  if (!access.allowed) return empty({});

  if (input.service === 'domestic_priority') {
    const zone = resolveBlueDartDpZone({
      destState: input.destState,
      pin: input.pin,
    });
    if (!zone) {
      return empty({ notServiceable: true, notServiceableReason: 'Cannot resolve DP zone' });
    }
    const divisor = input.config.domestic_priority.volumetricDivisor;
    let actualKg = 0;
    let volumetricKg = 0;
    for (const parcel of input.parcels) {
      actualKg += nonNeg(parcel.actualKg);
      volumetricKg += blueDartDpVolumetricKg(parcel.dims, divisor);
    }
    const chargeableKg = ceilBlueDartDpChargeableKg(Math.max(actualKg, volumetricKg));
    if (blueDartDpMaxChargeableExceeded(chargeableKg)) {
      return empty({
        zoneLabel: `DP ${zone}`,
        actualKg,
        volumetricKg,
        chargeableKg,
        rateMissing: false,
        notServiceable: true,
        notServiceableReason: blueDartDpMaxChargeableReason(chargeableKg),
      });
    }
    const q = quoteDomesticPriority({
      config: input.config,
      zone,
      chargeableKg,
    });
    return {
      service: input.service,
      sku: meta.sku,
      zoneLabel: `DP ${zone}`,
      actualKg,
      volumetricKg,
      notServiceable: false,
      notServiceableReason: null,
      ...q,
    };
  }

  const divisor = input.config[input.service].volumetricDivisor;
  const minKg = nonNeg(input.config[input.service].minimumChargeableWeightKg);

  let actualKg = 0;
  let volumetricKg = 0;
  let pieceChargeableKg = 0;
  for (const parcel of input.parcels) {
    actualKg += nonNeg(parcel.actualKg);
    volumetricKg += blueDartVolumetricKg(parcel.dims, divisor);
    pieceChargeableKg += blueDartPieceChargeableKg(
      parcel.actualKg,
      parcel.dims,
      divisor,
    );
  }
  const chargeableKg = ceilChargeableKg(
    Math.max(pieceChargeableKg, minKg > 0 ? minKg : 0),
  );

  const oversizeInr = input.service === 'surface'
    ? blueDartParcelsOversizeInr(
      input.config.surface.oversizeSlabs,
      input.parcels,
      divisor,
    )
    : 0;

  const zone = resolveBlueDartAirZone({
    shared: input.config.shared,
    destState: input.destState,
  });
  if (!zone) {
    return empty({ notServiceable: true, notServiceableReason: 'Cannot resolve zone' });
  }
  if (input.service === 'air' && blueDartAirMaxChargeableExceeded(chargeableKg)) {
    return empty({
      zoneLabel: `Zone ${zone}`,
      actualKg,
      volumetricKg,
      chargeableKg,
      rateMissing: false,
      notServiceable: true,
      notServiceableReason: blueDartAirMaxChargeableReason(chargeableKg),
    });
  }
  const q = quoteKgService({
    service: input.service,
    config: input.config,
    zone,
    chargeableKg,
    invoiceValueInr: nonNeg(input.invoiceValueInr),
    destState: input.destState,
    isEdl: access.isEdl,
    edlKm: input.pin?.edlKm ?? null,
    oversizeInr,
  });
  return {
    service: input.service,
    sku: meta.sku,
    zoneLabel: `Zone ${zone}`,
    actualKg,
    volumetricKg,
    notServiceable: false,
    notServiceableReason: null,
    ...q,
  };
}

/** Settings “try a quote” preview — same Surface stack as live quotes. */
export type BlueDartSurfaceStackPreview = {
  zone: BlueDartAirZone;
  perKgInr: number;
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  festivalPct: number;
  oversizeAmountInr: number;
  dieselEffectivePct: number;
  baseFreightInr: number;
  festivalSurchargeInr: number;
  idcInr: number;
  oversizeInr: number;
  /** Basic + Festival + Docket + FOV — diesel FS base (Surface rates sample). */
  subtotalAInr: number;
  fuelSurchargeInr: number;
  subtotalBInr: number;
  efssInr: number;
  docketFeeInr: number;
  rasInr: number;
  fovInr: number;
  eccInr: number;
  edlInr: number;
  totalInr: number;
  rateMissing: boolean;
};

export function previewBlueDartSurfaceStack(input: {
  shared: BlueDartSharedRules;
  surface: BlueDartSurfaceRates;
  zone: BlueDartAirZone;
  actualKg: number;
  dims?: BlueDartQuoteDims;
  invoiceValueInr: number;
  destState: string | null | undefined;
  isEdl: boolean;
  edlKm?: number | null;
  at?: Date;
}): BlueDartSurfaceStackPreview {
  const dims = input.dims ?? { lengthCm: 0, widthCm: 0, heightCm: 0 };
  const volumetricKg = blueDartVolumetricKg(dims, input.surface.volumetricDivisor);
  const chargeableKg = blueDartChargeableKg({
    actualKg: input.actualKg,
    dims,
    volumetricDivisor: input.surface.volumetricDivisor,
    minimumChargeableWeightKg: input.surface.minimumChargeableWeightKg,
  });
  const at = input.at ?? new Date();
  const festivalPct = blueDartSurfaceFestivalPercent(input.surface, at);
  /** Settings preview is one box — OS/OW on piece kg (no consignment min). */
  const pieceKg = blueDartPieceChargeableKg(
    input.actualKg,
    dims,
    input.surface.volumetricDivisor,
  );
  const oversizeAmountInr = resolveBlueDartOversizeAmountInr(
    input.surface.oversizeSlabs,
    pieceKg,
  );
  const dieselEffectivePct = blueDartSurfaceEffectiveDieselFsPercent(input.surface);
  const config = {
    shared: input.shared,
    surface: input.surface,
    air: input.surface,
    domestic_priority: {
      first500gInr: { A1: 0, A: 0, B: 0, C: 0 },
      addl500gInr: { A1: 0, A: 0, B: 0, C: 0 },
      volumetricDivisor: 5000,
      fuelSurchargePercent: null,
      cafPercent: null,
      idcPercent: 0,
      efssPercent: 0,
      pssPercent: 0,
    },
    source: null,
  } satisfies BlueDartConfig;

  const q = quoteKgService({
    service: 'surface',
    config,
    zone: input.zone,
    chargeableKg,
    invoiceValueInr: nonNeg(input.invoiceValueInr),
    destState: input.destState,
    isEdl: input.isEdl,
    edlKm: input.edlKm ?? null,
    at,
    oversizeInr: oversizeAmountInr,
  });
  const subtotalAInr = q.baseFreightInr
    + q.festivalSurchargeInr
    + q.docketFeeInr
    + q.fovInr;
  const subtotalBInr = subtotalAInr + q.fuelSurchargeInr;

  return {
    zone: input.zone,
    perKgInr: nonNeg(input.surface.perKgInr[input.zone]),
    actualKg: nonNeg(input.actualKg),
    volumetricKg,
    chargeableKg,
    festivalPct,
    oversizeAmountInr,
    dieselEffectivePct,
    baseFreightInr: q.baseFreightInr,
    festivalSurchargeInr: q.festivalSurchargeInr,
    idcInr: q.idcInr,
    oversizeInr: q.oversizeInr,
    subtotalAInr,
    fuelSurchargeInr: q.fuelSurchargeInr,
    subtotalBInr,
    efssInr: q.efssInr,
    docketFeeInr: q.docketFeeInr,
    rasInr: q.rasInr,
    fovInr: q.fovInr,
    eccInr: q.eccInr,
    edlInr: q.edlInr,
    totalInr: q.totalInr,
    rateMissing: q.rateMissing,
  };
}

/** Settings “try a quote” preview — same Air stack as live quotes. */
export type BlueDartAirStackPreview = {
  zone: BlueDartAirZone;
  perKgInr: number;
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  /** Published Domestic FS (before B2B). */
  fsPublishedPercent: number;
  fsDiscountPercent: number;
  /** Effective FS after B2B (applied in quote). */
  fsPercent: number;
  /** Published CAF (before B2B). */
  cafPublishedPercent: number;
  cafDiscountPercent: number;
  /** Effective CAF after B2B (applied in quote). */
  cafPercent: number;
  baseFreightInr: number;
  pssInr: number;
  idcInr: number;
  /** Basic + Docket + FOV + PSS + IDC — FS base (Apex sample). */
  subtotalAInr: number;
  fuelSurchargeInr: number;
  afterFuelInr: number;
  cafInr: number;
  afterCafInr: number;
  efssInr: number;
  docketFeeInr: number;
  rasInr: number;
  fovInr: number;
  edlInr: number;
  totalInr: number;
  rateMissing: boolean;
};

export function previewBlueDartAirStack(input: {
  shared: BlueDartSharedRules;
  air: BlueDartKgServiceRates;
  zone: BlueDartAirZone;
  actualKg: number;
  dims?: BlueDartQuoteDims;
  invoiceValueInr: number;
  destState: string | null | undefined;
  isEdl: boolean;
  edlKm?: number | null;
}): BlueDartAirStackPreview {
  const dims = input.dims ?? { lengthCm: 0, widthCm: 0, heightCm: 0 };
  const volumetricKg = blueDartVolumetricKg(dims, input.air.volumetricDivisor);
  const chargeableKg = blueDartChargeableKg({
    actualKg: input.actualKg,
    dims,
    volumetricDivisor: input.air.volumetricDivisor,
    minimumChargeableWeightKg: input.air.minimumChargeableWeightKg,
  });
  const fsPublishedPercent = input.air.fuelSurchargePercent != null
    && Number.isFinite(input.air.fuelSurchargePercent)
    ? nonNeg(input.air.fuelSurchargePercent)
    : nonNeg(input.shared.fuelSurchargePercent);
  const cafPublishedPercent = input.air.cafPercent != null
    && Number.isFinite(input.air.cafPercent)
    ? nonNeg(input.air.cafPercent)
    : nonNeg(input.shared.cafPercent);
  const fsDiscountPercent = nonNeg(input.shared.fuelB2bDiscountPercent);
  const cafDiscountPercent = nonNeg(input.shared.cafB2bDiscountPercent);
  const { fs: fsPercent, caf: cafPercent } = resolveFsCaf(
    input.shared,
    input.air.fuelSurchargePercent,
    input.air.cafPercent,
  );
  const config = {
    shared: input.shared,
    air: input.air,
    surface: {
      ...input.air,
      festivalSurchargePercent: 0,
      festivalSeasonStartMonth: 9,
      festivalSeasonEndMonth: 12,
      oversizeSlabs: [],
      dieselB2bDiscountPercent: 0,
      eccPerShipmentInr: 0,
    },
    domestic_priority: {
      first500gInr: { A1: 0, A: 0, B: 0, C: 0 },
      addl500gInr: { A1: 0, A: 0, B: 0, C: 0 },
      volumetricDivisor: 5000,
      fuelSurchargePercent: null,
      cafPercent: null,
      idcPercent: 0,
      efssPercent: 0,
      pssPercent: 0,
    },
    source: null,
  } satisfies BlueDartConfig;

  const q = quoteKgService({
    service: 'air',
    config,
    zone: input.zone,
    chargeableKg,
    invoiceValueInr: nonNeg(input.invoiceValueInr),
    destState: input.destState,
    isEdl: input.isEdl,
    edlKm: input.edlKm ?? null,
  });
  /** Apex sample FS base: Basic + Docket + FOV + PSS + IDC. */
  const subtotalAInr = q.baseFreightInr
    + q.docketFeeInr
    + q.fovInr
    + q.pssInr
    + q.idcInr;
  const afterFuelInr = subtotalAInr + q.fuelSurchargeInr;
  const afterCafInr = afterFuelInr + q.cafInr;

  return {
    zone: input.zone,
    perKgInr: nonNeg(input.air.perKgInr[input.zone]),
    actualKg: nonNeg(input.actualKg),
    volumetricKg,
    chargeableKg,
    fsPublishedPercent,
    fsDiscountPercent,
    fsPercent,
    cafPublishedPercent,
    cafDiscountPercent,
    cafPercent,
    baseFreightInr: q.baseFreightInr,
    pssInr: q.pssInr,
    idcInr: q.idcInr,
    subtotalAInr,
    fuelSurchargeInr: q.fuelSurchargeInr,
    afterFuelInr,
    cafInr: q.cafInr,
    afterCafInr,
    efssInr: q.efssInr,
    docketFeeInr: q.docketFeeInr,
    rasInr: q.rasInr,
    fovInr: q.fovInr,
    edlInr: q.edlInr,
    totalInr: q.totalInr,
    rateMissing: q.rateMissing,
  };
}

/** Settings “try a quote” preview — same Domestic Priority stack as live quotes. */
export type BlueDartDomesticPriorityStackPreview = {
  zone: BlueDartDpZone;
  first500gInr: number;
  addl500gInr: number;
  slabs: number;
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  /** Published Domestic FS (before B2B). */
  fsPublishedPercent: number;
  fsDiscountPercent: number;
  /** Effective FS after B2B (applied in quote). */
  fsPercent: number;
  /** Published CAF (before B2B). */
  cafPublishedPercent: number;
  cafDiscountPercent: number;
  /** Effective CAF after B2B (applied in quote). */
  cafPercent: number;
  baseFreightInr: number;
  pssInr: number;
  idcInr: number;
  /** Basic + PSS + IDC — FS base. */
  subtotalAInr: number;
  fuelSurchargeInr: number;
  afterFuelInr: number;
  cafInr: number;
  afterCafInr: number;
  efssInr: number;
  totalInr: number;
  rateMissing: boolean;
};

export function previewBlueDartDomesticPriorityStack(input: {
  shared: BlueDartSharedRules;
  domestic_priority: BlueDartDomesticPriorityRates;
  zone: BlueDartDpZone;
  actualKg: number;
  dims?: BlueDartQuoteDims;
}): BlueDartDomesticPriorityStackPreview {
  const dims = input.dims ?? { lengthCm: 0, widthCm: 0, heightCm: 0 };
  const divisor = input.domestic_priority.volumetricDivisor;
  const {
    chargeableKg,
    volumetricKg,
    slabs,
  } = blueDartDpChargeableKg({
    actualKg: input.actualKg,
    dims,
    volumetricDivisor: divisor,
  });
  const fsPublishedPercent = input.domestic_priority.fuelSurchargePercent != null
    && Number.isFinite(input.domestic_priority.fuelSurchargePercent)
    ? nonNeg(input.domestic_priority.fuelSurchargePercent)
    : nonNeg(input.shared.fuelSurchargePercent);
  const cafPublishedPercent = input.domestic_priority.cafPercent != null
    && Number.isFinite(input.domestic_priority.cafPercent)
    ? nonNeg(input.domestic_priority.cafPercent)
    : nonNeg(input.shared.cafPercent);
  const fsDiscountPercent = nonNeg(input.shared.fuelB2bDiscountPercent);
  const cafDiscountPercent = nonNeg(input.shared.cafB2bDiscountPercent);
  const { fs: fsPercent, caf: cafPercent } = resolveFsCaf(
    input.shared,
    input.domestic_priority.fuelSurchargePercent,
    input.domestic_priority.cafPercent,
  );
  const config = {
    shared: input.shared,
    domestic_priority: input.domestic_priority,
    air: defaultBlueDartAirRates(),
    surface: defaultBlueDartSurfaceRates(),
    source: null,
  } satisfies BlueDartConfig;

  const q = quoteDomesticPriority({
    config,
    zone: input.zone,
    chargeableKg,
  });
  const subtotalAInr = q.baseFreightInr + q.pssInr + q.idcInr;
  const afterFuelInr = subtotalAInr + q.fuelSurchargeInr;
  const afterCafInr = afterFuelInr + q.cafInr;

  return {
    zone: input.zone,
    first500gInr: q.first500gInr ?? 0,
    addl500gInr: q.addl500gInr ?? 0,
    slabs,
    actualKg: nonNeg(input.actualKg),
    volumetricKg,
    chargeableKg,
    fsPublishedPercent,
    fsDiscountPercent,
    fsPercent,
    cafPublishedPercent,
    cafDiscountPercent,
    cafPercent,
    baseFreightInr: q.baseFreightInr,
    pssInr: q.pssInr,
    idcInr: q.idcInr,
    subtotalAInr,
    fuelSurchargeInr: q.fuelSurchargeInr,
    afterFuelInr,
    cafInr: q.cafInr,
    afterCafInr,
    efssInr: q.efssInr,
    totalInr: q.totalInr,
    rateMissing: q.rateMissing,
  };
}
