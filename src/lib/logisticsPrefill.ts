import type { NavigateFunction } from 'react-router-dom';
import type { DealerSupportRequest } from '../types/dealer-support';
import type { DealerInvoiceDetail, InvoiceCategory } from '../types/invoices';
import type { Role } from '../types';
import { homePathForRole } from '../types';
import type { LogisticsBookingDraft } from '../types/logistics-dispatch';

export const LOGISTICS_ENTRY_STATE_KEY = 'logisticsEntry';

/** Categories that never get courier booking from the invoice detail. */
const COURIER_BLOCKED_INVOICE_CATEGORIES: ReadonlySet<InvoiceCategory> = new Set([
  'software_key',
  'gatc',
]);

export interface LogisticsEntryState {
  draftPatch: Partial<LogisticsBookingDraft>;
  dealerQuery?: string;
}

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

export function buildInvoiceBookingDraftPatch(
  invoice: DealerInvoiceDetail,
  invoiceId: string,
  zohoCustomerId: string,
  dealerId: string,
): Partial<LogisticsBookingDraft> {
  return {
    source: 'invoice',
    invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    supportRequestId: null,
    supportRequestNumber: null,
    zohoCustomerId,
    dealerId,
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
