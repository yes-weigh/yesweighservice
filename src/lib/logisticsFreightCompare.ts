import {
  blueDartServiceForPartner,
  isBlueDartLogisticsPartnerId,
  isTrackonLogisticsPartnerId,
  trackonServiceForPartner,
} from '../constants/logisticsPartners';
import type { DealerInvoiceDetail, DealerInvoiceLineItem } from '../types/invoices';
import type { LogisticsBooking } from '../types/logistics-dispatch';
import type { LogisticsCourierRates } from '../types/logistics-courier-rates';
import { isCourierRatePartnerId } from '../types/logistics-courier-rates';
import type { InventorySite } from './salesOrderSegments';
import { fetchAdminInvoiceDetail } from './admin-invoices';
import { quoteBlueDartParcels } from './blueDartQuote';
import { fetchDealerInvoiceDetail, isFreightInvoiceLineItem } from './invoices';
import { loadLogisticsCourierRates } from './logisticsCourierRates';
import { extractCityState } from './shippingLabel';
import { quoteStCourierParcels, type StCourierParcel } from './stCourierCartFreight';
import { computeStCourierQuote } from './stCourierQuote';
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
  isFreight: boolean;
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

export function invoiceItemsForLogistics(
  lineItems: readonly DealerInvoiceLineItem[],
): LogisticsInvoiceItemRow[] {
  return lineItems.map(line => ({
    id: line.id,
    name: line.name,
    sku: line.sku,
    quantity: line.quantity,
    rate: line.rate,
    total: lineAmount(line),
    imageUrl: line.imageUrl?.trim() || null,
    isFreight: isFreightInvoiceLineItem(line),
  }));
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

/**
 * Quote courier cost from the booking’s boxes/weights and current rate cards.
 */
export function quoteActualFreightFromBooking(
  booking: LogisticsBooking,
  rates: LogisticsCourierRates,
): { totalInr: number | null; chargeableKg: number | null; note: string | null } {
  const partnerId = booking.partnerId;
  if (partnerId === 'personal_collection') {
    return { totalInr: 0, chargeableKg: 0, note: 'Personal collection — no courier freight' };
  }

  const destination = destinationFromLogisticsBooking(booking);
  const zone = inferStCourierZone(destination);
  const site = originSite(booking);
  const parcels = bookingParcels(booking);

  if (isBlueDartLogisticsPartnerId(partnerId)) {
    const service = blueDartServiceForPartner(partnerId);
    if (!service) {
      return { totalInr: null, chargeableKg: null, note: 'Blue Dart service unavailable' };
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
      return { totalInr: null, chargeableKg: null, note: quoted.notServiceableReason || 'Not serviceable' };
    }
    if (quoted.rateMissing) {
      return { totalInr: null, chargeableKg: quoted.chargeableKg, note: 'Rate card missing for Blue Dart' };
    }
    return { totalInr: quoted.totalInr, chargeableKg: quoted.chargeableKg, note: null };
  }

  if (isTrackonLogisticsPartnerId(partnerId)) {
    const service = trackonServiceForPartner(partnerId);
    if (!service) {
      return { totalInr: null, chargeableKg: null, note: 'Trackon service unavailable' };
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
      return { totalInr: null, chargeableKg: null, note: 'Trackon not serviceable for destination' };
    }
    if (quoted.rateMissing) {
      return { totalInr: null, chargeableKg: quoted.chargeableKg, note: 'Rate card missing for Trackon' };
    }
    return { totalInr: quoted.totalInr, chargeableKg: quoted.chargeableKg, note: null };
  }

  if (!isCourierRatePartnerId(partnerId)) {
    return { totalInr: null, chargeableKg: null, note: 'No rate card for this courier' };
  }

  if (!zone) {
    return { totalInr: null, chargeableKg: null, note: 'Could not infer destination zone' };
  }

  const originRates = partnerId === 'st_courier'
    ? rates.st_courier[site]
    : partnerId === 'delhivery'
      ? rates.delhivery
      : null;
  if (!originRates) {
    return { totalInr: null, chargeableKg: null, note: 'Rate card missing' };
  }

  if (booking.shipmentMode === 'envelope') {
    const quoted = computeStCourierQuote({
      mode: 'envelope',
      zone,
      rates: originRates,
      actualKg: booking.actualWeightKg || 0,
    });
    const fixed = originRates.zones[zone]?.envelopeFixedInr || 0;
    if (!(fixed > 0) && !(quoted.totalInr > 0)) {
      return { totalInr: null, chargeableKg: 0, note: 'Envelope rate missing for zone' };
    }
    return { totalInr: quoted.totalInr, chargeableKg: 0, note: null };
  }

  if (!parcels.length) {
    return { totalInr: null, chargeableKg: null, note: 'No boxes to quote' };
  }

  const quoted = quoteStCourierParcels({
    zone,
    rates: originRates,
    parcels,
  });
  if (quoted.rateMissing) {
    return {
      totalInr: null,
      chargeableKg: quoted.chargeableKg,
      note: 'Per-kg rate missing for zone',
    };
  }
  return {
    totalInr: quoted.quote.totalInr,
    chargeableKg: quoted.chargeableKg,
    note: null,
  };
}

export function buildLogisticsFreightCompare(input: {
  booking: LogisticsBooking;
  invoice: DealerInvoiceDetail | null;
  rates: LogisticsCourierRates | null;
}): LogisticsFreightCompare {
  const { booking, invoice, rates } = input;
  const items = invoice ? invoiceItemsForLogistics(invoice.lineItems) : [];
  const paidFreightInr = invoice
    ? sumPaidFreightInr(invoice.lineItems)
    : null;

  let actualFreightInr: number | null = null;
  let chargeableKg: number | null = null;
  let actualNote: string | null = null;

  if (!rates) {
    actualNote = 'Rate cards not loaded';
  } else {
    const quoted = quoteActualFreightFromBooking(booking, rates);
    actualFreightInr = quoted.totalInr;
    chargeableKg = quoted.chargeableKg;
    actualNote = quoted.note;
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
  const [invoice, rates] = await Promise.all([
    fetchInvoiceForLogisticsBooking(booking, { isOps: options.isOps }),
    options.rates
      ? Promise.resolve(options.rates)
      : loadLogisticsCourierRates().catch(() => null),
  ]);
  return buildLogisticsFreightCompare({ booking, invoice, rates });
}

export function formatFreightDiffLabel(differenceInr: number): string {
  if (differenceInr === 0) return 'Matched';
  if (differenceInr > 0) return 'Under-billed';
  return 'Over-billed';
}
