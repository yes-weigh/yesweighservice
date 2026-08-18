import type { NavigateFunction } from 'react-router-dom';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { CatalogProduct } from '../types/catalog';
import type { DealerSupportRequest } from '../types/dealer-support';
import type { DealerInvoiceDetail } from '../types/invoices';
import type { Role } from '../types';
import { homePathForRole } from '../types';
import type {
  LogisticsBookingDraft,
  LogisticsFreightBillingMode,
  ShipmentBoxDraft,
} from '../types/logistics-dispatch';
import type { StaffLogisticsSite } from '../types/staff-logistics';
import { invoiceHasNoCourierFreightLine, isFreightInvoiceLineItem } from './invoices';
import { invoiceAllowsLogisticsFulfillment } from './invoiceListStatus';
import {
  emptyShipmentBoxDraft,
  isPipelineEnabledPartner,
} from './logisticsBooking';
import { partnerIdForFreightSku } from './orderFreight';
import { cartonizeCartLine } from './stCourierCartFreight';

export const LOGISTICS_ENTRY_STATE_KEY = 'logisticsEntry';
/** Open logistics detail for an existing booking id (location.state). */
export const LOGISTICS_OPEN_BOOKING_STATE_KEY = 'logisticsOpenBookingId';

/** Default when invoice has no recognizable freight partner (only ST is live today). */
const DEFAULT_INVOICE_COURIER_PARTNER: LogisticsPartnerId = 'st_courier';

export interface LogisticsEntryState {
  draftPatch: Partial<LogisticsBookingDraft>;
  dealerQuery?: string;
  /**
   * When true, skip the partner picker and open Book Courier with draftPatch.partnerId.
   * False when invoice has no freight-derived partner so ops can choose.
   */
  lockPartner?: boolean;
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
 * Book Courier is available only for recent product/spare invoices that have a
 * courier freight line. Hidden for software / stamping / service-only, pickup
 * (no freight), or invoices older than 4 days.
 */
export function canBookCourierForInvoice(
  invoice: Pick<
    DealerInvoiceDetail,
    'date' | 'invoiceCategory' | 'categories' | 'sourceSalesOrderIsPickup'
  > & {
    lineItems?: DealerInvoiceDetail['lineItems'] | null;
  },
): boolean {
  if (invoice.sourceSalesOrderIsPickup) return false;
  if (invoiceHasNoCourierFreightLine(invoice)) return false;
  if (!invoiceAllowsLogisticsFulfillment(invoice)) return false;

  const dateRaw = invoice.date?.trim();
  if (!dateRaw) return true;

  const invoiceDay = invoiceCalendarDay(dateRaw);
  if (!invoiceDay) return true;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ageDays = (today.getTime() - invoiceDay.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays <= 4;
}

/**
 * Record an existing LR on an invoice (any age) — skips the full Book Courier wizard.
 * Same freight-line eligibility as Book Courier.
 */
export function canRecordInvoiceLogisticsLr(
  invoice: Pick<
    DealerInvoiceDetail,
    'invoiceCategory' | 'categories' | 'sourceSalesOrderIsPickup'
  > & {
    lineItems?: DealerInvoiceDetail['lineItems'] | null;
  },
): boolean {
  if (invoice.sourceSalesOrderIsPickup) return false;
  if (invoiceHasNoCourierFreightLine(invoice)) return false;
  return invoiceAllowsLogisticsFulfillment(invoice);
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
export function resolveInvoiceCourierPartner(
  invoice: Pick<DealerInvoiceDetail, 'lineItems' | 'yesOneFreightPartner'>,
): { partnerId: LogisticsPartnerId; fromFreight: boolean } {
  const override = String(invoice.yesOneFreightPartner?.partnerId ?? '').trim();
  if (override && isPipelineEnabledPartner(override)) {
    return { partnerId: override as LogisticsPartnerId, fromFreight: true };
  }
  const overrideSku = partnerIdForFreightSku(invoice.yesOneFreightPartner?.sku);
  if (overrideSku && isPipelineEnabledPartner(overrideSku)) {
    return { partnerId: overrideSku, fromFreight: true };
  }
  for (const line of invoice.lineItems ?? []) {
    if (!isFreightInvoiceLineItem(line)) continue;
    const partner = partnerIdForFreightSku(line.sku);
    if (partner && isPipelineEnabledPartner(partner)) {
      return { partnerId: partner, fromFreight: true };
    }
  }
  return { partnerId: DEFAULT_INVOICE_COURIER_PARTNER, fromFreight: false };
}

/** Prefer freight-line partner (e.g. STFRC → st_courier); fall back to ST. */
export function resolveInvoiceCourierPartnerId(
  invoice: Pick<DealerInvoiceDetail, 'lineItems' | 'yesOneFreightPartner'>,
): LogisticsPartnerId {
  return resolveInvoiceCourierPartner(invoice).partnerId;
}

/**
 * Delhivery FOD when the Delhivery freight line is present at ₹0;
 * otherwise BTC when Delhivery freight is charged.
 */
export function resolveInvoiceFreightBillingMode(
  invoice: Pick<DealerInvoiceDetail, 'lineItems'>,
): 'fod' | 'btc' | null {
  for (const line of invoice.lineItems ?? []) {
    if (!isFreightInvoiceLineItem(line)) continue;
    const partner = partnerIdForFreightSku(line.sku);
    if (partner !== 'delhivery') continue;
    const rate = Number(line.rate);
    const total = Number(line.total);
    const amount = Number.isFinite(rate) ? rate : total;
    if (Number.isFinite(amount) && amount <= 0) return 'fod';
    return 'btc';
  }
  return null;
}

/** Delhivery BTC/FOD for invoice-linked bookings — always from the freight line. */
export function resolveDelhiveryFreightBillingModeFromInvoice(
  invoice: Pick<DealerInvoiceDetail, 'lineItems'> | null | undefined,
): LogisticsFreightBillingMode {
  return resolveInvoiceFreightBillingMode(invoice ?? { lineItems: [] }) || 'btc';
}

/** Invoice-linked Delhivery or any booking after LR creation — mode cannot change. */
export function isDelhiveryFreightBillingModeLocked(booking: {
  partnerId: string;
  invoiceId?: string | null;
  consignmentNo?: string | null;
}): boolean {
  if (booking.partnerId !== 'delhivery') return false;
  if (booking.invoiceId?.trim()) return true;
  if (booking.consignmentNo?.trim()) return true;
  return false;
}

export function delhiveryFreightBillingLockLabel(booking: {
  partnerId: string;
  invoiceId?: string | null;
  consignmentNo?: string | null;
}): string | null {
  if (!isDelhiveryFreightBillingModeLocked(booking)) return null;
  if (booking.invoiceId?.trim()) return 'locked (from invoice freight line)';
  if (booking.consignmentNo?.trim()) return 'locked (LR created)';
  return 'locked';
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

  const invoiceValue = Number(invoice.total);
  const salesOrderNumber = invoice.salesOrderNumber?.trim() || null;
  const customerGstin = invoice.customerGstin?.trim() || null;
  const customerPhone = invoice.customerPhone?.trim() || null;
  const freightBillingMode = partnerId === 'delhivery'
    ? (resolveInvoiceFreightBillingMode(invoice) || 'btc')
    : null;
  const deliveryAddress = invoice.shippingAddress?.trim() || null;

  return {
    source: 'invoice',
    invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    salesOrderNumber,
    invoiceValueInr: Number.isFinite(invoiceValue) && invoiceValue > 0 ? invoiceValue : null,
    customerGstin,
    customerPhone,
    supportRequestId: null,
    supportRequestNumber: null,
    zohoCustomerId,
    dealerId,
    partnerId,
    ...(deliveryAddress ? { deliveryAddress } : {}),
    ...(freightBillingMode ? { freightBillingMode } : {}),
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
