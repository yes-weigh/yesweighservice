import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { FREIGHT_LINE_OPTIONS, freightOptionBySku, type FreightLineSku } from '../constants/freightLines';
import { isLogisticsPartnerId, type LogisticsPartnerId } from '../constants/logisticsPartners';
import { partnerStatusSelectableOnSalesOrder } from '../constants/logisticsPartnerStatus';
import { isPipelineEnabledPartner } from './logisticsBooking';
import {
  inferLogisticsDestinationRegion,
  resolveDeliveryPartnersForRoute,
} from './logisticsDeliveryRules';
import {
  freightSkuForPartner,
  isPickupPartner,
  partnerIdForFreightSku,
  PICKUP_PARTNER_ID,
} from './orderFreight';
import { isFreightInvoiceLineItem } from './invoices';
import type {
  DealerInvoiceDetail,
  DealerInvoiceLineItem,
  InvoiceLocalFreightPartner,
} from '../types/invoices';
import type { LogisticsDeliveryRulesMatrix } from '../types/logistics-delivery-rules';
import type { LogisticsPartnerStatuses } from '../types/logistics-partner-status';
import type { StaffLogisticsSite } from '../types/staff-logistics';

const functions = getFunctions(app, 'asia-south1');

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

export const LOCAL_FREIGHT_SKU_OPTIONS = FREIGHT_LINE_OPTIONS.filter((option) => {
  const partner = partnerIdForFreightSku(option.sku);
  return Boolean(partner && isPipelineEnabledPartner(partner));
});

/** YesOne-only pickup switch — not a Zoho freight SKU. */
export const LOCAL_FREIGHT_PICKUP_SKU = 'PICKUP';

export type LocalFreightSelectSku = FreightLineSku | typeof LOCAL_FREIGHT_PICKUP_SKU;

export const LOCAL_FREIGHT_PICKUP_OPTION = {
  sku: LOCAL_FREIGHT_PICKUP_SKU,
  label: 'Customer Pickup',
  name: 'CUSTOMER PICKUP',
  image: '/logistics/personal-collection.png',
  productId: '',
} as const;

export function isLocalFreightPickupSku(sku: string | null | undefined): boolean {
  return String(sku ?? '').trim().toUpperCase() === LOCAL_FREIGHT_PICKUP_SKU;
}

export function isInvoiceLocalFreightPickup(
  invoice: Pick<DealerInvoiceDetail, 'yesOneFreightPartner'> | null | undefined,
): boolean {
  const partner = String(invoice?.yesOneFreightPartner?.partnerId ?? '').trim();
  return (isLogisticsPartnerId(partner) && isPickupPartner(partner))
    || isLocalFreightPickupSku(invoice?.yesOneFreightPartner?.sku);
}

export type InvoiceLocalFreightListOption = {
  sku: LocalFreightSelectSku;
  label: string;
  image: string;
  partnerId: LogisticsPartnerId;
};

/** Partners from delivery rules for this origin + destination, plus Customer Pickup. */
export function invoiceLocalFreightListOptions(input: {
  invoice: Pick<
    DealerInvoiceDetail,
    'shippingAddress' | 'billingAddress' | 'yesOneFreightPartner' | 'freightSku' | 'lineItems'
  >;
  deliveryRules: LogisticsDeliveryRulesMatrix;
  partnerStatuses: LogisticsPartnerStatuses;
  shipFromSite: StaffLogisticsSite;
}): InvoiceLocalFreightListOption[] {
  const region = inferLogisticsDestinationRegion(
    input.invoice.shippingAddress || input.invoice.billingAddress || '',
  );
  const fromRules = resolveDeliveryPartnersForRoute(
    input.deliveryRules,
    region,
    input.shipFromSite,
  );
  const ordered: LogisticsPartnerId[] = [];
  const seen = new Set<LogisticsPartnerId>();
  for (const id of fromRules) {
    if (seen.has(id)) continue;
    if (!isPickupPartner(id) && !partnerStatusSelectableOnSalesOrder(input.partnerStatuses[id])) {
      continue;
    }
    seen.add(id);
    ordered.push(id);
  }
  if (!seen.has(PICKUP_PARTNER_ID)) {
    ordered.push(PICKUP_PARTNER_ID);
  }
  const current = String(input.invoice.yesOneFreightPartner?.partnerId ?? '').trim()
    || partnerIdForFreightSku(effectiveInvoiceFreightSku(input.invoice))
    || '';
  if (current && isLogisticsPartnerId(current) && !seen.has(current)) {
    ordered.unshift(current);
  }

  const options: InvoiceLocalFreightListOption[] = [];
  for (const partnerId of ordered) {
    if (isPickupPartner(partnerId)) {
      options.push({
        sku: LOCAL_FREIGHT_PICKUP_SKU,
        label: LOCAL_FREIGHT_PICKUP_OPTION.label,
        image: LOCAL_FREIGHT_PICKUP_OPTION.image,
        partnerId,
      });
      continue;
    }
    const sku = freightSkuForPartner(partnerId);
    const meta = sku ? LOCAL_FREIGHT_SKU_OPTIONS.find(option => option.sku === sku) : null;
    if (!sku || !meta) continue;
    options.push({
      sku,
      label: meta.label,
      image: meta.image,
      partnerId,
    });
  }
  return options;
}

export function mapInvoiceLocalFreightPartner(
  raw: unknown,
): InvoiceLocalFreightPartner | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const sku = String(data.sku ?? '').trim().toUpperCase();
  const partnerId = String(data.partnerId ?? '').trim()
    || (isLocalFreightPickupSku(sku) ? PICKUP_PARTNER_ID : '')
    || partnerIdForFreightSku(sku)
    || '';
  if (!sku || !partnerId) return null;
  const paidRaw = Number(data.paidFreightInr);
  return {
    partnerId,
    sku,
    previousPartnerId: data.previousPartnerId ? String(data.previousPartnerId) : null,
    previousSku: data.previousSku ? String(data.previousSku) : null,
    paidFreightInr: Number.isFinite(paidRaw) && paidRaw >= 0 ? paidRaw : null,
    updatedAt: data.updatedAt ? String(data.updatedAt) : '',
    updatedByUid: data.updatedByUid ? String(data.updatedByUid) : null,
    updatedByName: data.updatedByName ? String(data.updatedByName) : null,
  };
}

export function effectiveInvoiceFreightSku(
  invoice: Pick<DealerInvoiceDetail, 'freightSku' | 'lineItems' | 'yesOneFreightPartner'> | null | undefined,
): string | null {
  const override = invoice?.yesOneFreightPartner?.sku?.trim().toUpperCase() || '';
  if (override) return override;
  const listed = String(invoice?.freightSku ?? '').trim().toUpperCase();
  return listed || null;
}

/**
 * Overlay the first courier freight line with the local YesOne partner (display only).
 * Name / SKU / image change — billed rate and total never change.
 */
export function overlayLocalFreightOnLineItems(
  invoice: Pick<DealerInvoiceDetail, 'lineItems' | 'yesOneFreightPartner'>,
): DealerInvoiceLineItem[] {
  const pickup = isInvoiceLocalFreightPickup(invoice);
  const option = pickup
    ? LOCAL_FREIGHT_PICKUP_OPTION
    : freightOptionBySku(invoice.yesOneFreightPartner?.sku);
  if (!option) return invoice.lineItems;
  let replaced = false;
  return invoice.lineItems.map((line) => {
    if (replaced || !isFreightInvoiceLineItem(line)) return line;
    replaced = true;
    return {
      ...line,
      name: option.name,
      sku: option.sku,
      itemId: option.productId || line.itemId,
      imageUrl: option.image,
    };
  });
}

export async function setInvoiceLocalFreightPartner(input: {
  customerId: string;
  invoiceId: string;
  sku: LocalFreightSelectSku;
}): Promise<{ yesOneFreightPartner: InvoiceLocalFreightPartner | null }> {
  try {
    const fn = httpsCallable<
      typeof input,
      { yesOneFreightPartner: InvoiceLocalFreightPartner | null }
    >(
      functions,
      'setInvoiceLocalFreightPartnerFn',
      { timeout: 60_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not update local logistics partner.');
  }
}
