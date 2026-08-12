/**
 * Auto spare-parts freight (1 kg billable).
 * ST/Delhivery: zone box ₹/kg × 1 + fuel%.
 * Trackon: Surface only — perKg × max(1, minKg) + fuel% (default min 4 kg, 15%).
 * Blue Dart Air/Surface: zone ₹/kg × 1 (no surcharges).
 * Blue Dart Domestic Priority: full DP stack on 1 kg (500 g slabs + surcharges).
 * DTDC / Eco Safe / APS / pickup / own vehicle: ₹0 (manual or N/A).
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
import { ceilCourierChargeInr } from './stCourierQuote';
import type { StCourierDestination } from './stCourierZone';
import { quoteTrackonParcels } from './trackonQuote';

/** Spares under 1 kg (or missing weight) bill as 1 kg. */
export const SPARE_FREIGHT_BILLABLE_KG = 1;

export type SpareFreightQuoteResult = {
  totalInr: number;
  chargeableKg: number;
  perKgInr: number;
  fuelSurchargePercent: number;
  fuelSurchargeInr: number;
  /** Partner has no auto spare tariff (staff enter ₹ if needed). */
  skipped: boolean;
  rateMissing: boolean;
};

function emptySpareQuote(flags?: {
  skipped?: boolean;
  rateMissing?: boolean;
}): SpareFreightQuoteResult {
  return {
    totalInr: 0,
    chargeableKg: 0,
    perKgInr: 0,
    fuelSurchargePercent: 0,
    fuelSurchargeInr: 0,
    skipped: Boolean(flags?.skipped),
    rateMissing: Boolean(flags?.rateMissing),
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
}): SpareFreightQuoteResult {
  const boxPerKgInr = Number(input.originRates.zones[input.zone]?.boxPerKgInr) || 0;
  if (!(boxPerKgInr > 0)) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: SPARE_FREIGHT_BILLABLE_KG,
      perKgInr: 0,
      fuelSurchargePercent: Number(input.originRates.fuelSurchargePercent) || 0,
    };
  }
  const fuelSurchargePercent = Number(input.originRates.fuelSurchargePercent) || 0;
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

function quoteBlueDartDomesticPrioritySpare(input: {
  rates: LogisticsCourierRates;
  destination: StCourierDestination | null | undefined;
  pin?: BlueDartPincodeDoc | null;
}): SpareFreightQuoteResult {
  const quoted = quoteBlueDartParcels({
    config: input.rates.bluedart,
    service: 'domestic_priority',
    destState: input.destination?.state,
    pin: input.pin ?? null,
    parcels: [{
      actualKg: SPARE_FREIGHT_BILLABLE_KG,
      dims: { lengthCm: 0, widthCm: 0, heightCm: 0 },
    }],
  });
  if (quoted.notServiceable) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: quoted.chargeableKg || 0,
    };
  }
  if (quoted.rateMissing) {
    return {
      ...emptySpareQuote({ rateMissing: true }),
      chargeableKg: quoted.chargeableKg || SPARE_FREIGHT_BILLABLE_KG,
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
  };
}

function quoteBlueDartSimpleSpare(input: {
  rates: LogisticsCourierRates;
  partnerId: LogisticsPartnerId;
  destination: StCourierDestination | null | undefined;
  pin?: BlueDartPincodeDoc | null;
}): SpareFreightQuoteResult {
  const service = blueDartServiceForPartner(input.partnerId);
  if (!service) {
    return emptySpareQuote({ skipped: true });
  }
  if (service === 'domestic_priority') {
    return quoteBlueDartDomesticPrioritySpare(input);
  }
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
      chargeableKg: SPARE_FREIGHT_BILLABLE_KG,
      perKgInr: 0,
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

function quoteTrackonSurfaceSpare(input: {
  rates: LogisticsCourierRates;
  destination: StCourierDestination | null | undefined;
}): SpareFreightQuoteResult {
  const quoted = quoteTrackonParcels({
    config: input.rates.trackon,
    service: 'surface',
    destination: input.destination,
    parcels: [{ actualKg: SPARE_FREIGHT_BILLABLE_KG }],
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
    });
  }
  if (isBlueDartLogisticsPartnerId(partnerId)) {
    return quoteBlueDartSimpleSpare({
      rates: input.rates,
      partnerId,
      destination: input.destination,
      pin: input.pin,
    });
  }
  const originRates = originRatesForPartner(input.rates, partnerId, input.site);
  if (!originRates) {
    return emptySpareQuote({ skipped: true });
  }
  return quoteStStyleSpare({ originRates, zone: input.zone });
}
