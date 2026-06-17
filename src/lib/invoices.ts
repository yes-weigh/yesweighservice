import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { InvoiceListParams, InvoiceListResponse } from '../types/invoices';

const functions = getFunctions(app, 'asia-south1');

export function invoiceErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = 'code' in err ? String((err as { code: string }).code) : '';
    const message = 'message' in err ? String((err as { message: string }).message) : '';
    if (code === 'functions/deadline-exceeded' || message.includes('deadline-exceeded')) {
      return 'Invoice request timed out. Try again in a moment.';
    }
    if (code === 'functions/not-found' || message.includes('not-found')) {
      return 'Invoice service is not deployed yet. Push to main or deploy Cloud Functions.';
    }
    if (code === 'functions/permission-denied') {
      return 'You do not have permission to view invoices.';
    }
    if (message) return message;
  }
  return 'Could not load invoices.';
}

export async function fetchDealerInvoices(params: InvoiceListParams = {}): Promise<InvoiceListResponse> {
  const callable = httpsCallable<InvoiceListParams, InvoiceListResponse>(
    functions,
    'getDealerInvoices',
    { timeout: 120_000 },
  );
  try {
    const result = await callable(params);
    return result.data;
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

export function formatInvoiceDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

export function invoiceStatusLabel(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}
