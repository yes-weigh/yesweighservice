import type { NavigateFunction } from 'react-router-dom';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { CatalogProduct } from '../types/catalog';
import type { DealerSupportRequest } from '../types/dealer-support';
import type { DealerInvoiceDetail, InvoiceCategory } from '../types/invoices';
import type { Role } from '../types';
import { homePathForRole } from '../types';
import type { LogisticsBookingDraft, ShipmentBoxDraft } from '../types/logistics-dispatch';
import type { StaffLogisticsSite } from '../types/staff-logistics';
import { isFreightInvoiceLineItem } from './invoices';
import {
  emptyShipmentBoxDraft,
  isPipelineEnabledPartner,
} from './logisticsBooking';
import { partnerIdForFreightSku } from './orderFreight';
import { cartonizeCartLine } from './stCourierCartFreight';

export const LOGISTICS_ENTRY_STATE_KEY = 'logisticsEntry';
/** Open logistics detail for an existing booking id (location.state). */
export const LOGISTICS_OPEN_BOOKING_STATE_KEY = 'logisticsOpenBookingId';

/** Categories that never get courier booking from the invoice detail. */
const COURIER_BLOCKED_INVOICE_CATEGORIES: ReadonlySet<InvoiceCategory> = new Set([
  'software_key',
  'gatc',
]);

/** Default when invoice has no recognizable freight partner (only ST is live today). */
const DEFAULT_INVOICE_COURIER_PARTNER: LogisticsPartnerId = 'st_courier';

export interface LogisticsEntryState {
  draftPatch: Partial<LogisticsBookingDraft>;
  dealerQuery?: string;
}

export type BuildInvoiceBookingDraftOptions = {
  /** Catalog lookup for packageInfo → auto boxes. */
  productsById?: Map<string, CatalogProduct>;
  shipFromSite?: StaffLogisticsSite | null;
  /** Override partner; otherwise inferred from freight line / ST default. */
  partnerId?: LogisticsPartnerId;
};

export function logisticsPathForRole(role: Role): string {
  return `${homePathForRole(role)}/logistics`;
}

function invoiceCalendarDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/**
 * Book Courier is available only for recent product/spare/service invoices.
 * Hidden when the invoice is older than 4 days, or category is software / GATC.
 */
export function canBookCourierForInvoice(
  invoice: Pick<DealerInvoiceDetail, 'date' | 'invoiceCategory'>,
): boolean {
  const category = invoice.invoiceCategory ?? null;
  if (category && COURIER_BLOCKED_INVOICE_CATEGORIES.has(category)) {
    return false;
  }

  const dateRaw = invoice.date?.trim();
  if (!dateRaw) return true;

  const invoiceDay = invoiceCalendarDay(dateRaw);
  if (!invoiceDay) return true;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ageDays = (today.getTime() - invoiceDay.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays <= 4;
}

export function navigateToLogisticsBooking(
  navigate: NavigateFunction,
  role: Role,
  entry: LogisticsEntryState,
): void {
  navigate(logisticsPathForRole(role), {
    state: { [LOGISTICS_ENTRY_STATE_KEY]: entry },
  });
}

export function navigateToLogisticsBookingDetail(
  navigate: NavigateFunction,
  role: Role,
  bookingId: string,
): void {
  const id = bookingId.trim();
  if (!id) return;
  navigate(logisticsPathForRole(role), {
    state: { [LOGISTICS_OPEN_BOOKING_STATE_KEY]: id },
  });
}

/** Prefer freight-line partner (e.g. STFRC → st_courier); fall back to ST. */
export function resolveInvoiceCourierPartnerId(
  invoice: Pick<DealerInvoiceDetail, 'lineItems'>,
): LogisticsPartnerId {
  for (const line of invoice.lineItems ?? []) {
    if (!isFreightInvoiceLineItem(line)) continue;
    const partner = partnerIdForFreightSku(line.sku);
    if (partner && isPipelineEnabledPartner(partner)) return partner;
  }
  return DEFAULT_INVOICE_COURIER_PARTNER;
}

/** Cartonize non-freight invoice lines into booking boxes (dims + weight). */
export function buildInvoiceBookingBoxes(
  invoice: Pick<DealerInvoiceDetail, 'lineItems'>,
  productsById: Map<string, CatalogProduct>,
): ShipmentBoxDraft[] {
  const boxes: ShipmentBoxDraft[] = [];
  for (const line of invoice.lineItems ?? []) {
    if (isFreightInvoiceLineItem(line)) continue;
    const productId = String(line.itemId ?? '').trim();
    if (!productId) continue;
    const product = productsById.get(productId);
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const { parcels } = cartonizeCartLine({
      productId,
      name: line.name,
      sku: line.sku,
      quantity: qty,
      categoryId: product?.categoryId,
      categoryName: product?.categoryName,
      packageInfo: product?.packageInfo ?? null,
    });
    for (const parcel of parcels) {
      const draft = emptyShipmentBoxDraft();
      boxes.push({
        ...draft,
        lengthCm: parcel.dims.lengthCm != null ? String(parcel.dims.lengthCm) : '',
        widthCm: parcel.dims.widthCm != null ? String(parcel.dims.widthCm) : '',
        heightCm: parcel.dims.heightCm != null ? String(parcel.dims.heightCm) : '',
        weightKg: Number.isFinite(parcel.actualKg) ? String(parcel.actualKg) : '',
      });
    }
  }
  return boxes;
}

export function buildInvoiceBookingDraftPatch(
  invoice: DealerInvoiceDetail,
  invoiceId: string,
  zohoCustomerId: string,
  dealerId: string,
  options?: BuildInvoiceBookingDraftOptions,
): Partial<LogisticsBookingDraft> {
  const partnerId = options?.partnerId ?? resolveInvoiceCourierPartnerId(invoice);
  const boxes = options?.productsById
    ? buildInvoiceBookingBoxes(invoice, options.productsById)
    : undefined;
  const shipFromSite = options?.shipFromSite && (
    options.shipFromSite === 'cochin' || options.shipFromSite === 'head_office'
  )
    ? options.shipFromSite
    : undefined;

  return {
    source: 'invoice',
    invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    supportRequestId: null,
    supportRequestNumber: null,
    zohoCustomerId,
    dealerId,
    partnerId,
    ...(shipFromSite ? { shipFromSite } : {}),
    ...(boxes && boxes.length > 0 ? { boxes } : {}),
  };
}

export function buildSupportBookingDraftPatch(
  request: DealerSupportRequest,
): Partial<LogisticsBookingDraft> {
  const zohoCustomerId = request.zohoCustomerId?.trim() || request.dealerId;
  const dealerId = request.zohoCustomerId
    && request.dealerId !== request.zohoCustomerId
    ? request.dealerId
    : zohoCustomerId;

  return {
    source: 'support',
    invoiceId: request.invoiceId,
    invoiceNumber: request.invoiceNumber,
    supportRequestId: request.id,
    supportRequestNumber: request.requestNumber,
    zohoCustomerId,
    dealerId,
  };
}
