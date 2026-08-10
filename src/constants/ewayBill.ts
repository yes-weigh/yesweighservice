/** GST rule: e-way bill required when invoice grand total (incl. GST) exceeds this (INR). */
export const EWAY_BILL_THRESHOLD_INR = 50_000;

/** Invoice grand total including GST (Zoho `total`, or subtotal + tax). */
export function invoiceTotalInclGst(input: {
  total?: unknown;
  subtotal?: unknown;
  taxTotal?: unknown;
} | null | undefined): number | null {
  const total = Number(input?.total);
  if (Number.isFinite(total) && total > 0) return total;
  const subtotal = Number(input?.subtotal);
  const taxTotal = Number(input?.taxTotal);
  if (Number.isFinite(subtotal) && Number.isFinite(taxTotal) && subtotal + taxTotal > 0) {
    return subtotal + taxTotal;
  }
  return null;
}

export function isEwayBillRequired(invoiceTotalInclGstInr: unknown): boolean {
  const total = Number(invoiceTotalInclGstInr);
  return Number.isFinite(total) && total > EWAY_BILL_THRESHOLD_INR;
}

export function resolveEwayBillInvoiceTotal(
  booking: { invoiceValueInr?: number | null },
  invoice?: { total?: unknown; subtotal?: unknown; taxTotal?: unknown } | null,
): number | null {
  const fromInvoice = invoiceTotalInclGst(invoice);
  if (fromInvoice != null) return fromInvoice;
  const fromBooking = Number(booking.invoiceValueInr);
  return Number.isFinite(fromBooking) && fromBooking > 0 ? fromBooking : null;
}

export function bookingNeedsEwayBill(
  booking: {
    invoiceId?: string | null;
    invoiceValueInr?: number | null;
  },
  invoiceTotalInclGstInr?: number | null,
): boolean {
  if (!booking.invoiceId?.trim()) return false;
  const total = invoiceTotalInclGstInr ?? resolveEwayBillInvoiceTotal(booking);
  return isEwayBillRequired(total);
}

export type EwayBillListChip = {
  tone: 'done' | 'cancelled' | 'missing';
  label: string;
};

/** Chip on logistics list tiles when an e-way bill is required for the linked invoice. */
export function ewayBillListChip(
  booking: {
    ewayBillStatus?: string | null;
    ewayBillNumber?: string | null;
    invoiceId?: string | null;
    invoiceValueInr?: number | null;
  },
  options?: { invoiceTotalInclGst?: number | null },
): EwayBillListChip | null {
  if (!bookingNeedsEwayBill(booking, options?.invoiceTotalInclGst)) return null;

  if (booking.ewayBillStatus === 'generated') {
    return {
      tone: 'done',
      label: `EWB ${booking.ewayBillNumber?.trim() || 'ready'}`,
    };
  }
  if (booking.ewayBillStatus === 'cancelled') {
    return { tone: 'cancelled', label: 'EWB cancelled' };
  }
  return { tone: 'missing', label: 'No e-way bill' };
}

export function ewayBillRequiredLabel(totalInr: unknown): string {
  if (!isEwayBillRequired(totalInr)) {
    return `Not required — invoice total incl. GST is ₹${EWAY_BILL_THRESHOLD_INR.toLocaleString('en-IN')} or below.`;
  }
  return 'Required — invoice total incl. GST exceeds ₹50,000.';
}

export const EWAY_BILL_CANCEL_REASONS = [
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'order_cancelled', label: 'Order cancelled' },
  { id: 'data_entry_mistake', label: 'Data entry mistake' },
  { id: 'others', label: 'Others' },
] as const;

export type EwayBillCancelReason = typeof EWAY_BILL_CANCEL_REASONS[number]['id'];

export function isEwayBillCancelReason(value: unknown): value is EwayBillCancelReason {
  return typeof value === 'string'
    && EWAY_BILL_CANCEL_REASONS.some(option => option.id === value);
}
