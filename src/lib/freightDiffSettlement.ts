import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');

export type PendingFreightDiffPreview = {
  zohoCustomerId: string;
  sourceBookingId: string | null;
  sourceInvoiceNumber: string | null;
  sourceLrn: string | null;
  sourceDifferenceInr: number;
  remainingInr: number;
  availableInr: number;
  reservedSalesOrderId: string | null;
  reservedSalesOrderNumber: string | null;
  reservedAppliedInr: number;
  willApplyOnNextFreightSo: boolean;
};

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message || '').trim();
    if (message) return new Error(message);
  }
  return new Error(fallback);
}

export async function fetchPendingFreightDiff(
  zohoCustomerId?: string | null,
): Promise<PendingFreightDiffPreview> {
  try {
    const fn = httpsCallable<{ zohoCustomerId?: string }, PendingFreightDiffPreview>(
      functions,
      'getPendingFreightDiff',
      { timeout: 60_000 },
    );
    const result = await fn({
      ...(zohoCustomerId?.trim() ? { zohoCustomerId: zohoCustomerId.trim() } : {}),
    });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not load prior freight adjustment.');
  }
}

export function formatPendingFreightAdjustLabel(availableInr: number): string {
  const amount = Math.abs(Number(availableInr) || 0);
  const formatted = amount.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  if (availableInr > 0) {
    return `Prior freight under-billed ₹${formatted} will be added to freight on this order`;
  }
  if (availableInr < 0) {
    return `Prior freight over-billed ₹${formatted} will reduce freight on this order (min ₹0)`;
  }
  return '';
}
