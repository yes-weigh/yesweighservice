import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type {
  CancelInvoiceEwayBillResult,
  InvoiceEwayBillRecord,
  InvoiceEwayBillResult,
  InvoiceEwayBillStatus,
} from '../types/invoices';
import type { EwayBillCancelReason } from '../constants/ewayBill';

const functions = getFunctions(app, 'asia-south1');

export type {
  CancelInvoiceEwayBillResult,
  InvoiceEwayBillRecord,
  InvoiceEwayBillResult,
  InvoiceEwayBillStatus,
};
export type { EwayBillCancelReason };

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

export async function ensureInvoiceEwayBill(input: {
  customerId: string;
  invoiceId: string;
  partnerId?: string | null;
  lrNumber?: string | null;
  bookingId?: string | null;
  invoiceTotalInr?: number | null;
  autoGenerate?: boolean;
  forceRequired?: boolean;
}): Promise<InvoiceEwayBillResult> {
  try {
    const fn = httpsCallable<typeof input, InvoiceEwayBillResult>(
      functions,
      'ensureInvoiceEwayBillFn',
      { timeout: 180_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not load e-way bill.');
  }
}

export type DelhiveryPartnerEwayStatus = {
  onPartner: boolean;
  lrn: string | null;
  waybill?: string | null;
  expected: string[];
  partnerEwaybills: string[];
  missing: string[];
};

export async function syncDelhiveryLrEwayStatus(input: {
  bookingId?: string | null;
  invoiceId?: string | null;
}): Promise<DelhiveryPartnerEwayStatus> {
  try {
    const fn = httpsCallable<typeof input, DelhiveryPartnerEwayStatus>(
      functions,
      'syncDelhiveryLrEwayStatusFn',
      { timeout: 60_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not read e-way status from Delhivery.');
  }
}

export async function pushDelhiveryLrEwayBills(input: {
  bookingId?: string | null;
  invoiceId?: string | null;
}): Promise<{ ok: boolean; lrn: string | null; error: string | null }> {
  try {
    const fn = httpsCallable<typeof input, { ok: boolean; lrn: string | null; error: string | null }>(
      functions,
      'pushDelhiveryLrEwayBillsFn',
      { timeout: 90_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not push e-way bills to Delhivery.');
  }
}

export async function cancelInvoiceEwayBill(input: {
  customerId: string;
  invoiceId: string;
  bookingId?: string | null;
  reason: EwayBillCancelReason;
  remarks?: string | null;
  localOnly?: boolean;
}): Promise<CancelInvoiceEwayBillResult> {
  try {
    const fn = httpsCallable<typeof input, CancelInvoiceEwayBillResult>(
      functions,
      'cancelInvoiceEwayBillFn',
      { timeout: 120_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not cancel e-way bill.');
  }
}
