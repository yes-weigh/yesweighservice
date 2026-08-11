import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { isEwayBillRequired, invoiceTotalInclGst } from '../constants/ewayBill';
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

export function isInvoiceCustomerPickup(
  invoice: Pick<DealerInvoiceDetail, 'customerPickup'> | null | undefined,
): boolean {
  return Boolean(invoice?.customerPickup?.markedAt?.trim());
}

export function invoiceNeedsCustomerPickupEwayVehicle(
  invoice: Pick<DealerInvoiceDetail, 'total' | 'subtotal' | 'taxTotal' | 'customerPickup'> | null | undefined,
): boolean {
  if (!invoice) return false;
  const total = invoiceTotalInclGst(invoice);
  return isEwayBillRequired(total);
}

export function canMarkInvoiceCustomerPickup(
  invoice: Pick<DealerInvoiceDetail, 'customerPickup'> | null | undefined,
  hasActiveLogisticsBooking: boolean,
): boolean {
  if (hasActiveLogisticsBooking) return false;
  return !isInvoiceCustomerPickup(invoice);
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
