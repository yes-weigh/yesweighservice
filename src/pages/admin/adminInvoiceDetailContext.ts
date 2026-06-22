import type { DealerInvoiceDetail } from '../../types/invoices';

export interface AdminInvoiceDetailOutletContext {
  invoice: DealerInvoiceDetail | null;
  loading: boolean;
  error: string;
  customerId: string;
  invoiceId: string;
  invoicesPath: string;
}
