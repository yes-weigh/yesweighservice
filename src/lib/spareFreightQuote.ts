/**
 * Spare freight quoting.
 * Default (dealer / no packaging): 1 kg billable flat.
 * Staff packaging: actual kg + L×B×H → partner chargeable stack.
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
};

export function sparePackagingIsComplete(
  packaging: SpareFreightPackaging | null | undefined,
): boolean {
  if (!packaging) return false;
  return (
    packaging.lengthCm > 0
    && packaging.widthCm > 0
    && packaging.heightCm > 0
    && packaging.weightKg > 0
  );
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
  };
}

function resolveBillable(input: {
  packaging?: SpareFreightPackaging | null;
  requirePackaging?: boolean;
  volumetricDivisor?: number;
}): {
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  dims: { lengthCm: number; widthCm: number; heightCm: number };
  incomplete: boolean;
} {
  const packaging = input.packaging;
  if (input.requirePackaging && !sparePackagingIsComplete(packaging)) {
    return {
      actualKg: 0,
      volumetricKg: 0,
      chargeableKg: 0,
      dims: { lengthCm: 0, widthCm: 0, heightCm: 0 },
      incomplete: true,
    };
  }
  if (sparePackagingIsComplete(packaging)) {
    const lengthCm = packaging!.lengthCm;
    const widthCm = packaging!.widthCm;
    const heightCm = packaging!.heightCm;
    const actualKg = packaging!.weightKg;
    const divisor = input.volumetricDivisor && input.volumetricDivisor > 0
      ? input.volumetricDivisor
      : 5000;
    const volumetricKg = (lengthCm * widthCm * heightCm) / divisor;
    const chargeableKg = ceilChargeableKg(Math.max(actualKg, volumetricKg));
    return {
      actualKg,
      volumetricKg,
      chargeableKg,
      dims: { lengthCm, widthCm, heightCm },
      incomplete: false,
    };
  }
  return {
    actualKg: SPARE_FREIGHT_BILLABLE_KG,
    volumetricKg: 0,
    chargeableKg: SPARE_FREIGHT_BILLABLE_KG,
    dims: { lengthCm: 0, widthCm: 0, heightCm: 0 },
    incomplete: false,
  };
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
  packaging?: SpareFreightPackaging | null;
  requirePackaging?: boolean;
}): SpareFreightQuoteResult {
  const billable = resolveBillable({
    packaging: input.packaging,
    requirePackaging: input.requirePackaging,
    volumetricDivisor: Number(input.originRates.volumetricDivisor) || 4500,
  });
  if (billable.incomplete) {
    return emptySpareQuote({ needsPackaging: true, rateMissing: true });
  }
  const boxPerKgInr = Number(input.originRates.zones[input.zone]?.boxPerKgInr) || 0;
  if (!(boxPerKgInr > 0)) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: billable.chargeableKg,
      perKgInr: 0,
      fuelSurchargePercent: Number(input.originRates.fuelSurchargePercent) || 0,
      actualKg: billable.actualKg,
      volumetricKg: billable.volumetricKg,
      ...billable.dims,
    };
  }
  const fuelSurchargePercent = Number(input.originRates.fuelSurchargePercent) || 0;
  const freightInr = boxPerKgInr * billable.chargeableKg;
  const fuelSurchargeInr = freightInr * (fuelSurchargePercent / 100);
  return {
    totalInr: ceilCourierChargeInr(freightInr + fuelSurchargeInr),
    chargeableKg: billable.chargeableKg,
    perKgInr: boxPerKgInr,
    fuelSurchargePercent,
    fuelSurchargeInr,
    skipped: false,
    rateMissing: false,
    actualKg: billable.actualKg,
    volumetricKg: billable.volumetricKg,
    ...billable.dims,
  };
}

function quoteBlueDartDomesticPrioritySpare(input: {
  rates: LogisticsCourierRates;
  destination: StCourierDestination | null | undefined;
  pin?: BlueDartPincodeDoc | null;
  packaging?: SpareFreightPackaging | null;
  requirePackaging?: boolean;
}): SpareFreightQuoteResult {
  if (input.requirePackaging && !sparePackagingIsComplete(input.packaging)) {
    return emptySpareQuote({ needsPackaging: true, rateMissing: true });
  }
  const actualKg = sparePackagingIsComplete(input.packaging)
    ? input.packaging!.weightKg
    : SPARE_FREIGHT_BILLABLE_KG;
  const dims = sparePackagingIsComplete(input.packaging)
    ? {
        lengthCm: input.packaging!.lengthCm,
        widthCm: input.packaging!.widthCm,
        heightCm: input.packaging!.heightCm,
      }
    : { lengthCm: 0, widthCm: 0, heightCm: 0 };
  const quoted = quoteBlueDartParcels({
    config: input.rates.bluedart,
    service: 'domestic_priority',
    destState: input.destination?.state,
    pin: input.pin ?? null,
    parcels: [{ actualKg, dims }],
  });
  if (quoted.notServiceable) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: quoted.chargeableKg || 0,
      ...dims,
      actualKg,
      volumetricKg: quoted.volumetricKg,
    };
  }
  if (quoted.rateMissing) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: quoted.chargeableKg || actualKg,
      ...dims,
      actualKg,
      volumetricKg: quoted.volumetricKg,
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
  };
}

function quoteBlueDartSimpleSpare(input: {
  rates: LogisticsCourierRates;
  partnerId: LogisticsPartnerId;
  destination: StCourierDestination | null | undefined;
  pin?: BlueDartPincodeDoc | null;
  packaging?: SpareFreightPackaging | null;
  requirePackaging?: boolean;
}): SpareFreightQuoteResult {
  const service = blueDartServiceForPartner(input.partnerId);
  if (!service) {
    return emptySpareQuote({ skipped: true });
  }
  if (service === 'domestic_priority') {
    return quoteBlueDartDomesticPrioritySpare(input);
  }
  if (input.requirePackaging && !sparePackagingIsComplete(input.packaging)) {
    return emptySpareQuote({ needsPackaging: true, rateMissing: true });
  }
  const billable = resolveBillable({
    packaging: input.packaging,
    requirePackaging: false,
    volumetricDivisor: Number(input.rates.bluedart[service].volumetricDivisor) || 5000,
  });
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
      chargeableKg: billable.chargeableKg,
      perKgInr: 0,
      ...billable.dims,
      actualKg: billable.actualKg,
      volumetricKg: billable.volumetricKg,
    };
  }
  return {
    totalInr: ceilCourierChargeInr(perKgInr * billable.chargeableKg),
    chargeableKg: billable.chargeableKg,
    perKgInr,
    fuelSurchargePercent: 0,
    fuelSurchargeInr: 0,
    skipped: false,
    rateMissing: false,
    ...billable.dims,
    actualKg: billable.actualKg,
    volumetricKg: billable.volumetricKg,
  };
}

function quoteTrackonSurfaceSpare(input: {
  rates: LogisticsCourierRates;
  destination: StCourierDestination | null | undefined;
  packaging?: SpareFreightPackaging | null;
  requirePackaging?: boolean;
}): SpareFreightQuoteResult {
  if (input.requirePackaging && !sparePackagingIsComplete(input.packaging)) {
    return emptySpareQuote({ needsPackaging: true, rateMissing: true });
  }
  const parcel = sparePackagingIsComplete(input.packaging)
    ? {
        actualKg: input.packaging!.weightKg,
        dims: {
          lengthCm: input.packaging!.lengthCm,
          widthCm: input.packaging!.widthCm,
          heightCm: input.packaging!.heightCm,
        },
      }
    : { actualKg: SPARE_FREIGHT_BILLABLE_KG };
  const quoted = quoteTrackonParcels({
    config: input.rates.trackon,
    service: 'surface',
    destination: input.destination,
    parcels: [parcel],
  });
  if (quoted.notServiceable) {
    return emptySpareQuote({ rateMissing: true });
  }
  if (quoted.rateMissing) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: quoted.chargeableKg || 0,
    };
  }
  const fuelSurchargePercent = Number(input.rates.trackon.shared.fuelSurchargePercent) || 0;
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
    actualKg: sparePackagingIsComplete(input.packaging)
      ? input.packaging!.weightKg
      : SPARE_FREIGHT_BILLABLE_KG,
    volumetricKg: quoted.volumetricKg,
    ...(sparePackagingIsComplete(input.packaging)
      ? {
          lengthCm: input.packaging!.lengthCm,
          widthCm: input.packaging!.widthCm,
          heightCm: input.packaging!.heightCm,
        }
      : {}),
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
  /** Staff box / custom LBH + weight. */
  packaging?: SpareFreightPackaging | null;
  /** When true, refuse to quote until packaging is complete. */
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
