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

export interface DealerInvoiceLineItem {
  id: string;
  itemId: string | null;
  name: string;
  description: string | null;
  sku: string | null;
  quantity: number;
  rate: number;
  total: number;
  imageUrl: string | null;
}

export interface DealerInvoiceDetail extends DealerInvoice {
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  subtotal: number;
  taxTotal: number;
  notes: string | null;
  lineItems: DealerInvoiceLineItem[];
}

export type InvoiceDocumentType = 'invoice' | 'salesorder';

export interface InvoiceDocumentDownload {
  contentBase64: string;
  filename: string;
  mimeType: string;
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

export type KpiPeriod =
  | 7
  | 30
  | 90
  | 365
  | 'lifetime'
  | 'current_month'
  | 'current_year'
  | 'financial_year';

export type SalesRangePreset = KpiPeriod;

export const KPI_PERIOD_OPTIONS: Array<{ value: KpiPeriod; label: string }> = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 365 days' },
  { value: 'lifetime', label: 'Lifetime' },
  { value: 'current_month', label: 'Current month' },
  { value: 'current_year', label: 'Current year' },
  { value: 'financial_year', label: 'Current year (financial year)' },
];

export const SALES_RANGE_OPTIONS = KPI_PERIOD_OPTIONS;

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
