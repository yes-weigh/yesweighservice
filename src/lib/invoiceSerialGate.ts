import { invoiceNeedsGatcStampedSerialAllotment } from './gatcStampedSerialAllot';
import { isInvoiceCustomerPickup } from './invoiceCustomerPickup';
import { isInvoiceManuallyDelivered } from './invoiceManualDelivery';
import { invoiceNeedsNonGatcSerialAllotment } from './nonGatcSerialAllot';
import type { DealerInvoiceDetail, DealerInvoiceLineItem } from '../types/invoices';

export function invoiceNeedsMandatorySerials(
  lines: ReadonlyArray<DealerInvoiceLineItem> | undefined | null,
): boolean {
  if (!Array.isArray(lines)) return false;
  return invoiceNeedsNonGatcSerialAllotment(lines)
    || invoiceNeedsGatcStampedSerialAllotment(lines);
}

export function invoiceIsDeliveredForSerials(
  invoice: Pick<
    DealerInvoiceDetail,
    'manualDelivery' | 'manualDeliveredAt' | 'customerPickup' | 'goodsReceivedAt'
  > | null | undefined,
): boolean {
  if (!invoice) return false;
  if (isInvoiceManuallyDelivered(invoice) || isInvoiceCustomerPickup(invoice)) return true;
  return Boolean(String(invoice.goodsReceivedAt ?? '').trim());
}
