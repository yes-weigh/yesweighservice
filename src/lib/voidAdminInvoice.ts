import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

export type VoidAdminInvoiceResult = {
  voided: boolean;
  released: number;
  zohoPushed?: boolean;
  zohoError?: string;
  invoiceId?: string;
};

export async function voidAdminInvoice(input: {
  customerId: string;
  invoiceId: string;
  reason?: string;
}): Promise<VoidAdminInvoiceResult> {
  const fn = httpsCallable<typeof input, VoidAdminInvoiceResult>(
    getFunctions(app, 'asia-south1'),
    'voidAdminInvoiceFn',
    { timeout: 90_000 },
  );
  return (await fn(input)).data;
}
