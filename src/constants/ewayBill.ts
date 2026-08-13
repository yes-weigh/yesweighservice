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

export function clubbedInvoiceTotalInr(
  invoices: ReadonlyArray<{ valueInr?: number | null } | null | undefined>,
): number {
  return invoices.reduce((sum, row) => {
    const value = Number(row?.valueInr);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
}

export function clubbedNeedsEwayBill(
  invoicesOrTotal: ReadonlyArray<{ valueInr?: number | null } | null | undefined> | number,
): boolean {
  const total = typeof invoicesOrTotal === 'number'
    ? invoicesOrTotal
    : clubbedInvoiceTotalInr(invoicesOrTotal);
  return isEwayBillRequired(total);
}

export function bookingLinkedInvoiceIds(booking: {
  invoiceId?: string | null;
  invoiceIds?: string[] | null;
  invoices?: ReadonlyArray<{ invoiceId?: string | null }> | null;
}): string[] {
  const ids = [
    ...(booking.invoiceIds ?? []),
    ...(booking.invoices ?? []).map(row => row.invoiceId),
    booking.invoiceId,
  ];
  return [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))];
}

export function bookingNeedsEwayBill(
  booking: {
    invoiceId?: string | null;
    invoiceIds?: string[] | null;
    invoices?: ReadonlyArray<{ invoiceId?: string | null; valueInr?: number | null; ewayRequired?: boolean }> | null;
    invoiceValueInr?: number | null;
  },
  invoiceTotalInclGstInr?: number | null,
): boolean {
  if (!bookingLinkedInvoiceIds(booking).length) return false;
  if (booking.invoices?.some(row => row.ewayRequired === true)) return true;
  const clubbed = clubbedInvoiceTotalInr(booking.invoices ?? []);
  if (clubbed > 0) return isEwayBillRequired(clubbed);
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
    invoiceIds?: string[] | null;
    invoices?: ReadonlyArray<{ invoiceId?: string | null; valueInr?: number | null; ewayRequired?: boolean }> | null;
    invoiceValueInr?: number | null;
  },
  options?: { invoiceTotalInclGst?: number | null },
): EwayBillListChip | null {
  if (!bookingNeedsEwayBill(booking, options?.invoiceTotalInclGst)) return null;

  if (booking.ewayBillStatus === 'generated') {
    return {
      tone: 'done',
      label: 'EWB',
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

export function clubbedEwayBillRequiredLabel(input: {
  invoiceCount: number;
  clubbedTotalInr: unknown;
}): string {
  const total = Number(input.clubbedTotalInr);
  const count = Math.max(1, input.invoiceCount);
  if (!isEwayBillRequired(total)) {
    return `Not required — clubbed total incl. GST is ₹${EWAY_BILL_THRESHOLD_INR.toLocaleString('en-IN')} or below.`;
  }
  if (count <= 1) {
    return 'Required — invoice total incl. GST exceeds ₹50,000.';
  }
  return `Required — clubbed total exceeds ₹50,000. Generate ${count} e-way bills (one per invoice).`;
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
