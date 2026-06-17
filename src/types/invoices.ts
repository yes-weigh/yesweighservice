export type InvoiceStatus =
  | 'sent'
  | 'draft'
  | 'overdue'
  | 'paid'
  | 'void'
  | 'unpaid'
  | 'partially_paid'
  | 'viewed';

export interface DealerInvoice {
  id: string;
  invoiceNumber: string;
  date: string | null;
  dueDate: string | null;
  status: InvoiceStatus | string;
  total: number;
  balance: number;
  referenceNumber: string | null;
  lastPaymentDate: string | null;
  currencyCode: string;
  customerName: string | null;
  invoiceUrl: string | null;
}

export interface InvoiceListParams {
  page?: number;
  limit?: number;
  q?: string;
  status?: InvoiceStatus | 'all' | '';
  sortField?: 'invoiceNumber' | 'date' | 'dueDate' | 'total' | 'balance' | 'status';
  sortDir?: 'asc' | 'desc';
}

export interface InvoiceListResponse {
  data: DealerInvoice[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  customerId?: string;
}

export const INVOICE_STATUS_OPTIONS: Array<{ value: InvoiceStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partially_paid', label: 'Partially paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'sent', label: 'Sent' },
  { value: 'viewed', label: 'Viewed' },
  { value: 'draft', label: 'Draft' },
  { value: 'void', label: 'Void' },
];

export interface InvoiceChartPoint {
  label: string;
  total: number;
}

export interface InvoiceSalesEntry {
  date: string;
  total: number;
}

export type KpiPeriod = 7 | 30 | 90 | 365 | 'lifetime';

export const KPI_PERIOD_OPTIONS: Array<{ value: KpiPeriod; label: string }> = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
  { value: 'lifetime', label: 'Lifetime' },
];

export interface InvoiceDashboardSummary {
  periodStart: string | null;
  periodEnd: string;
  totalSales: number;
  previousSales: number;
  salesTrendPct: number | null;
  outstandingBalance: number;
  unpaidCount: number;
  overdueCount: number;
  paidCount: number;
  totalInvoiceCount: number;
  dailySales: InvoiceChartPoint[];
  salesEntries: InvoiceSalesEntry[];
  recentInvoices: DealerInvoice[];
  customerId?: string;
}
