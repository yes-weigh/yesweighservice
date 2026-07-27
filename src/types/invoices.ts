export type InvoiceStatus =
  | 'sent'
  | 'draft'
  | 'overdue'
  | 'paid'
  | 'void'
  | 'unpaid'
  | 'partially_paid'
  | 'viewed';

/** Used across invoice, sales order, and purchase order category classification. */
export type InvoiceCategory = 'product' | 'spare' | 'service' | 'software_key' | 'gatc';

export const INVOICE_CATEGORIES: readonly InvoiceCategory[] = [
  'product',
  'spare',
  'service',
  'software_key',
  'gatc',
] as const;

export interface DealerInvoice {
  id: string;
  invoiceNumber: string;
  date: string | null;
  dueDate: string | null;
  status: InvoiceStatus | string;
  /** Grand total including GST. */
  total: number;
  /** Pre-tax amount (excludes GST). Null on older docs that predate sync of this field. */
  subtotal?: number | null;
  /** GST / tax total. Null on older docs that predate sync of this field. */
  taxTotal?: number | null;
  balance: number;
  referenceNumber: string | null;
  lastPaymentDate: string | null;
  currencyCode: string;
  customerName: string | null;
  /** Zoho Inventory salesperson (KAM) when present on the invoice. */
  salespersonId?: string | null;
  salespersonName?: string | null;
  invoiceUrl: string | null;
  /** Legacy single category kept during migration; null for older docs. */
  invoiceCategory?: InvoiceCategory | null;
  /** Multi-category classification derived from non-freight line items. */
  categories?: InvoiceCategory[];
  /** Sum of line totals per category on this document. */
  categoryAmounts?: Partial<Record<InvoiceCategory, number>>;
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
  /** HSN / SAC from Zoho line or catalog (used to exclude freight SAC). */
  hsn?: string | null;
  serialNumbers?: string[];
}

export interface DealerInvoiceDetail extends DealerInvoice {
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  subtotal: number;
  taxTotal: number;
  notes: string | null;
  lineItems: DealerInvoiceLineItem[];
  /** Resolved shipping/billing address for display (from invoice or zohoCustomers). */
  shippingAddress?: string | null;
  customerPhone?: string | null;
  customerTelHref?: string | null;
  customerWhatsappHref?: string | null;
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
  category?: InvoiceCategory | 'all' | '';
  sortField?: 'invoiceNumber' | 'date' | 'dueDate' | 'total' | 'balance' | 'status';
  sortDir?: 'asc' | 'desc';
  /** Ops only — load invoices for a specific Zoho customer. */
  customerId?: string;
}

export const INVOICE_CATEGORY_FILTER_OPTIONS: Array<{
  value: InvoiceCategory | 'all';
  label: string;
}> = [
  { value: 'all', label: 'All categories' },
  { value: 'product', label: 'Product' },
  { value: 'spare', label: 'Spares' },
  { value: 'software_key', label: 'Software' },
  { value: 'service', label: 'Service charges' },
  { value: 'gatc', label: 'GATC' },
];

export interface InvoiceListResponse {
  data: DealerInvoice[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  /** Present after status/search filters; used for category tab badges. */
  categoryCounts?: {
    all: number;
    product: number;
    spare: number;
    software_key: number;
    service: number;
    gatc: number;
  };
  customerId?: string;
  lastSyncedAt?: string | null;
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
  | 'previous_month'
  | 'financial_year'
  | 'previous_financial_year';

export type SalesRangePreset = KpiPeriod;

export const KPI_PERIOD_OPTIONS: Array<{ value: KpiPeriod; label: string }> = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 365 days' },
  { value: 'lifetime', label: 'Lifetime' },
  { value: 'current_month', label: 'Current month' },
  { value: 'previous_month', label: 'Previous month' },
  { value: 'financial_year', label: 'Current year (FY)' },
  { value: 'previous_financial_year', label: 'Previous year (FY)' },
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
