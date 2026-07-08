import type { NavigateFunction } from 'react-router-dom';
import type { DealerSupportRequest } from '../types/dealer-support';
import type { DealerInvoiceDetail } from '../types/invoices';
import type { Role } from '../types';
import { homePathForRole } from '../types';
import type { LogisticsBookingDraft } from '../types/logistics-dispatch';

export const LOGISTICS_ENTRY_STATE_KEY = 'logisticsEntry';

export interface LogisticsEntryState {
  draftPatch: Partial<LogisticsBookingDraft>;
  dealerQuery?: string;
}

export function logisticsPathForRole(role: Role): string {
  return `${homePathForRole(role)}/logistics`;
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
