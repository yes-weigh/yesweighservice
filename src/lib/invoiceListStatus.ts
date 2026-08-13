import { invoiceListLogisticsStatus } from './logisticsBooking';
import { invoiceCategoriesForDisplay } from './invoices';
import type { InvoiceCategory } from '../types/invoices';
import type { LogisticsBooking } from '../types/logistics-dispatch';

export const INVOICE_LIST_STATUS_LABELS: Record<string, string> = {
  to_dispatch: 'To dispatch',
  in_transit: 'In transit',
  delivered: 'Delivered',
  customer_pickup: 'Customer pickup',
  returned: 'Returned',
  void: 'Void',
  support: 'Support',
  cancelled: 'Cancelled',
};

/** SO freight lines attach to product/spare only — never software, GATC, or service-only. */
const LOGISTICS_FREIGHT_CATEGORIES: ReadonlySet<InvoiceCategory> = new Set([
  'product',
  'spare',
]);

const LOGISTICS_FILTER_KEYS = new Set([
  'to_dispatch',
  'in_transit',
  'delivered',
  'returned',
  'void',
]);

export type InvoiceListStatusInvoice = {
  status?: unknown;
  customerPickup?: { markedAt?: string | null } | null;
  categories?: unknown;
  invoiceCategory?: unknown;
};

/**
 * True when this invoice can have a freight line / warehouse dispatch
 * (product or spare). Software keys, stamping, and service-only docs are not.
 */
export function invoiceAllowsLogisticsFulfillment(
  invoice: Pick<InvoiceListStatusInvoice, 'categories' | 'invoiceCategory'> | null | undefined,
): boolean {
  const categories = invoiceCategoriesForDisplay(invoice);
  if (!categories.length) return true;
  return categories.some(category => LOGISTICS_FREIGHT_CATEGORIES.has(category));
}

/**
 * List badge key.
 * Pickup stays distinct; cancelled AWB returns to to-dispatch;
 * software / GATC / service-only keep Zoho status instead of To dispatch.
 */
export function invoiceListStatusKey(
  invoice: InvoiceListStatusInvoice,
  booking?: Pick<LogisticsBooking, 'status' | 'wizardStep'> | null,
): string {
  if (String(invoice.customerPickup?.markedAt ?? '').trim()) return 'customer_pickup';

  const logistics = invoiceListLogisticsStatus(booking);
  if (logistics) {
    if (logistics.status === 'cancelled') return 'to_dispatch';
    if (logistics.status === 'in_transit') return 'in_transit';
    if (logistics.status === 'delivered') return 'delivered';
    if (logistics.status === 'returned') return 'returned';
    return logistics.status;
  }

  const zoho = String(invoice.status ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (zoho === 'void') return 'void';
  if (invoiceAllowsLogisticsFulfillment(invoice)) return 'to_dispatch';
  return zoho || 'sent';
}

/**
 * Chip key: pickup → Delivered; non-logistics invoices omit dispatch chips
 * (they still appear in All, Support, and Void).
 */
export function invoiceListFilterStatusKey(
  invoice: InvoiceListStatusInvoice,
  booking?: Pick<LogisticsBooking, 'status' | 'wizardStep'> | null,
): string | null {
  const key = invoiceListStatusKey(invoice, booking);
  if (key === 'customer_pickup') return 'delivered';
  if (key === 'void') return 'void';
  if (LOGISTICS_FILTER_KEYS.has(key)) return key;
  return null;
}

export function invoiceListStatusLabel(key: string): string {
  return INVOICE_LIST_STATUS_LABELS[key]
    ?? key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}
