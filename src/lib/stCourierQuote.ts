import type { ShipmentMode } from '../types/logistics-dispatch';
import type {
  StCourierOriginRates,
  StCourierZone,
} from '../types/logistics-courier-rates';
import { DEFAULT_ST_COURIER_VOLUMETRIC_DIVISOR } from '../constants/logisticsCourierRates';

export interface StCourierQuoteDims {
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

export interface StCourierQuoteInput {
  mode: ShipmentMode;
  zone: StCourierZone;
  actualKg?: number | null;
  dims?: StCourierQuoteDims;
  rates: StCourierOriginRates;
}

export interface StCourierQuoteResult {
  volumetricKg: number;
  chargeableKg: number;
  /** Envelope fixed ₹ for the zone (0 for box). */
  envelopeFixedInr: number;
  /** Box ₹/kg for the zone (0 for envelope). */
  boxPerKgInr: number;
  freightInr: number;
  fuelSurchargeInr: number;
  totalInr: number;
}

function nonNeg(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Volumetric weight for the given dims and divisor.
 * Returns 0 when any dimension is missing/zero.
 */
export function stCourierVolumetricKg(
  dims: StCourierQuoteDims | undefined,
  divisor: number,
): number {
  const lengthCm = nonNeg(dims?.lengthCm);
  const widthCm = nonNeg(dims?.widthCm);
  const heightCm = nonNeg(dims?.heightCm);
  const d = divisor > 0 ? divisor : DEFAULT_ST_COURIER_VOLUMETRIC_DIVISOR;
  if (!lengthCm || !widthCm || !heightCm) return 0;
  return (lengthCm * widthCm * heightCm) / d;
}

/**
 * Chargeable kg for ST Courier quoting.
 * Envelope: not used for pricing (fixed zone charge).
 * Box + LBH on: max(actual, volumetric).
 * Box + LBH off: actual only.
 */
export function stCourierChargeableKg(input: {
  mode: ShipmentMode;
  actualKg?: number | null;
  dims?: StCourierQuoteDims;
  rates: StCourierOriginRates;
}): { volumetricKg: number; chargeableKg: number } {
  const actualKg = nonNeg(input.actualKg);
  const volumetricKg = input.mode === 'box'
    ? stCourierVolumetricKg(input.dims, input.rates.volumetricDivisor)
    : 0;

  if (input.mode === 'envelope') {
    return { volumetricKg: 0, chargeableKg: 0 };
  }

  if (input.rates.useChargeableWeight) {
    return { volumetricKg, chargeableKg: Math.max(actualKg, volumetricKg) };
  }

  return { volumetricKg, chargeableKg: actualKg };
}

/**
 * Envelope: freight = zone.envelopeFixedInr
 * Box:      freight = zone.boxPerKgInr * chargeableKg
 * total = freight * (1 + fuel%/100)
 */
export function computeStCourierQuote(input: StCourierQuoteInput): StCourierQuoteResult {
  const { volumetricKg, chargeableKg } = stCourierChargeableKg(input);
  const zoneRates = input.rates.zones[input.zone];
  const envelopeFixedInr = nonNeg(zoneRates?.envelopeFixedInr);
  const boxPerKgInr = nonNeg(zoneRates?.boxPerKgInr);

  const freightInr = input.mode === 'envelope'
    ? envelopeFixedInr
    : boxPerKgInr * chargeableKg;

  const fuelPct = nonNeg(input.rates.fuelSurchargePercent);
  const fuelSurchargeInr = freightInr * (fuelPct / 100);
  const totalInr = freightInr + fuelSurchargeInr;

  return {
    volumetricKg,
    chargeableKg,
    envelopeFixedInr: input.mode === 'envelope' ? envelopeFixedInr : 0,
    boxPerKgInr: input.mode === 'box' ? boxPerKgInr : 0,
    freightInr,
    fuelSurchargeInr,
    totalInr,
  };
}
