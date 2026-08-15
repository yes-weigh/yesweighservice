import {
  clubbedInvoiceTotalInr,
  clubbedNeedsEwayBill,
  invoiceTotalInclGst,
} from '../constants/ewayBill';
import type { CatalogProduct } from '../types/catalog';
import type { DealerInvoiceDetail } from '../types/invoices';
import type {
  LogisticsBookingDraft,
  LogisticsBookingInvoice,
  LogisticsFreightBillingMode,
  ShipmentBoxDraft,
} from '../types/logistics-dispatch';
import { fetchAdminInvoiceDetail, fetchAdminInvoicesForCustomers } from './admin-invoices';
import { isInvoiceCustomerPickup } from './invoiceCustomerPickup';
import { isFreightInvoiceLineItem } from './invoices';
import {
  buildInvoiceBookingBoxes,
  canBookCourierForInvoice,
  resolveInvoiceCourierPartner,
  resolveInvoiceFreightBillingMode,
} from './logisticsPrefill';
import { partnerIdForFreightSku } from './orderFreight';

const CLUB_LOOKBACK_DAYS = 10;

export type ClubbableDelhiveryInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  date: string | null;
  valueInr: number;
  freightBillingMode: LogisticsFreightBillingMode;
  gstin: string;
  pincode: string;
  detail: DealerInvoiceDetail;
};

function pincodeFromAddress(address: string | null | undefined): string {
  const match = /\b(\d{6})\b/.exec(String(address ?? ''));
  return match?.[1] ?? '';
}

function isoDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function invoiceHasDelhiveryFreightLine(
  invoice: Pick<DealerInvoiceDetail, 'lineItems'>,
): boolean {
  return (invoice.lineItems ?? []).some((line) => {
    if (!isFreightInvoiceLineItem(line)) return false;
    return partnerIdForFreightSku(line.sku) === 'delhivery';
  });
}

export function clubKeyFromInvoice(
  invoice: Pick<DealerInvoiceDetail, 'customerGstin' | 'shippingAddress' | 'billingAddress'>,
): { gstin: string; pincode: string } {
  const gstin = String(invoice.customerGstin ?? '').replace(/\s/g, '').toUpperCase();
  const pincode = pincodeFromAddress(invoice.shippingAddress)
    || pincodeFromAddress(invoice.billingAddress);
  return { gstin, pincode };
}

export function clubbedFreightBillingMode(
  invoices: ReadonlyArray<Pick<DealerInvoiceDetail, 'lineItems'>>,
): LogisticsFreightBillingMode {
  for (const invoice of invoices) {
    if (resolveInvoiceFreightBillingMode(invoice) === 'btc') return 'btc';
  }
  return 'fod';
}

export function mapInvoiceToClubbedRow(invoice: DealerInvoiceDetail): LogisticsBookingInvoice {
  const valueInr = invoiceTotalInclGst(invoice) ?? Number(invoice.total) ?? 0;
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber?.trim() || invoice.id,
    valueInr: Number.isFinite(valueInr) && valueInr > 0 ? valueInr : 0,
  };
}

export function normalizeDraftClubbedInvoices(
  draft: Pick<LogisticsBookingDraft, 'invoiceId' | 'invoiceNumber' | 'invoiceValueInr' | 'clubbedInvoices'>,
): LogisticsBookingInvoice[] {
  const fromDraft = (draft.clubbedInvoices ?? [])
    .map((row) => ({
      invoiceId: String(row.invoiceId || '').trim(),
      invoiceNumber: String(row.invoiceNumber || '').trim(),
      valueInr: Number(row.valueInr) || 0,
      ewayBillNumber: row.ewayBillNumber ?? null,
      ewayBillStatus: row.ewayBillStatus ?? null,
      ewayRequired: row.ewayRequired,
    }))
    .filter(row => row.invoiceId);
  if (fromDraft.length) {
    const seen = new Set<string>();
    return fromDraft.filter((row) => {
      if (seen.has(row.invoiceId)) return false;
      seen.add(row.invoiceId);
      return true;
    });
  }
  const primaryId = String(draft.invoiceId || '').trim();
  if (!primaryId) return [];
  return [{
    invoiceId: primaryId,
    invoiceNumber: String(draft.invoiceNumber || '').trim() || primaryId,
    valueInr: Number(draft.invoiceValueInr) || 0,
  }];
}

/** How many invoices share this LR. >1 means a clubbed booking. */
export function clubbedInvoiceCount(booking: {
  invoiceId?: string | null;
  invoiceIds?: readonly string[] | null;
  invoices?: ReadonlyArray<{ invoiceId?: string | null }> | null;
}): number {
  const ids = [
    ...(booking.invoiceIds ?? []),
    ...(booking.invoices ?? []).map(row => row.invoiceId),
    booking.invoiceId,
  ]
    .map(id => String(id ?? '').trim())
    .filter(Boolean);
  return new Set(ids).size;
}

export function persistClubbedInvoiceFields(
  draft: Pick<LogisticsBookingDraft, 'invoiceId' | 'invoiceNumber' | 'invoiceValueInr' | 'clubbedInvoices'>,
): {
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceIds: string[];
  invoices: LogisticsBookingInvoice[];
  invoiceValueInr?: number;
  ewayBillStatus?: string;
} {
  const invoices = normalizeDraftClubbedInvoices(draft);
  const sum = clubbedInvoiceTotalInr(invoices);
  const needsEway = clubbedNeedsEwayBill(sum);
  const withEway = invoices.map(row => ({
    ...row,
    ewayRequired: needsEway,
    ewayBillStatus: row.ewayBillStatus
      ?? (needsEway ? 'missing' : 'not_required'),
  }));
  return {
    invoiceId: draft.invoiceId?.trim() || withEway[0]?.invoiceId || null,
    invoiceNumber: draft.invoiceNumber?.trim() || withEway[0]?.invoiceNumber || null,
    invoiceIds: withEway.map(row => row.invoiceId),
    invoices: withEway,
    ...(sum > 0 ? { invoiceValueInr: sum } : {}),
    ...(needsEway ? { ewayBillStatus: 'missing' } : {}),
  };
}

export function mergeClubbedBookingBoxes(
  invoices: readonly DealerInvoiceDetail[],
  productsById: Map<string, CatalogProduct>,
): ShipmentBoxDraft[] {
  const boxes: ShipmentBoxDraft[] = [];
  for (const invoice of invoices) {
    boxes.push(...buildInvoiceBookingBoxes(invoice, productsById));
  }
  return boxes;
}

export async function listClubbableDelhiveryInvoices(input: {
  customerId: string;
  primaryInvoiceId: string;
  primary: DealerInvoiceDetail;
}): Promise<ClubbableDelhiveryInvoice[]> {
  const customerId = input.customerId.trim();
  const primaryId = input.primaryInvoiceId.trim();
  if (!customerId || !primaryId) return [];

  const primaryPartner = resolveInvoiceCourierPartner(input.primary);
  if (primaryPartner.partnerId !== 'delhivery' && !invoiceHasDelhiveryFreightLine(input.primary)) {
    return [];
  }
  const primaryKey = clubKeyFromInvoice(input.primary);
  if (!primaryKey.gstin || !primaryKey.pincode) return [];

  const rows = await fetchAdminInvoicesForCustomers({
    customerIds: [customerId],
    dateStart: isoDateDaysAgo(CLUB_LOOKBACK_DAYS),
  });

  const candidates = rows.filter((row) => {
    if (row.id === primaryId) return false;
    if (isInvoiceCustomerPickup(row)) return false;
    return canBookCourierForInvoice(row);
  });

  const details = await Promise.all(candidates.map(async (row) => {
    try {
      return await fetchAdminInvoiceDetail(customerId, row.id);
    } catch {
      return null;
    }
  }));

  const clubbable: ClubbableDelhiveryInvoice[] = [];
  for (const detail of details) {
    if (!detail) continue;
    if (isInvoiceCustomerPickup(detail)) continue;
    if (!canBookCourierForInvoice(detail)) continue;
    if (!invoiceHasDelhiveryFreightLine(detail)) continue;
    const key = clubKeyFromInvoice(detail);
    if (key.gstin !== primaryKey.gstin || key.pincode !== primaryKey.pincode) continue;
    const valueInr = invoiceTotalInclGst(detail) ?? Number(detail.total) ?? 0;
    clubbable.push({
      invoiceId: detail.id,
      invoiceNumber: detail.invoiceNumber?.trim() || detail.id,
      date: detail.date,
      valueInr: Number.isFinite(valueInr) && valueInr > 0 ? valueInr : 0,
      freightBillingMode: resolveInvoiceFreightBillingMode(detail) || 'fod',
      gstin: key.gstin,
      pincode: key.pincode,
      detail,
    });
  }

  clubbable.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  return clubbable;
}
