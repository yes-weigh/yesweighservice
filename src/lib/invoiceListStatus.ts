import { invoiceListLogisticsStatus } from './logisticsBooking';
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

/** List badge key: pickup stays distinct; unpaid/paid/draft/sent all wait as to-dispatch. */
export function invoiceListStatusKey(
  invoice: { status?: unknown; customerPickup?: { markedAt?: string | null } | null },
  booking?: Pick<LogisticsBooking, 'status' | 'wizardStep'> | null,
): string {
  if (String(invoice.customerPickup?.markedAt ?? '').trim()) return 'customer_pickup';
  const logistics = invoiceListLogisticsStatus(booking);
  if (logistics) {
    if (logistics.status === 'in_transit') return 'in_transit';
    if (logistics.status === 'delivered') return 'delivered';
    if (logistics.status === 'returned') return 'returned';
    if (logistics.status === 'cancelled') return 'cancelled';
    return logistics.status;
  }
  const zoho = String(invoice.status ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (zoho === 'void') return 'void';
  return 'to_dispatch';
}

/** Filter / chip key: customer pickup rolls into Delivered. */
export function invoiceListFilterStatusKey(
  invoice: { status?: unknown; customerPickup?: { markedAt?: string | null } | null },
  booking?: Pick<LogisticsBooking, 'status' | 'wizardStep'> | null,
): string {
  const key = invoiceListStatusKey(invoice, booking);
  return key === 'customer_pickup' ? 'delivered' : key;
}

export function invoiceListStatusLabel(key: string): string {
  return INVOICE_LIST_STATUS_LABELS[key]
    ?? key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}
