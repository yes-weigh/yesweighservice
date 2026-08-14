import { freightOptionBySku } from '../constants/freightLines';
import {
  logisticsPartnerImage,
  logisticsPartnerLabel,
} from '../constants/logisticsPartners';
import { invoiceAllowsLogisticsFulfillment } from './invoiceListStatus';
import { isInvoiceCustomerPickup } from './invoiceCustomerPickup';
import { freightSkuFromInvoiceLines } from './invoices';
import type { InvoiceCategory } from '../types/invoices';
import type { LogisticsBooking } from '../types/logistics-dispatch';

export type InvoiceTileLeadVisual = {
  kind: 'partner';
  image: string;
  label: string;
} | {
  kind: 'category';
  category: InvoiceCategory | null;
};

type InvoiceTileLeadInvoice = {
  invoiceCategory?: InvoiceCategory | null;
  categories?: InvoiceCategory[] | null;
  freightSku?: string | null;
  customerPickup?: { markedAt?: string | null } | null;
  customerPickupMarkedAt?: string | null;
  lineItems?: Array<{
    sku?: string | null;
    itemId?: string | null;
    id?: string | null;
    name?: string | null;
    hsn?: string | null;
  }> | null;
};

/**
 * Product/spare tiles show the courier (or pickup) logo when the invoice
 * has a freight line or is marked customer pickup.
 */
export function invoiceTileLeadVisual(
  invoice: InvoiceTileLeadInvoice | null | undefined,
  booking?: Pick<LogisticsBooking, 'partnerId'> | null,
): InvoiceTileLeadVisual {
  const category = invoice?.invoiceCategory ?? null;
  if (!invoiceAllowsLogisticsFulfillment(invoice)) {
    return { kind: 'category', category };
  }

  const sku = String(invoice?.freightSku ?? '').trim().toUpperCase()
    || freightSkuFromInvoiceLines(invoice?.lineItems);
  const freight = freightOptionBySku(sku);
  if (freight?.image) {
    return { kind: 'partner', image: freight.image, label: freight.label };
  }

  const bookingPartner = booking?.partnerId;
  if (bookingPartner) {
    const image = logisticsPartnerImage(bookingPartner);
    if (image) {
      return { kind: 'partner', image, label: logisticsPartnerLabel(bookingPartner) };
    }
  }

  if (isInvoiceCustomerPickup(invoice)) {
    const image = logisticsPartnerImage('personal_collection');
    if (image) {
      return { kind: 'partner', image, label: logisticsPartnerLabel('personal_collection') };
    }
  }

  return { kind: 'category', category };
}
