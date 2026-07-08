import type { NavigateFunction } from 'react-router-dom';
import type { DealerSupportRequest } from '../types/dealer-support';
import type { DealerInvoiceDetail, DealerInvoiceLineItem } from '../types/invoices';
import type { Role } from '../types';
import { homePathForRole } from '../types';
import type { LogisticsBookingDraft, ShipmentItem } from '../types/logistics-dispatch';
import { isFreightInvoiceLineItem, isStampingInvoiceLineItem } from './invoices';

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

export function lineItemToShipmentItem(item: DealerInvoiceLineItem): ShipmentItem {
  return {
    id: `inv-${item.id}`,
    name: item.name,
    sku: item.sku,
    catalogProductId: item.itemId,
    quantity: item.quantity,
    serialNumbers: item.serialNumbers ?? [],
    photoStoragePath: null,
    photoUrl: null,
  };
}

export function buildInvoiceBookingDraftPatch(
  invoice: DealerInvoiceDetail,
  invoiceId: string,
  zohoCustomerId: string,
  dealerId: string,
): Partial<LogisticsBookingDraft> {
  const shipmentItems = invoice.lineItems
    .filter(item => !isFreightInvoiceLineItem(item) && !isStampingInvoiceLineItem(item))
    .map(lineItemToShipmentItem);

  return {
    source: 'invoice',
    invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    supportRequestId: null,
    supportRequestNumber: null,
    zohoCustomerId,
    dealerId,
    shipmentItems,
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

  const shipmentItems: ShipmentItem[] = [];
  if (request.product) {
    shipmentItems.push({
      id: `sup-${request.product.lineItemId ?? request.id}`,
      name: request.product.name,
      sku: request.product.sku,
      catalogProductId: request.product.itemId,
      quantity: request.product.quantity,
      serialNumbers: request.product.serialNumber ? [request.product.serialNumber] : [],
      photoStoragePath: null,
      photoUrl: null,
    });
  }

  return {
    source: 'support',
    invoiceId: request.invoiceId,
    invoiceNumber: request.invoiceNumber,
    supportRequestId: request.id,
    supportRequestNumber: request.requestNumber,
    zohoCustomerId,
    dealerId,
    shipmentItems,
  };
}
