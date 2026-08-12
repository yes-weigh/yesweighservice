/**
 * Spare freight quoting.
 * Default (dealer / no packaging): 1 kg billable flat.
 * Staff packaging: one or more boxes (actual kg + L×B×H) → partner chargeable stack.
 */
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import {
  blueDartServiceForPartner,
  isBlueDartLogisticsPartnerId,
  isTrackonLogisticsPartnerId,
} from '../constants/logisticsPartners';
import type { BlueDartPincodeDoc } from '../types/blue-dart-rates';
import type { LogisticsCourierRates, StCourierOriginRates, StCourierZone } from '../types/logistics-courier-rates';
import { quoteBlueDartParcels } from './blueDartQuote';
import type { InventorySite } from './salesOrderSegments';
import { resolveBlueDartAirZone } from './blueDartZone';
import { isPickupPartner } from './orderFreight';
import { ceilChargeableKg, ceilCourierChargeInr } from './stCourierQuote';
import type { StCourierDestination } from './stCourierZone';
import { quoteTrackonParcels } from './trackonQuote';

/** Spares under 1 kg (or missing weight) bill as 1 kg when no packaging is set. */
export const SPARE_FREIGHT_BILLABLE_KG = 1;

/** Staff-entered spare carton for freight (Book Courier / SO freight). */
export type SpareFreightPackaging = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  boxDefinitionId?: string | null;
};

export type SpareFreightParcelDetail = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
};

export type SpareFreightQuoteResult = {
  totalInr: number;
  chargeableKg: number;
  perKgInr: number;
  fuelSurchargePercent: number;
  fuelSurchargeInr: number;
  /** Partner has no auto spare tariff (staff enter ₹ if needed). */
  skipped: boolean;
  rateMissing: boolean;
  /** Staff must pick a box or enter LBH + weight. */
  needsPackaging?: boolean;
  actualKg?: number;
  volumetricKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  boxCount?: number;
  parcels?: SpareFreightParcelDetail[];
};

export function sparePackagingIsComplete(
  packaging: SpareFreightPackaging | null | undefined,
): boolean {
  if (!packaging) return false;
  // Weight optional — volumetric from L×B×H is used when actual kg is blank.
  return (
    packaging.lengthCm > 0
    && packaging.widthCm > 0
    && packaging.heightCm > 0
  );
}

/** Accept one box or many; drop incomplete rows. */
export function normalizeSparePackagingList(
  packaging: SpareFreightPackaging | SpareFreightPackaging[] | null | undefined,
): SpareFreightPackaging[] {
  if (!packaging) return [];
  const rows = Array.isArray(packaging) ? packaging : [packaging];
  return rows.filter(sparePackagingIsComplete);
}

export function sparePackagingListReady(
  packaging: SpareFreightPackaging | SpareFreightPackaging[] | null | undefined,
  requirePackaging?: boolean,
): { boxes: SpareFreightPackaging[]; incomplete: boolean } {
  if (!requirePackaging) {
    const boxes = normalizeSparePackagingList(packaging);
    return { boxes, incomplete: false };
  }
  if (!packaging) {
    return { boxes: [], incomplete: true };
  }
  const rows = Array.isArray(packaging) ? packaging : [packaging];
  if (!rows.length || !rows.every(sparePackagingIsComplete)) {
    return { boxes: [], incomplete: true };
  }
  return { boxes: rows, incomplete: false };
}

function emptySpareQuote(flags?: {
  skipped?: boolean;
  rateMissing?: boolean;
  needsPackaging?: boolean;
}): SpareFreightQuoteResult {
  return {
    totalInr: 0,
    chargeableKg: 0,
    perKgInr: 0,
    fuelSurchargePercent: 0,
    fuelSurchargeInr: 0,
    skipped: Boolean(flags?.skipped),
    rateMissing: Boolean(flags?.rateMissing),
    needsPackaging: Boolean(flags?.needsPackaging),
    boxCount: 0,
    parcels: [],
  };
}

function billableForBox(
  box: SpareFreightPackaging,
  volumetricDivisor: number,
): SpareFreightParcelDetail {
  const divisor = volumetricDivisor > 0 ? volumetricDivisor : 5000;
  const volumetricKg = (box.lengthCm * box.widthCm * box.heightCm) / divisor;
  const actualKg = box.weightKg > 0 ? box.weightKg : 0;
  // Missing actual weight → chargeable defaults to volumetric.
  const chargeableKg = ceilChargeableKg(Math.max(actualKg, volumetricKg));
  return {
    lengthCm: box.lengthCm,
    widthCm: box.widthCm,
    heightCm: box.heightCm,
    actualKg,
    volumetricKg,
    chargeableKg,
  };
}

function aggregateParcels(parcels: SpareFreightParcelDetail[]): {
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  dims: { lengthCm: number; widthCm: number; heightCm: number };
} {
  const actualKg = parcels.reduce((sum, row) => sum + row.actualKg, 0);
  const volumetricKg = parcels.reduce((sum, row) => sum + row.volumetricKg, 0);
  const chargeableKg = parcels.reduce((sum, row) => sum + row.chargeableKg, 0);
  const first = parcels[0];
  return {
    actualKg,
    volumetricKg,
    chargeableKg,
    dims: first
      ? { lengthCm: first.lengthCm, widthCm: first.widthCm, heightCm: first.heightCm }
      : { lengthCm: 0, widthCm: 0, heightCm: 0 },
  };
}

function defaultOneKgParcel(): SpareFreightParcelDetail {
  return {
    lengthCm: 0,
    widthCm: 0,
    heightCm: 0,
    actualKg: SPARE_FREIGHT_BILLABLE_KG,
    volumetricKg: 0,
    chargeableKg: SPARE_FREIGHT_BILLABLE_KG,
  };
}

function resolveParcels(input: {
  packaging?: SpareFreightPackaging | SpareFreightPackaging[] | null;
  requirePackaging?: boolean;
  volumetricDivisor?: number;
}): { parcels: SpareFreightParcelDetail[]; incomplete: boolean } {
  const ready = sparePackagingListReady(input.packaging, input.requirePackaging);
  if (ready.incomplete) {
    return { parcels: [], incomplete: true };
  }
  if (ready.boxes.length > 0) {
    const divisor = Number(input.volumetricDivisor) || 5000;
    return {
      parcels: ready.boxes.map(box => billableForBox(box, divisor)),
      incomplete: false,
    };
  }
  return { parcels: [defaultOneKgParcel()], incomplete: false };
}

function originRatesForPartner(
  rates: LogisticsCourierRates,
  partnerId: LogisticsPartnerId,
  site: InventorySite,
): StCourierOriginRates | null {
  if (partnerId === 'st_courier') return rates.st_courier[site] ?? null;
  if (partnerId === 'delhivery') return rates.delhivery ?? null;
  return null;
}

function quoteStStyleSpare(input: {
  originRates: StCourierOriginRates;
  zone: StCourierZone;
  packaging?: SpareFreightPackaging | SpareFreightPackaging[] | null;
  requirePackaging?: boolean;
}): SpareFreightQuoteResult {
  const resolved = resolveParcels({
    packaging: input.packaging,
    requirePackaging: input.requirePackaging,
    volumetricDivisor: Number(input.originRates.volumetricDivisor) || 4500,
  });
  if (resolved.incomplete) {
    return emptySpareQuote({ needsPackaging: true, rateMissing: true });
  }
  const agg = aggregateParcels(resolved.parcels);
  const boxPerKgInr = Number(input.originRates.zones[input.zone]?.boxPerKgInr) || 0;
  if (!(boxPerKgInr > 0)) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: agg.chargeableKg,
      perKgInr: 0,
      fuelSurchargePercent: Number(input.originRates.fuelSurchargePercent) || 0,
      actualKg: agg.actualKg,
      volumetricKg: agg.volumetricKg,
      ...agg.dims,
      boxCount: resolved.parcels.length,
      parcels: resolved.parcels,
    };
  }
  const fuelSurchargePercent = Number(input.originRates.fuelSurchargePercent) || 0;
  const freightInr = boxPerKgInr * agg.chargeableKg;
  const fuelSurchargeInr = freightInr * (fuelSurchargePercent / 100);
  return {
    totalInr: ceilCourierChargeInr(freightInr + fuelSurchargeInr),
    chargeableKg: agg.chargeableKg,
    perKgInr: boxPerKgInr,
    fuelSurchargePercent,
    fuelSurchargeInr,
    skipped: false,
    rateMissing: false,
    actualKg: agg.actualKg,
    volumetricKg: agg.volumetricKg,
    ...agg.dims,
    boxCount: resolved.parcels.length,
    parcels: resolved.parcels,
  };
}

function quoteBlueDartDomesticPrioritySpare(input: {
  rates: LogisticsCourierRates;
  destination: StCourierDestination | null | undefined;
  pin?: BlueDartPincodeDoc | null;
  packaging?: SpareFreightPackaging | SpareFreightPackaging[] | null;
  requirePackaging?: boolean;
}): SpareFreightQuoteResult {
  const ready = sparePackagingListReady(input.packaging, input.requirePackaging);
  if (ready.incomplete) {
    return emptySpareQuote({ needsPackaging: true, rateMissing: true });
  }
  const parcels = ready.boxes.length > 0
    ? ready.boxes.map(box => ({
        actualKg: box.weightKg,
        dims: {
          lengthCm: box.lengthCm,
          widthCm: box.widthCm,
          heightCm: box.heightCm,
        },
      }))
    : [{
        actualKg: SPARE_FREIGHT_BILLABLE_KG,
        dims: { lengthCm: 0, widthCm: 0, heightCm: 0 },
      }];
  const quoted = quoteBlueDartParcels({
    config: input.rates.bluedart,
    service: 'domestic_priority',
    destState: input.destination?.state,
    pin: input.pin ?? null,
    parcels,
  });
  const detailParcels = ready.boxes.length > 0
    ? ready.boxes.map(box => billableForBox(
      box,
      Number(input.rates.bluedart.domestic_priority.volumetricDivisor) || 5000,
    ))
    : [defaultOneKgParcel()];
  const first = detailParcels[0];
  const dims = first && first.lengthCm > 0
    ? { lengthCm: first.lengthCm, widthCm: first.widthCm, heightCm: first.heightCm }
    : { lengthCm: 0, widthCm: 0, heightCm: 0 };
  if (quoted.notServiceable) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: quoted.chargeableKg || 0,
      ...dims,
      actualKg: quoted.actualKg,
      volumetricKg: quoted.volumetricKg,
      boxCount: detailParcels.length,
      parcels: detailParcels,
    };
  }
  if (quoted.rateMissing) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: quoted.chargeableKg || 0,
      ...dims,
      actualKg: quoted.actualKg,
      volumetricKg: quoted.volumetricKg,
      boxCount: detailParcels.length,
      parcels: detailParcels,
    };
  }
  const fuelSurchargePercent = Number(input.rates.bluedart.domestic_priority.fuelSurchargePercent) || 0;
  return {
    totalInr: quoted.totalInr,
    chargeableKg: quoted.chargeableKg,
    perKgInr: quoted.chargeableKg > 0
      ? Math.round((quoted.baseFreightInr / quoted.chargeableKg) * 100) / 100
      : 0,
    fuelSurchargePercent,
    fuelSurchargeInr: quoted.fuelSurchargeInr,
    skipped: false,
    rateMissing: false,
    actualKg: quoted.actualKg,
    volumetricKg: quoted.volumetricKg,
    ...dims,
    boxCount: detailParcels.length,
    parcels: detailParcels,
  };
}

function quoteBlueDartSimpleSpare(input: {
  rates: LogisticsCourierRates;
  partnerId: LogisticsPartnerId;
  destination: StCourierDestination | null | undefined;
  pin?: BlueDartPincodeDoc | null;
  packaging?: SpareFreightPackaging | SpareFreightPackaging[] | null;
  requirePackaging?: boolean;
}): SpareFreightQuoteResult {
  const service = blueDartServiceForPartner(input.partnerId);
  if (!service) {
    return emptySpareQuote({ skipped: true });
  }
  if (service === 'domestic_priority') {
    return quoteBlueDartDomesticPrioritySpare(input);
  }
  const resolved = resolveParcels({
    packaging: input.packaging,
    requirePackaging: input.requirePackaging,
    volumetricDivisor: Number(input.rates.bluedart[service].volumetricDivisor) || 5000,
  });
  if (resolved.incomplete) {
    return emptySpareQuote({ needsPackaging: true, rateMissing: true });
  }
  const agg = aggregateParcels(resolved.parcels);
  const zone = resolveBlueDartAirZone({
    shared: input.rates.bluedart.shared,
    destState: input.destination?.state,
  });
  if (!zone) {
    return emptySpareQuote({ rateMissing: true });
  }
  const perKgInr = Number(input.rates.bluedart[service].perKgInr[zone]) || 0;
  if (!(perKgInr > 0)) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: agg.chargeableKg,
      perKgInr: 0,
      ...agg.dims,
      actualKg: agg.actualKg,
      volumetricKg: agg.volumetricKg,
      boxCount: resolved.parcels.length,
      parcels: resolved.parcels,
    };
  }
  return {
    totalInr: ceilCourierChargeInr(perKgInr * agg.chargeableKg),
    chargeableKg: agg.chargeableKg,
    perKgInr,
    fuelSurchargePercent: 0,
    fuelSurchargeInr: 0,
    skipped: false,
    rateMissing: false,
    ...agg.dims,
    actualKg: agg.actualKg,
    volumetricKg: agg.volumetricKg,
    boxCount: resolved.parcels.length,
    parcels: resolved.parcels,
  };
}

function quoteTrackonSurfaceSpare(input: {
  rates: LogisticsCourierRates;
  destination: StCourierDestination | null | undefined;
  packaging?: SpareFreightPackaging | SpareFreightPackaging[] | null;
  requirePackaging?: boolean;
}): SpareFreightQuoteResult {
  const ready = sparePackagingListReady(input.packaging, input.requirePackaging);
  if (ready.incomplete) {
    return emptySpareQuote({ needsPackaging: true, rateMissing: true });
  }
  const parcels = ready.boxes.length > 0
    ? ready.boxes.map(box => ({
        actualKg: box.weightKg,
        dims: {
          lengthCm: box.lengthCm,
          widthCm: box.widthCm,
          heightCm: box.heightCm,
        },
      }))
    : [{ actualKg: SPARE_FREIGHT_BILLABLE_KG }];
  const quoted = quoteTrackonParcels({
    config: input.rates.trackon,
    service: 'surface',
    destination: input.destination,
    parcels,
  });
  const detailParcels = ready.boxes.length > 0
    ? ready.boxes.map(box => billableForBox(
      box,
      Number(input.rates.trackon.shared.volumetricDivisor) || 5000,
    ))
    : [defaultOneKgParcel()];
  if (quoted.notServiceable) {
    return emptySpareQuote({ rateMissing: true });
  }
  if (quoted.rateMissing) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: quoted.chargeableKg || 0,
      boxCount: detailParcels.length,
      parcels: detailParcels,
    };
  }
  const fuelSurchargePercent = Number(input.rates.trackon.shared.fuelSurchargePercent) || 0;
  const first = detailParcels[0];
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
    actualKg: detailParcels.reduce((sum, row) => sum + row.actualKg, 0),
    volumetricKg: quoted.volumetricKg,
    ...(first && first.lengthCm > 0
      ? {
          lengthCm: first.lengthCm,
          widthCm: first.widthCm,
          heightCm: first.heightCm,
        }
      : {}),
    boxCount: detailParcels.length,
    parcels: detailParcels,
  };
}

/** Quote auto spare freight for one ship-from site + selected partner. */
export function quoteSpareFreight(input: {
  partnerId: LogisticsPartnerId;
  site: InventorySite;
  zone: StCourierZone;
  destination: StCourierDestination | null | undefined;
  rates: LogisticsCourierRates;
  /** Helps BD Domestic Priority resolve A/B/C outside Kerala. */
  pin?: BlueDartPincodeDoc | null;
  /** Staff box(es) / custom LBH + weight. */
  packaging?: SpareFreightPackaging | SpareFreightPackaging[] | null;
  /** When true, refuse to quote until every box is complete. */
  requirePackaging?: boolean;
}): SpareFreightQuoteResult {
  const { partnerId } = input;
  if (isPickupPartner(partnerId)) {
    return emptySpareQuote({ skipped: true });
  }
  if (
    partnerId === 'dtdc'
    || partnerId === 'ecosafe'
    || partnerId === 'aps'
  ) {
    return emptySpareQuote({ skipped: true });
  }
  if (isTrackonLogisticsPartnerId(partnerId)) {
    return quoteTrackonSurfaceSpare({
      rates: input.rates,
      destination: input.destination,
      packaging: input.packaging,
      requirePackaging: input.requirePackaging,
    });
  }
  if (isBlueDartLogisticsPartnerId(partnerId)) {
    return quoteBlueDartSimpleSpare({
      rates: input.rates,
      partnerId,
      destination: input.destination,
      pin: input.pin,
      packaging: input.packaging,
      requirePackaging: input.requirePackaging,
    });
  }
  const originRates = originRatesForPartner(input.rates, partnerId, input.site);
  if (!originRates) {
    return emptySpareQuote({ skipped: true });
  }
  return quoteStStyleSpare({
    originRates,
    zone: input.zone,
    packaging: input.packaging,
    requirePackaging: input.requirePackaging,
  });
}
