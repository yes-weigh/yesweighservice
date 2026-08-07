import {
  blueDartServiceForPartner,
  isBlueDartLogisticsPartnerId,
  isTrackonLogisticsPartnerId,
  logisticsPartnerLabel,
  trackonServiceForPartner,
} from '../constants/logisticsPartners';
import type { DealerInvoiceDetail, DealerInvoiceLineItem } from '../types/invoices';
import type { LogisticsBooking, ShipmentMode } from '../types/logistics-dispatch';
import type { LogisticsCourierRates } from '../types/logistics-courier-rates';
import {
  isCourierRatePartnerId,
  ST_COURIER_ZONE_LABELS,
} from '../types/logistics-courier-rates';
import { STAFF_LOGISTICS_SITE_LABELS } from '../types/staff-logistics';
import type { InventorySite } from './salesOrderSegments';
import { fetchAdminInvoiceDetail } from './admin-invoices';
import { quoteBlueDartParcels } from './blueDartQuote';
import {
  fetchGatcReportForInvoice,
  type GatcReportLineItem,
} from './gatcReports';
import {
  fetchDealerInvoiceDetail,
  isFreightInvoiceLineItem,
  isStampingInvoiceLineItem,
  serialNumbersFromLineItem,
} from './invoices';
import {
  boxChargeableWeight,
  boxDimensionsLabel,
  computeVolumetricWeight,
} from './logisticsBooking';
import { loadLogisticsCourierRates } from './logisticsCourierRates';
import { extractCityState, resolveDestinationPlace } from './shippingLabel';
import { quoteStCourierParcels, type StCourierParcel } from './stCourierCartFreight';
import { computeStCourierQuote, stCourierVolumetricKg } from './stCourierQuote';
import { inferStCourierZone, type StCourierDestination } from './stCourierZone';
import { quoteTrackonParcels } from './trackonQuote';

export type LogisticsInvoiceItemRow = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  rate: number;
  total: number;
  imageUrl: string | null;
  description: string | null;
  serialNumbers: string[];
  /** true / false when known from GATC report; null when unknown. */
  hasStamping: boolean | null;
  stampingLabel: string | null;
  isFreight: boolean;
  isStampingFee: boolean;
};

export type LogisticsFreightBoxCalc = {
  index: number;
  label: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  dimensionsLabel: string;
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
};

export type LogisticsFreightCalcDetails = {
  partnerLabel: string;
  shipmentMode: ShipmentMode;
  boxCount: number;
  shipFromLabel: string;
  zoneLabel: string | null;
  destinationLabel: string | null;
  boxes: LogisticsFreightBoxCalc[];
  totalActualKg: number;
  totalVolumetricKg: number;
  totalChargeableKg: number;
  volumetricDivisor: number | null;
  boxPerKgInr: number | null;
  envelopeFixedInr: number | null;
  fuelSurchargePercent: number | null;
  freightInr: number | null;
  fuelSurchargeInr: number | null;
  totalInr: number | null;
};

export type LogisticsFreightCompare = {
  invoiceId: string | null;
  invoiceNumber: string | null;
  items: LogisticsInvoiceItemRow[];
  /** Freight billed on the linked invoice (sum of freight line totals). */
  paidFreightInr: number | null;
  /** Rate-card estimate from booked boxes / weights. */
  actualFreightInr: number | null;
  /** actual − paid (positive = under-billed vs courier cost). */
  differenceInr: number | null;
  actualNote: string | null;
  chargeableKg: number | null;
  calc: LogisticsFreightCalcDetails | null;
};

function lineAmount(line: Pick<DealerInvoiceLineItem, 'total' | 'rate' | 'quantity'>): number {
  if (typeof line.total === 'number' && Number.isFinite(line.total)) return line.total;
  const rate = Number(line.rate) || 0;
  const qty = Number(line.quantity) || 0;
  return rate * qty;
}

export function sumPaidFreightInr(
  lineItems: ReadonlyArray<Pick<DealerInvoiceLineItem, 'name' | 'sku' | 'hsn' | 'itemId' | 'id' | 'total' | 'rate' | 'quantity'>>,
): number {
  return lineItems.reduce((sum, line) => (
    isFreightInvoiceLineItem(line) ? sum + lineAmount(line) : sum
  ), 0);
}

function normKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function matchGatcLine(
  line: DealerInvoiceLineItem,
  gatcLines: readonly GatcReportLineItem[],
  used: Set<number>,
): GatcReportLineItem | null {
  const itemId = normKey(line.itemId);
  const sku = normKey(line.sku);
  const name = normKey(line.name);
  const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));

  const tryMatch = (predicate: (gatc: GatcReportLineItem, index: number) => boolean) => {
    for (let i = 0; i < gatcLines.length; i += 1) {
      if (used.has(i)) continue;
      const gatc = gatcLines[i]!;
      if (!predicate(gatc, i)) continue;
      used.add(i);
      return gatc;
    }
    return null;
  };

  return (
    (itemId
      ? tryMatch(gatc => normKey(gatc.itemId) === itemId || normKey(gatc.productId) === itemId)
      : null)
    || (sku ? tryMatch(gatc => normKey(gatc.sku) === sku && (!qty || gatc.qty === qty)) : null)
    || (sku ? tryMatch(gatc => normKey(gatc.sku) === sku) : null)
    || (name ? tryMatch(gatc => normKey(gatc.name) === name && (!qty || gatc.qty === qty)) : null)
    || (name ? tryMatch(gatc => normKey(gatc.name) === name) : null)
  );
}

function stampingFromDescription(description: string | null | undefined): {
  hasStamping: boolean | null;
  stampingLabel: string | null;
} {
  const text = String(description ?? '').toLowerCase();
  if (!text) return { hasStamping: null, stampingLabel: null };
  if (/\bwithout\s+stamping\b|\bno\s+stamping\b|\bunstamped\b/.test(text)) {
    return { hasStamping: false, stampingLabel: 'Without stamping' };
  }
  if (/\bwith\s+stamping\b|\bstamped\b|\bstamping\s*\(/.test(text)) {
    return { hasStamping: true, stampingLabel: 'With stamping' };
  }
  return { hasStamping: null, stampingLabel: null };
}

function stampingLabelFromGatc(
  gatc: GatcReportLineItem | null,
  description: string | null | undefined,
): {
  hasStamping: boolean | null;
  stampingLabel: string | null;
} {
  if (gatc) {
    if (gatc.hasStamping) {
      const range = gatc.gatcStampingRange?.trim();
      return {
        hasStamping: true,
        stampingLabel: range ? `With stamping (${range})` : 'With stamping',
      };
    }
    return { hasStamping: false, stampingLabel: 'Without stamping' };
  }
  return stampingFromDescription(description);
}

export function invoiceItemsForLogistics(
  lineItems: readonly DealerInvoiceLineItem[],
  gatcLines: readonly GatcReportLineItem[] = [],
): LogisticsInvoiceItemRow[] {
  const used = new Set<number>();
  return lineItems.map(line => {
    const isFreight = isFreightInvoiceLineItem(line);
    const isStampingFee = !isFreight && isStampingInvoiceLineItem(line);
    const gatc = (!isFreight && !isStampingFee)
      ? matchGatcLine(line, gatcLines, used)
      : null;
    const stamping = isStampingFee
      ? { hasStamping: true as boolean | null, stampingLabel: 'Stamping fee' }
      : stampingLabelFromGatc(gatc, line.description);

    return {
      id: line.id,
      name: line.name,
      sku: line.sku,
      quantity: line.quantity,
      rate: line.rate,
      total: lineAmount(line),
      imageUrl: line.imageUrl?.trim() || null,
      description: line.description?.trim() || null,
      serialNumbers: serialNumbersFromLineItem(line),
      hasStamping: stamping.hasStamping,
      stampingLabel: stamping.stampingLabel,
      isFreight,
      isStampingFee,
    };
  });
}

export function destinationFromLogisticsBooking(
  booking: Pick<LogisticsBooking, 'deliveryAddress' | 'dealer'>,
): StCourierDestination {
  const address = (
    booking.deliveryAddress
    || booking.dealer.shippingAddress
    || booking.dealer.billingAddress
    || ''
  ).trim();
  const cityState = extractCityState(address);
  let city: string | null = booking.dealer.destinationCity?.trim() || null;
  let state: string | null = null;
  if (cityState) {
    const [left, right] = cityState.split(',').map(part => part.trim());
    if (left) city = city || left;
    if (right) state = right;
  }
  const pinMatch = address.match(/\b(\d{6})\b/);
  // Fall back to full address text so zone inference can match state names inside it.
  if (!state) state = address || city;
  return {
    state,
    city,
    zip: pinMatch?.[1] ?? null,
  };
}

function bookingParcels(booking: LogisticsBooking): StCourierParcel[] {
  const boxes = booking.boxes.length
    ? booking.boxes
    : [{
      id: 'box-fallback',
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      weightKg: booking.actualWeightKg || 0,
      volumetricWeightKg: booking.volumetricWeightKg || 0,
      photos: [],
    }];

  return boxes.map((box, index) => ({
    productId: box.id || `box-${index}`,
    sku: null,
    name: `Box ${index + 1}`,
    kind: 'single_box' as const,
    quantityUnits: 1,
    actualKg: Number(box.weightKg) || 0,
    dims: {
      lengthCm: box.lengthCm,
      widthCm: box.widthCm,
      heightCm: box.heightCm,
    },
  }));
}

function originSite(booking: LogisticsBooking): InventorySite {
  return booking.shipFromSite === 'head_office' ? 'head_office' : 'cochin';
}

function buildBookingBoxCalcs(
  booking: LogisticsBooking,
  volumetricDivisor: number | null,
): LogisticsFreightBoxCalc[] {
  const isEnvelope = booking.shipmentMode === 'envelope';
  const boxes = booking.boxes.length
    ? booking.boxes
    : [{
      id: 'box-fallback',
      lengthCm: null as number | null,
      widthCm: null as number | null,
      heightCm: null as number | null,
      weightKg: booking.actualWeightKg || 0,
      volumetricWeightKg: booking.volumetricWeightKg || 0,
      photos: [],
    }];

  return boxes.map((box, index) => {
    const actualKg = Number(box.weightKg) || 0;
    const volumetricKg = isEnvelope
      ? 0
      : (volumetricDivisor != null && volumetricDivisor > 0
        ? stCourierVolumetricKg({
          lengthCm: box.lengthCm,
          widthCm: box.widthCm,
          heightCm: box.heightCm,
        }, volumetricDivisor)
        : (Number(box.volumetricWeightKg) || computeVolumetricWeight(
          box.lengthCm,
          box.widthCm,
          box.heightCm,
        )));
    const chargeableKg = isEnvelope
      ? 0
      : boxChargeableWeight({ weightKg: actualKg, volumetricWeightKg: volumetricKg });
    return {
      index: index + 1,
      label: isEnvelope ? 'Envelope' : `Box ${index + 1}`,
      lengthCm: box.lengthCm,
      widthCm: box.widthCm,
      heightCm: box.heightCm,
      dimensionsLabel: isEnvelope ? 'Envelope' : boxDimensionsLabel(box),
      actualKg,
      volumetricKg,
      chargeableKg,
    };
  });
}

function emptyCalcBase(booking: LogisticsBooking): Omit<
  LogisticsFreightCalcDetails,
  | 'boxes'
  | 'totalActualKg'
  | 'totalVolumetricKg'
  | 'totalChargeableKg'
  | 'volumetricDivisor'
  | 'boxPerKgInr'
  | 'envelopeFixedInr'
  | 'fuelSurchargePercent'
  | 'freightInr'
  | 'fuelSurchargeInr'
  | 'totalInr'
  | 'zoneLabel'
> & { zoneLabel: string | null } {
  const destination = destinationFromLogisticsBooking(booking);
  const zone = inferStCourierZone(destination);
  return {
    partnerLabel: logisticsPartnerLabel(booking.partnerId),
    shipmentMode: booking.shipmentMode,
    boxCount: Math.max(1, booking.numberOfBoxes || booking.boxes.length || 1),
    shipFromLabel: STAFF_LOGISTICS_SITE_LABELS[booking.shipFromSite] || booking.shipFromSite,
    zoneLabel: zone ? ST_COURIER_ZONE_LABELS[zone] : null,
    destinationLabel: resolveDestinationPlace(booking.dealer, booking.deliveryAddress),
  };
}

function finalizeCalc(
  base: ReturnType<typeof emptyCalcBase>,
  boxes: LogisticsFreightBoxCalc[],
  extras: Partial<LogisticsFreightCalcDetails>,
): LogisticsFreightCalcDetails {
  return {
    ...base,
    boxes,
    totalActualKg: extras.totalActualKg
      ?? boxes.reduce((sum, box) => sum + box.actualKg, 0),
    totalVolumetricKg: extras.totalVolumetricKg
      ?? boxes.reduce((sum, box) => sum + box.volumetricKg, 0),
    totalChargeableKg: extras.totalChargeableKg
      ?? boxes.reduce((sum, box) => sum + box.chargeableKg, 0),
    volumetricDivisor: extras.volumetricDivisor ?? null,
    boxPerKgInr: extras.boxPerKgInr ?? null,
    envelopeFixedInr: extras.envelopeFixedInr ?? null,
    fuelSurchargePercent: extras.fuelSurchargePercent ?? null,
    freightInr: extras.freightInr ?? null,
    fuelSurchargeInr: extras.fuelSurchargeInr ?? null,
    totalInr: extras.totalInr ?? null,
    zoneLabel: extras.zoneLabel ?? base.zoneLabel,
  };
}

/**
 * Quote courier cost from the booking’s boxes/weights and current rate cards.
 */
export function quoteActualFreightFromBooking(
  booking: LogisticsBooking,
  rates: LogisticsCourierRates,
): {
  totalInr: number | null;
  chargeableKg: number | null;
  note: string | null;
  calc: LogisticsFreightCalcDetails;
} {
  const partnerId = booking.partnerId;
  const base = emptyCalcBase(booking);
  const destination = destinationFromLogisticsBooking(booking);
  const zone = inferStCourierZone(destination);
  const site = originSite(booking);
  const parcels = bookingParcels(booking);

  if (partnerId === 'personal_collection') {
    const boxes = buildBookingBoxCalcs(booking, null);
    return {
      totalInr: 0,
      chargeableKg: 0,
      note: 'Personal collection — no courier freight',
      calc: finalizeCalc(base, boxes, { totalInr: 0 }),
    };
  }

  if (isBlueDartLogisticsPartnerId(partnerId)) {
    const service = blueDartServiceForPartner(partnerId);
    const divisor = service
      ? (service === 'domestic_priority'
        ? rates.bluedart.domestic_priority.volumetricDivisor
        : rates.bluedart[service].volumetricDivisor)
      : null;
    const boxes = buildBookingBoxCalcs(booking, divisor);
    if (!service) {
      return {
        totalInr: null,
        chargeableKg: null,
        note: 'Blue Dart service unavailable',
        calc: finalizeCalc(base, boxes, { volumetricDivisor: divisor }),
      };
    }
    const quoted = quoteBlueDartParcels({
      config: rates.bluedart,
      service,
      destState: destination.state,
      pin: null,
      parcels: parcels.map(p => ({
        actualKg: p.actualKg,
        dims: {
          lengthCm: Number(p.dims.lengthCm) || 0,
          widthCm: Number(p.dims.widthCm) || 0,
          heightCm: Number(p.dims.heightCm) || 0,
        },
      })),
      invoiceValueInr: 0,
    });
    if (quoted.notServiceable) {
      return {
        totalInr: null,
        chargeableKg: null,
        note: quoted.notServiceableReason || 'Not serviceable',
        calc: finalizeCalc(base, boxes, {
          volumetricDivisor: divisor,
          zoneLabel: quoted.zoneLabel || base.zoneLabel,
        }),
      };
    }
    if (quoted.rateMissing) {
      return {
        totalInr: null,
        chargeableKg: quoted.chargeableKg,
        note: 'Rate card missing for Blue Dart',
        calc: finalizeCalc(base, boxes, {
          volumetricDivisor: divisor,
          zoneLabel: quoted.zoneLabel || base.zoneLabel,
          totalChargeableKg: quoted.chargeableKg,
        }),
      };
    }
    return {
      totalInr: quoted.totalInr,
      chargeableKg: quoted.chargeableKg,
      note: null,
      calc: finalizeCalc(base, boxes, {
        volumetricDivisor: divisor,
        zoneLabel: quoted.zoneLabel || base.zoneLabel,
        freightInr: quoted.baseFreightInr,
        fuelSurchargeInr: quoted.fuelSurchargeInr,
        totalInr: quoted.totalInr,
        totalChargeableKg: quoted.chargeableKg,
      }),
    };
  }

  if (isTrackonLogisticsPartnerId(partnerId)) {
    const service = trackonServiceForPartner(partnerId);
    const divisor = rates.trackon.shared.volumetricDivisor || 5000;
    const boxes = buildBookingBoxCalcs(booking, divisor);
    if (!service) {
      return {
        totalInr: null,
        chargeableKg: null,
        note: 'Trackon service unavailable',
        calc: finalizeCalc(base, boxes, { volumetricDivisor: divisor }),
      };
    }
    const quoted = quoteTrackonParcels({
      config: rates.trackon,
      service,
      destination,
      parcels: parcels.map(p => ({
        actualKg: p.actualKg,
        dims: {
          lengthCm: Number(p.dims.lengthCm) || 0,
          widthCm: Number(p.dims.widthCm) || 0,
          heightCm: Number(p.dims.heightCm) || 0,
        },
      })),
    });
    if (quoted.notServiceable) {
      return {
        totalInr: null,
        chargeableKg: null,
        note: 'Trackon not serviceable for destination',
        calc: finalizeCalc(base, boxes, { volumetricDivisor: divisor }),
      };
    }
    if (quoted.rateMissing) {
      return {
        totalInr: null,
        chargeableKg: quoted.chargeableKg,
        note: 'Rate card missing for Trackon',
        calc: finalizeCalc(base, boxes, {
          volumetricDivisor: divisor,
          totalChargeableKg: quoted.chargeableKg,
        }),
      };
    }
    return {
      totalInr: quoted.totalInr,
      chargeableKg: quoted.chargeableKg,
      note: null,
      calc: finalizeCalc(base, boxes, {
        volumetricDivisor: divisor,
        freightInr: quoted.freightInr,
        fuelSurchargeInr: quoted.fuelSurchargeInr,
        totalInr: quoted.totalInr,
        totalChargeableKg: quoted.chargeableKg,
      }),
    };
  }

  if (!isCourierRatePartnerId(partnerId)) {
    const boxes = buildBookingBoxCalcs(booking, null);
    return {
      totalInr: null,
      chargeableKg: null,
      note: 'No rate card for this courier',
      calc: finalizeCalc(base, boxes, {}),
    };
  }

  if (!zone) {
    const boxes = buildBookingBoxCalcs(booking, null);
    return {
      totalInr: null,
      chargeableKg: null,
      note: 'Could not infer destination zone',
      calc: finalizeCalc(base, boxes, {}),
    };
  }

  const originRates = partnerId === 'st_courier'
    ? rates.st_courier[site]
    : partnerId === 'delhivery'
      ? rates.delhivery
      : null;
  if (!originRates) {
    const boxes = buildBookingBoxCalcs(booking, null);
    return {
      totalInr: null,
      chargeableKg: null,
      note: 'Rate card missing',
      calc: finalizeCalc(base, boxes, {}),
    };
  }

  const divisor = originRates.volumetricDivisor > 0 ? originRates.volumetricDivisor : 5000;
  const fuelPct = Number(originRates.fuelSurchargePercent) || 0;

  if (booking.shipmentMode === 'envelope') {
    const boxes = buildBookingBoxCalcs(booking, divisor);
    const quoted = computeStCourierQuote({
      mode: 'envelope',
      zone,
      rates: originRates,
      actualKg: booking.actualWeightKg || 0,
    });
    const fixed = originRates.zones[zone]?.envelopeFixedInr || 0;
    if (!(fixed > 0) && !(quoted.totalInr > 0)) {
      return {
        totalInr: null,
        chargeableKg: 0,
        note: 'Envelope rate missing for zone',
        calc: finalizeCalc(base, boxes, {
          volumetricDivisor: divisor,
          envelopeFixedInr: fixed,
          fuelSurchargePercent: fuelPct,
        }),
      };
    }
    return {
      totalInr: quoted.totalInr,
      chargeableKg: 0,
      note: null,
      calc: finalizeCalc(base, boxes, {
        volumetricDivisor: divisor,
        envelopeFixedInr: quoted.envelopeFixedInr,
        fuelSurchargePercent: fuelPct,
        freightInr: quoted.freightInr,
        fuelSurchargeInr: quoted.fuelSurchargeInr,
        totalInr: quoted.totalInr,
      }),
    };
  }

  if (!parcels.length) {
    const boxes = buildBookingBoxCalcs(booking, divisor);
    return {
      totalInr: null,
      chargeableKg: null,
      note: 'No boxes to quote',
      calc: finalizeCalc(base, boxes, { volumetricDivisor: divisor }),
    };
  }

  const quoted = quoteStCourierParcels({
    zone,
    rates: originRates,
    parcels,
  });
  const boxes = buildBookingBoxCalcs(booking, divisor).map((box, index) => ({
    ...box,
    chargeableKg: quoted.perParcelChargeableKg[index] ?? box.chargeableKg,
    volumetricKg: stCourierVolumetricKg({
      lengthCm: box.lengthCm,
      widthCm: box.widthCm,
      heightCm: box.heightCm,
    }, divisor) || box.volumetricKg,
  }));

  if (quoted.rateMissing) {
    return {
      totalInr: null,
      chargeableKg: quoted.chargeableKg,
      note: 'Per-kg rate missing for zone',
      calc: finalizeCalc(base, boxes, {
        volumetricDivisor: divisor,
        boxPerKgInr: quoted.quote.boxPerKgInr,
        fuelSurchargePercent: fuelPct,
        totalChargeableKg: quoted.chargeableKg,
      }),
    };
  }

  return {
    totalInr: quoted.quote.totalInr,
    chargeableKg: quoted.chargeableKg,
    note: null,
    calc: finalizeCalc(base, boxes, {
      volumetricDivisor: divisor,
      boxPerKgInr: quoted.quote.boxPerKgInr,
      fuelSurchargePercent: fuelPct,
      freightInr: quoted.quote.freightInr,
      fuelSurchargeInr: quoted.quote.fuelSurchargeInr,
      totalInr: quoted.quote.totalInr,
      totalChargeableKg: quoted.chargeableKg,
      totalActualKg: quoted.actualKg,
      totalVolumetricKg: quoted.volumetricKg,
    }),
  };
}

export function buildLogisticsFreightCompare(input: {
  booking: LogisticsBooking;
  invoice: DealerInvoiceDetail | null;
  rates: LogisticsCourierRates | null;
  gatcLines?: readonly GatcReportLineItem[] | null;
}): LogisticsFreightCompare {
  const { booking, invoice, rates } = input;
  const items = invoice
    ? invoiceItemsForLogistics(invoice.lineItems, input.gatcLines ?? [])
    : [];
  const paidFreightInr = invoice
    ? sumPaidFreightInr(invoice.lineItems)
    : null;

  let actualFreightInr: number | null = null;
  let chargeableKg: number | null = null;
  let actualNote: string | null = null;
  let calc: LogisticsFreightCalcDetails | null = null;

  if (!rates) {
    actualNote = 'Rate cards not loaded';
    calc = finalizeCalc(
      emptyCalcBase(booking),
      buildBookingBoxCalcs(booking, null),
      {},
    );
  } else {
    const quoted = quoteActualFreightFromBooking(booking, rates);
    actualFreightInr = quoted.totalInr;
    chargeableKg = quoted.chargeableKg;
    actualNote = quoted.note;
    calc = quoted.calc;
  }

  const differenceInr = (
    paidFreightInr != null && actualFreightInr != null
      ? actualFreightInr - paidFreightInr
      : null
  );

  return {
    invoiceId: invoice?.id ?? booking.invoiceId,
    invoiceNumber: invoice?.invoiceNumber ?? booking.invoiceNumber,
    items,
    paidFreightInr,
    actualFreightInr,
    differenceInr,
    actualNote,
    chargeableKg,
    calc,
  };
}

export async function fetchInvoiceForLogisticsBooking(
  booking: LogisticsBooking,
  options: { isOps: boolean },
): Promise<DealerInvoiceDetail | null> {
  const invoiceId = booking.invoiceId?.trim();
  if (!invoiceId) return null;
  const customerId = booking.dealer.zohoCustomerId?.trim();
  try {
    if (options.isOps && customerId) {
      return await fetchAdminInvoiceDetail(customerId, invoiceId);
    }
    return await fetchDealerInvoiceDetail(invoiceId, {
      customerId: customerId || undefined,
    });
  } catch {
    if (options.isOps && customerId) {
      try {
        return await fetchDealerInvoiceDetail(invoiceId, { customerId });
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Load invoice + rate cards and build the compare model for one booking. */
export async function loadLogisticsFreightCompare(
  booking: LogisticsBooking,
  options: { isOps: boolean; rates?: LogisticsCourierRates | null },
): Promise<LogisticsFreightCompare> {
  const invoiceId = booking.invoiceId?.trim() || '';
  const [invoice, rates, gatcReport] = await Promise.all([
    fetchInvoiceForLogisticsBooking(booking, { isOps: options.isOps }),
    options.rates
      ? Promise.resolve(options.rates)
      : loadLogisticsCourierRates().catch(() => null),
    invoiceId ? fetchGatcReportForInvoice(invoiceId) : Promise.resolve(null),
  ]);
  return buildLogisticsFreightCompare({
    booking,
    invoice,
    rates,
    gatcLines: gatcReport?.lineItems ?? [],
  });
}

export function formatFreightDiffLabel(differenceInr: number): string {
  if (differenceInr === 0) return 'Matched';
  if (differenceInr > 0) return 'Under-billed';
  return 'Over-billed';
}
