import { isInvoiceCustomerPickup } from './invoiceCustomerPickup';
import { invoiceListLogisticsStatus } from './logisticsBooking';
import type { LogisticsBooking } from '../types/logistics-dispatch';

const ZOHO_TO_DISPATCH = new Set(['draft', 'sent', 'viewed']);

function statusKey(status: unknown): string {
  return String(status ?? 'draft').trim().toLowerCase().replace(/\s+/g, '_');
}

export const INVOICE_LIST_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially paid',
  overdue: 'Overdue',
  paid: 'Paid',
  to_dispatch: 'To dispatch',
  in_transit: 'In transit',
  delivered: 'Delivered',
  customer_pickup: 'Customer pickup',
  returned: 'Returned',
  void: 'Void',
  cancelled: 'Cancelled',
};

/** List badge / filter key: pickup → logistics past Booked → Zoho payment status. */
export function invoiceListStatusKey(
  invoice: { status?: unknown; customerPickup?: unknown },
  booking?: Pick<LogisticsBooking, 'status' | 'wizardStep'> | null,
): string {
  if (isInvoiceCustomerPickup(invoice)) return 'customer_pickup';
  const logistics = invoiceListLogisticsStatus(booking);
  if (logistics) {
    if (logistics.status === 'in_transit') return 'in_transit';
    if (logistics.status === 'delivered') return 'delivered';
    if (logistics.status === 'returned') return 'returned';
    if (logistics.status === 'cancelled') return 'cancelled';
    return logistics.status;
  }
  const zoho = statusKey(invoice.status);
  if (ZOHO_TO_DISPATCH.has(zoho)) return 'to_dispatch';
  return zoho;
}

export function invoiceListStatusLabel(key: string): string {
  return INVOICE_LIST_STATUS_LABELS[key]
    ?? key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}
