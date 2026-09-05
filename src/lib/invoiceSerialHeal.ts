import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { DealerInvoiceLineItem } from '../types/invoices';

export async function healInvoiceSerials(input: {
  customerId: string;
  invoiceId: string;
}): Promise<{ lineItems: DealerInvoiceLineItem[]; healed: boolean }> {
  const fn = httpsCallable<typeof input, { lineItems?: DealerInvoiceLineItem[]; healed?: boolean }>(
    getFunctions(app, 'asia-south1'),
    'healInvoiceSerialsFn',
    { timeout: 60_000 },
  );
  const result = await fn(input);
  return {
    lineItems: result.data.lineItems ?? [],
    healed: Boolean(result.data.healed),
  };
}
