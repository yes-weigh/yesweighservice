import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { isEwayBillRequired, invoiceTotalInclGst } from '../constants/ewayBill';
import { isFreightInvoiceLineItem } from './invoices';
import type {
  DealerInvoiceDetail,
  InvoiceCustomerPickup,
  InvoiceEwayBillResult,
} from '../types/invoices';

const functions = getFunctions(app, 'asia-south1');

export type MarkInvoiceCustomerPickupResult = {
  customerPickup: InvoiceCustomerPickup;
  partnerId: string;
  ewayRequired: boolean;
  eway?: InvoiceEwayBillResult | null;
};

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

const PICKUP_IDS_STORAGE_KEY = 'yesone.invoiceCustomerPickupIds';

export function rememberInvoiceCustomerPickup(invoiceId: string): void {
  const id = invoiceId.trim();
  if (!id) return;
  try {
    const next = new Set(readRememberedInvoiceCustomerPickupIds());
    next.add(id);
    sessionStorage.setItem(PICKUP_IDS_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // private mode / quota
  }
}

export function readRememberedInvoiceCustomerPickupIds(): string[] {
  try {
    const raw = sessionStorage.getItem(PICKUP_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(value => String(value).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function isInvoiceCustomerPickup(
  invoice: Pick<DealerInvoiceDetail, 'customerPickup'> | null | undefined,
): boolean {
  const markedAt = invoice?.customerPickup?.markedAt;
  return typeof markedAt === 'string' ? Boolean(markedAt.trim()) : Boolean(markedAt);
}

export function invoiceNeedsCustomerPickupEwayVehicle(
  invoice: Pick<DealerInvoiceDetail, 'total' | 'subtotal' | 'taxTotal' | 'customerPickup'> | null | undefined,
): boolean {
  if (!invoice) return false;
  const total = invoiceTotalInclGst(invoice);
  return isEwayBillRequired(total);
}

function invoiceHasCourierFreightLine(
  invoice: Pick<DealerInvoiceDetail, 'lineItems'> | null | undefined,
): boolean {
  return (invoice?.lineItems ?? []).some(line => isFreightInvoiceLineItem(line));
}

export function canMarkInvoiceCustomerPickup(
  invoice: Pick<
    DealerInvoiceDetail,
    'customerPickup' | 'sourceSalesOrderIsPickup' | 'lineItems'
  > | null | undefined,
  hasActiveLogisticsBooking: boolean,
): boolean {
  if (!invoice || hasActiveLogisticsBooking) return false;
  if (isInvoiceCustomerPickup(invoice)) return false;
  if (invoiceHasCourierFreightLine(invoice)) return false;
  return Boolean(invoice.sourceSalesOrderIsPickup);
}

export async function markInvoiceCustomerPickup(input: {
  customerId: string;
  invoiceId: string;
  shipFromSite?: string | null;
  vehicleNumber?: string | null;
}): Promise<MarkInvoiceCustomerPickupResult> {
  try {
    const fn = httpsCallable<typeof input, MarkInvoiceCustomerPickupResult>(
      functions,
      'markInvoiceCustomerPickupFn',
      { timeout: 180_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not mark customer pickup.');
  }
}

export async function updateCustomerPickupEwayPartB(input: {
  customerId: string;
  invoiceId: string;
  vehicleNumber: string;
}): Promise<{ customerPickup: InvoiceCustomerPickup; eway?: InvoiceEwayBillResult | null }> {
  try {
    const fn = httpsCallable<typeof input, { customerPickup: InvoiceCustomerPickup; eway?: InvoiceEwayBillResult | null }>(
      functions,
      'updateCustomerPickupEwayPartBFn',
      { timeout: 180_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not update e-way bill Part B.');
  }
}
