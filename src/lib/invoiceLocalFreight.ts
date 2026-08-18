import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { FREIGHT_LINE_OPTIONS, freightOptionBySku, type FreightLineSku } from '../constants/freightLines';
import { isPipelineEnabledPartner } from './logisticsBooking';
import { partnerIdForFreightSku } from './orderFreight';
import { isFreightInvoiceLineItem } from './invoices';
import type {
  DealerInvoiceDetail,
  DealerInvoiceLineItem,
  InvoiceLocalFreightPartner,
} from '../types/invoices';

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

export function mapInvoiceLocalFreightPartner(
  raw: unknown,
): InvoiceLocalFreightPartner | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const sku = String(data.sku ?? '').trim().toUpperCase();
  const partnerId = String(data.partnerId ?? '').trim()
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
  const option = freightOptionBySku(invoice.yesOneFreightPartner?.sku);
  if (!option) return invoice.lineItems;
  let replaced = false;
  return invoice.lineItems.map((line) => {
    if (replaced || !isFreightInvoiceLineItem(line)) return line;
    replaced = true;
    return {
      ...line,
      name: option.name,
      sku: option.sku,
      itemId: option.productId,
      imageUrl: option.image,
    };
  });
}

export async function setInvoiceLocalFreightPartner(input: {
  customerId: string;
  invoiceId: string;
  sku: FreightLineSku;
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
