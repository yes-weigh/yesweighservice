import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { invoiceAllowsLogisticsFulfillment } from './invoiceListStatus';
import { isInvoiceCustomerPickup } from './invoiceCustomerPickup';
import { invoiceNeedsMandatorySerials } from './invoiceSerialGate';
import type { DealerInvoiceDetail, InvoiceManualDelivery } from '../types/invoices';
import type { LogisticsBooking } from '../types/logistics-dispatch';

const functions = getFunctions(app, 'asia-south1');

const DELIVERED_IDS_STORAGE_KEY = 'yesone.invoiceManualDeliveryIds';

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

export function rememberInvoiceManualDelivery(invoiceId: string): void {
  const id = invoiceId.trim();
  if (!id) return;
  try {
    const next = new Set(readRememberedInvoiceManualDeliveryIds());
    next.add(id);
    sessionStorage.setItem(DELIVERED_IDS_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // private mode / quota
  }
}

export function readRememberedInvoiceManualDeliveryIds(): string[] {
  try {
    const raw = sessionStorage.getItem(DELIVERED_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(value => String(value).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function isInvoiceManuallyDelivered(
  invoice: Pick<DealerInvoiceDetail, 'manualDelivery' | 'manualDeliveredAt'> | null | undefined,
): boolean {
  const nested = invoice?.manualDelivery?.markedAt;
  if (typeof nested === 'string' ? nested.trim() : nested) return true;
  const scalar = invoice?.manualDeliveredAt;
  return typeof scalar === 'string' ? Boolean(scalar.trim()) : Boolean(scalar);
}

export function canMarkInvoiceDelivered(
  invoice: Pick<
    DealerInvoiceDetail,
    | 'customerPickup'
    | 'manualDelivery'
    | 'manualDeliveredAt'
    | 'status'
    | 'categories'
    | 'invoiceCategory'
    | 'lineItems'
  > | null | undefined,
  booking?: Pick<LogisticsBooking, 'status'> | null,
): boolean {
  if (!invoice) return false;
  if (String(invoice.status ?? '').trim().toLowerCase() === 'void') return false;
  if (invoiceNeedsMandatorySerials(invoice.lineItems)) return false;
  if (!invoiceAllowsLogisticsFulfillment(invoice)) return false;
  if (isInvoiceCustomerPickup(invoice) || isInvoiceManuallyDelivered(invoice)) return false;
  const logistics = String(booking?.status ?? '').toLowerCase();
  if (logistics === 'delivered' || logistics === 'returned') return false;
  return true;
}

export async function markInvoiceDelivered(input: {
  customerId: string;
  invoiceId: string;
}): Promise<{ manualDelivery: InvoiceManualDelivery; logisticsBookingId: string | null }> {
  try {
    const fn = httpsCallable<
      typeof input,
      { manualDelivery: InvoiceManualDelivery; logisticsBookingId: string | null }
    >(
      functions,
      'markInvoiceDeliveredFn',
      { timeout: 60_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not mark invoice delivered.');
  }
}
