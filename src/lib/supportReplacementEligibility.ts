import type { DealerInvoice } from '../types/invoices';
import type { LogisticsBooking } from '../types/logistics-dispatch';

/** Dead-on-arrival / full product replacement window from the invoice date. */
export const PRODUCT_REPLACEMENT_WINDOW_DAYS = 10;

const IST = 'Asia/Kolkata';

export type ReceivingInvoice = Pick<DealerInvoice, 'id' | 'date'> & {
  customerPickup?: { markedAt?: string | null } | null;
  customerPickupMarkedAt?: string | null;
  manualDelivery?: { markedAt?: string | null } | null;
  manualDeliveredAt?: string | null;
  goodsReceivedAt?: string | null;
};

type ReceivingBooking = Pick<LogisticsBooking, 'status' | 'deliveredAt' | 'courierTrack'> | null | undefined;

function firstTimestamp(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text && text !== '[object Object]') return text;
  }
  return null;
}

function parseReceivingInstant(value: string | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso && !text.includes('T') && !text.includes(' ')) {
    const parsed = new Date(`${iso[0]}T12:00:00+05:30`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    let hours = dmy[4] != null ? Number(dmy[4]) : 12;
    const minutes = dmy[5] != null ? Number(dmy[5]) : 0;
    const seconds = dmy[6] != null ? Number(dmy[6]) : 0;
    const ampm = (dmy[7] || '').toLowerCase();
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    const stamp = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}+05:30`;
    const parsed = new Date(stamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Calendar YYYY-MM-DD in India time. */
export function calendarDateIst(value: string | Date): string | null {
  const date = parseReceivingInstant(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return next.toISOString().slice(0, 10);
}

function formatIstCalendarDate(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: IST,
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

export function invoiceWithReceivingFields(
  invoice: ReceivingInvoice,
  detail?: ReceivingInvoice | null,
): ReceivingInvoice {
  if (!detail) return invoice;
  return {
    ...invoice,
    customerPickup: invoice.customerPickup ?? detail.customerPickup,
    customerPickupMarkedAt: invoice.customerPickupMarkedAt ?? detail.customerPickupMarkedAt,
    manualDelivery: invoice.manualDelivery ?? detail.manualDelivery,
    manualDeliveredAt: invoice.manualDeliveredAt ?? detail.manualDeliveredAt,
    goodsReceivedAt: invoice.goodsReceivedAt ?? detail.goodsReceivedAt,
  };
}

/**
 * When the dealer actually received the goods: courier POD, ops delivered,
 * or customer pickup. Invoice date is not used.
 */
export function invoiceGoodsReceivedAtIso(
  invoice: ReceivingInvoice | null | undefined,
  booking?: ReceivingBooking,
): string | null {
  return firstTimestamp(
    invoice?.goodsReceivedAt,
    booking?.courierTrack?.deliveredAt,
    booking?.deliveredAt,
    invoice?.manualDelivery?.markedAt,
    invoice?.manualDeliveredAt,
    invoice?.customerPickup?.markedAt,
    invoice?.customerPickupMarkedAt,
  );
}

export function productReplacementDeadlineYmd(invoiceDateIso: string): string | null {
  const invoiceDay = calendarDateIst(invoiceDateIso);
  if (!invoiceDay) return null;
  return addCalendarDays(invoiceDay, PRODUCT_REPLACEMENT_WINDOW_DAYS);
}

export function isWithinProductReplacementWindow(
  invoiceDateIso: string,
  now: Date = new Date(),
): boolean {
  const today = calendarDateIst(now);
  const deadline = productReplacementDeadlineYmd(invoiceDateIso);
  if (!today || !deadline) return false;
  return today <= deadline;
}

/** Invoiced within the last 10 days — Full Product Replacement (DOA) only. */
export function isInvoiceEligibleForProductReplacement(
  invoice: ReceivingInvoice | null | undefined,
  _booking?: ReceivingBooking,
  now: Date = new Date(),
): boolean {
  const invoicedAt = invoice?.date;
  if (!invoicedAt) return false;
  return isWithinProductReplacementWindow(invoicedAt, now);
}

export function productReplacementWindowLabel(
  invoiceDateIso: string | null | undefined,
): string | null {
  if (!invoiceDateIso) return null;
  const invoiceDay = calendarDateIst(invoiceDateIso);
  const deadline = productReplacementDeadlineYmd(invoiceDateIso);
  if (!invoiceDay || !deadline) return null;
  return `Invoiced ${formatIstCalendarDate(invoiceDay)} · Return by ${formatIstCalendarDate(deadline)}`;
}
