import type {
  TrackonConfig,
  TrackonDestinationId,
  TrackonServiceId,
  TrackonWeightSlabs,
} from '../types/trackon-rates';
import { ceilChargeableKg, ceilCourierChargeInr } from './stCourierQuote';
import {
  isTrackonNorthDestination,
  isTrackonSouthDestination,
  resolveTrackonDestination,
  trackonDestinationSupportsService,
} from './trackonDestination';
import type { StCourierDestination } from './stCourierZone';

export interface TrackonQuoteDims {
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

export interface TrackonParcelInput {
  actualKg?: number | null;
  dims?: TrackonQuoteDims;
}

export interface TrackonQuoteInput {
  config: TrackonConfig;
  service: TrackonServiceId;
  destination?: StCourierDestination | null;
  destinationId?: TrackonDestinationId | null;
  parcels: TrackonParcelInput[];
}

export interface TrackonQuoteResult {
  destinationId: TrackonDestinationId | null;
  service: TrackonServiceId;
  volumetricKg: number;
  chargeableKg: number;
  /** Exact kg used for slab selection (not forced to whole kg). */
  billableKg: number;
  freightInr: number;
  fuelSurchargeInr: number;
  totalInr: number;
  notServiceable: boolean;
  rateMissing: boolean;
  sku: 'TRFRC';
}

function nonNeg(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function trackonVolumetricKg(
  dims: TrackonQuoteDims | undefined,
  divisor: number,
  oversizedSideCm: number,
): number {
  const lengthCm = nonNeg(dims?.lengthCm);
  const widthCm = nonNeg(dims?.widthCm);
  const heightCm = nonNeg(dims?.heightCm);
  const d = divisor > 0 ? divisor : 5000;
  if (!lengthCm || !widthCm || !heightCm) return 0;
  let vol = (lengthCm * widthCm * heightCm) / d;
  const limit = oversizedSideCm > 0 ? oversizedSideCm : 100;
  if (lengthCm > limit || widthCm > limit || heightCm > limit) {
    vol *= 2;
  }
  return vol;
}

/** Southern surface light parcels: 250 g / 500 g / 1 kg bands. */
function freightFromSouthSlabs(slabs: TrackonWeightSlabs, billableKg: number): number {
  if (billableKg <= 0) return 0;
  if (billableKg <= 0.25) return nonNeg(slabs.upTo250gInr);
  if (billableKg <= 0.5) return nonNeg(slabs.upTo500gInr);
  if (billableKg <= 1) return nonNeg(slabs.upTo1000gInr);
  const addlUnits = Math.ceil((billableKg - 1) / 0.5);
  return nonNeg(slabs.upTo1000gInr) + addlUnits * nonNeg(slabs.additionalPer500gInr);
}

/** Air: flat upto 1 kg; then ₹ per each 500 g (or part) above 1 kg. */
function freightFromAirSlabs(slabs: TrackonWeightSlabs, billableKg: number): number {
  if (billableKg <= 0) return 0;
  if (billableKg <= 1) return nonNeg(slabs.upTo1000gInr);
  const addlUnits = Math.ceil((billableKg - 1) / 0.5);
  return nonNeg(slabs.upTo1000gInr) + addlUnits * nonNeg(slabs.additionalPer500gInr);
}

function aggregateParcels(
  parcels: TrackonParcelInput[],
  divisor: number,
  oversizedSideCm: number,
): { volumetricKg: number; billableKg: number } {
  let volumetricKg = 0;
  let billableKg = 0;
  for (const parcel of parcels) {
    const actual = nonNeg(parcel.actualKg);
    const vol = trackonVolumetricKg(parcel.dims, divisor, oversizedSideCm);
    volumetricKg += vol;
    billableKg += Math.max(actual, vol);
  }
  return { volumetricKg, billableKg };
}

export function quoteTrackonShipment(input: TrackonQuoteInput): TrackonQuoteResult {
  const { config, service } = input;
  const destinationId = input.destinationId
    ?? resolveTrackonDestination(input.destination ?? null);
  const empty = (flags: { notServiceable?: boolean; rateMissing?: boolean }): TrackonQuoteResult => ({
    destinationId,
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

  if (!destinationId) return empty({ rateMissing: true });
  if (!trackonDestinationSupportsService(destinationId, service)) {
    return empty({ notServiceable: true });
  }

  const { volumetricKg, billableKg } = aggregateParcels(
    input.parcels,
    config.shared.volumetricDivisor,
    config.shared.oversizedSideCm,
  );

  let freightInr = 0;
  let chargeableKg = 0;

  if (service === 'air') {
    if (!isTrackonNorthDestination(destinationId)) {
      return empty({ notServiceable: true });
    }
    const row = config.air.destinations[destinationId];
    freightInr = freightFromAirSlabs(row, billableKg);
    chargeableKg = billableKg <= 1
      ? billableKg
      : ceilChargeableKg(billableKg);
  } else if (isTrackonSouthDestination(destinationId)) {
    const row = config.surface.southern[destinationId];
    if (billableKg <= 1) {
      freightInr = freightFromSouthSlabs(row, billableKg);
      chargeableKg = billableKg;
    } else {
      const minBulk = nonNeg(config.shared.southernBulkMinimumKg) || 4;
      chargeableKg = ceilChargeableKg(Math.max(billableKg, minBulk));
      freightInr = nonNeg(row.bulkPerKgInr) * chargeableKg;
    }
  } else if (isTrackonNorthDestination(destinationId)) {
    const row = config.surface.northern[destinationId];
    const minKg = nonNeg(config.shared.northernMinimumChargeableKg);
    chargeableKg = ceilChargeableKg(Math.max(billableKg, minKg));
    freightInr = nonNeg(row.perKgInr) * chargeableKg;
  } else {
    return empty({ notServiceable: true });
  }

  if (!(freightInr > 0) && billableKg > 0) {
    return {
      ...empty({ rateMissing: true }),
      volumetricKg,
      chargeableKg,
      billableKg,
    };
  }

  const fuelSurchargeInr = freightInr * (nonNeg(config.shared.fuelSurchargePercent) / 100);
  const totalInr = ceilCourierChargeInr(freightInr + fuelSurchargeInr);

  return {
    destinationId,
    service,
    volumetricKg,
    chargeableKg,
    billableKg,
    freightInr,
    fuelSurchargeInr,
    totalInr,
    notServiceable: false,
    rateMissing: false,
    sku: 'TRFRC',
  };
}

export function quoteTrackonParcels(input: TrackonQuoteInput): TrackonQuoteResult {
  return quoteTrackonShipment(input);
}
