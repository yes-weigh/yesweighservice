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

/** Ready when a bill number exists, or Zoho/GST status is generated (incl. part_a_generated). */
export function ewayBillIsReady(
  status?: string | null,
  ewaybillNumber?: string | null,
): boolean {
  if (String(ewaybillNumber || '').trim()) return true;
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'generated' || normalized.includes('generated');
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

export function bookingInvoiceEwayRow(
  booking: {
    invoiceId?: string | null;
    ewayBillNumber?: string | null;
    ewayBillStatus?: string | null;
    invoices?: ReadonlyArray<{
      invoiceId?: string | null;
      ewayBillNumber?: string | null;
      ewayBillStatus?: string | null;
      ewayRequired?: boolean;
    }> | null;
  } | null | undefined,
  invoiceId: string,
): { ewayBillNumber: string | null; ewayBillStatus: string | null; ewayRequired: boolean } | null {
  const id = String(invoiceId || '').trim();
  if (!id || !booking) return null;
  const row = (booking.invoices ?? []).find(item => String(item.invoiceId || '').trim() === id);
  if (row) {
    return {
      ewayBillNumber: row.ewayBillNumber ?? null,
      ewayBillStatus: row.ewayBillStatus ?? null,
      ewayRequired: row.ewayRequired === true,
    };
  }
  if (String(booking.invoiceId || '').trim() !== id) return null;
  return {
    ewayBillNumber: booking.ewayBillNumber ?? null,
    ewayBillStatus: booking.ewayBillStatus ?? null,
    ewayRequired: bookingNeedsEwayBill(booking),
  };
}

/** Show the e-way bill card on an invoice when pickup, clubbed LR, or a stored e-way requires it. */
export function invoiceNeedsEwayBillCard(input: {
  invoice?: {
    total?: unknown;
    subtotal?: unknown;
    taxTotal?: unknown;
    ewayBill?: {
      required?: boolean;
      requiredBecause?: string | null;
      status?: string | null;
      ewaybillNumber?: string | null;
    } | null;
  } | null;
  booking?: Parameters<typeof bookingNeedsEwayBill>[0] | null;
  customerPickup?: boolean;
}): boolean {
  const invoice = input.invoice;
  if (!invoice) return false;
  const existing = invoice.ewayBill;
  if (ewayBillIsReady(existing?.status, existing?.ewaybillNumber)) return true;
  if (existing?.required === true || existing?.requiredBecause === 'clubbed_lr') return true;
  if (input.booking && bookingNeedsEwayBill(input.booking, invoiceTotalInclGst(invoice))) return true;
  if (input.customerPickup) return isEwayBillRequired(invoiceTotalInclGst(invoice));
  return false;
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
  tone: 'done' | 'cancelled' | 'missing' | 'pending';
  label: string;
  lines?: readonly string[];
  title?: string;
};

/** Chip on logistics list tiles when an e-way bill is required for the linked invoice. */
export function ewayBillListChip(
  booking: {
    partnerId?: string | null;
    ewayBillStatus?: string | null;
    ewayBillNumber?: string | null;
    invoiceId?: string | null;
    invoiceIds?: string[] | null;
    invoices?: ReadonlyArray<{ invoiceId?: string | null; valueInr?: number | null; ewayRequired?: boolean }> | null;
    invoiceValueInr?: number | null;
    delhiveryEwaySync?: { ok?: boolean } | null;
  },
  options?: { invoiceTotalInclGst?: number | null },
): EwayBillListChip | null {
  if (!bookingNeedsEwayBill(booking, options?.invoiceTotalInclGst)) return null;

  if (booking.ewayBillStatus === 'cancelled') {
    return { tone: 'cancelled', label: 'EWB cancelled', lines: ['EWB', 'cancelled'] };
  }
  if (ewayBillIsReady(booking.ewayBillStatus, booking.ewayBillNumber)) {
    if (booking.partnerId === 'delhivery') {
      if (booking.delhiveryEwaySync?.ok === true) {
        return {
          tone: 'done',
          label: 'E-way updated',
          lines: ['E-way', 'updated'],
          title: 'E-way bills updated to partner',
        };
      }
      return {
        tone: 'pending',
        label: 'E-way not updated',
        lines: ['E-way', 'not updated'],
        title: 'E-way bills are generated but not yet pushed to Delhivery',
      };
    }
    return { tone: 'done', label: 'EWB' };
  }
  return { tone: 'missing', label: 'No e-way bill', lines: ['No', 'e-way bill'] };
}

/** EWB chip on invoice list tiles (clubbed LR, stored e-way, or pickup over threshold). */
export function invoiceListEwayChip(
  invoice: {
    id?: string;
    total?: unknown;
    subtotal?: unknown;
    taxTotal?: unknown;
    ewayBill?: {
      required?: boolean;
      requiredBecause?: string | null;
      status?: string | null;
      ewaybillNumber?: string | null;
    } | null;
    customerPickup?: { markedAt?: string | null } | null;
  } | null | undefined,
  booking?: Parameters<typeof ewayBillListChip>[0] | null,
): EwayBillListChip | null {
  const invoiceId = String(invoice?.id || '').trim();
  const total = invoiceTotalInclGst(invoice);
  const existing = invoice?.ewayBill;
  if (ewayBillIsReady(existing?.status, existing?.ewaybillNumber)) {
    return { tone: 'done', label: 'EWB' };
  }
  if (existing?.status === 'cancelled') {
    return { tone: 'cancelled', label: 'EWB cancelled' };
  }
  const row = booking && invoiceId ? bookingInvoiceEwayRow(booking, invoiceId) : null;
  if (ewayBillIsReady(row?.ewayBillStatus, row?.ewayBillNumber)) {
    return { tone: 'done', label: 'EWB' };
  }
  if (row?.ewayBillStatus === 'cancelled') {
    return { tone: 'cancelled', label: 'EWB cancelled' };
  }
  if (booking) {
    const fromBooking = ewayBillListChip(booking, { invoiceTotalInclGst: total });
    if (fromBooking?.tone === 'done' || fromBooking?.tone === 'cancelled') return fromBooking;
  }
  if (
    existing?.required === true
    || existing?.requiredBecause === 'clubbed_lr'
    || existing?.status === 'missing'
  ) {
    return { tone: 'missing', label: 'No e-way bill' };
  }
  if (booking) {
    const fromBooking = ewayBillListChip(booking, { invoiceTotalInclGst: total });
    if (fromBooking) return fromBooking;
  }
  if (String(invoice?.customerPickup?.markedAt || '').trim() && isEwayBillRequired(total)) {
    return { tone: 'missing', label: 'No e-way bill' };
  }
  return null;
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
