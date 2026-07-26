import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../firebase';
import type { InvoiceCategory } from '../types/invoices';

const functions = getFunctions(app, 'asia-south1');

export const INVOICE_CSV_TEMPLATE_HEADERS = [
  'Invoice ID',
  'Customer ID',
  'Invoice Number',
  'Invoice Date',
  'Due Date',
  'Status',
  'Total',
  'Balance',
  'Sub Total',
  'Tax Total',
  'Currency Code',
  'Customer Name',
  'Sales Person ID',
  'Sales Person',
  'Reference Number',
  'Last Payment Date',
  'Sales Order ID',
  'Sales Order Number',
  'Notes',
  'Invoice Category',
  'Invoice URL',
  'Item ID',
  'Line Item ID',
  'Item Name',
  'SKU',
  'Description',
  'Quantity',
  'Rate',
  'Item Total',
  'HSN/SAC',
  'Serial Numbers',
] as const;

const INVOICE_CATEGORIES = new Set<InvoiceCategory>([
  'product',
  'spare',
  'service',
  'software_key',
  'gatc',
]);

/** Canonical field keys used after header alias resolution. */
export type InvoiceCsvField =
  | 'invoiceId'
  | 'customerId'
  | 'invoiceNumber'
  | 'date'
  | 'dueDate'
  | 'status'
  | 'total'
  | 'balance'
  | 'subtotal'
  | 'taxTotal'
  | 'currencyCode'
  | 'customerName'
  | 'referenceNumber'
  | 'lastPaymentDate'
  | 'salespersonId'
  | 'salespersonName'
  | 'invoiceUrl'
  | 'salesOrderId'
  | 'salesOrderNumber'
  | 'notes'
  | 'invoiceCategory'
  | 'itemName'
  | 'itemId'
  | 'lineItemId'
  | 'sku'
  | 'description'
  | 'quantity'
  | 'rate'
  | 'itemTotal'
  | 'hsn'
  | 'serialNumbers';

const HEADER_ALIASES: Record<InvoiceCsvField, string[]> = {
  invoiceId: ['invoice id', 'invoice_id', 'invoiceid'],
  customerId: ['customer id', 'customer_id', 'customerid'],
  invoiceNumber: ['invoice number', 'invoice_number', 'invoicenumber'],
  date: ['invoice date', 'date', 'invoice_date'],
  dueDate: ['due date', 'due_date', 'duedate'],
  status: ['status', 'invoice status'],
  total: ['total', 'total amount', 'invoice total'],
  balance: ['balance', 'balance due', 'balance_due'],
  subtotal: ['sub total', 'subtotal', 'sub_total'],
  taxTotal: ['tax total', 'taxtotal', 'tax_total', 'tax'],
  currencyCode: ['currency code', 'currency', 'currency_code', 'currencycode'],
  customerName: ['customer name', 'customer_name', 'customername'],
  referenceNumber: ['reference number', 'reference_number', 'ref number', 'reference'],
  lastPaymentDate: ['last payment date', 'last_payment_date', 'lastpaymentdate'],
  salespersonId: [
    'sales person id',
    'salesperson id',
    'salesperson_id',
    'salespersonid',
    'sales personid',
  ],
  salespersonName: [
    'sales person',
    'salesperson',
    'salesperson_name',
    'salesperson name',
    'sales person name',
  ],
  invoiceUrl: ['invoice url', 'invoice_url', 'invoiceurl'],
  salesOrderId: ['sales order id', 'salesorder id', 'sales_order_id', 'salesorderid'],
  salesOrderNumber: [
    'sales order number',
    'sales order #',
    'salesorder number',
    'sales_order_number',
  ],
  notes: ['notes', 'note'],
  invoiceCategory: ['invoice category', 'category', 'invoice_category'],
  itemName: ['item name', 'item_name', 'itemname', 'product name'],
  itemId: ['item id', 'item_id', 'itemid', 'product id', 'product_id'],
  lineItemId: ['line item id', 'line_item_id', 'lineitemid'],
  sku: ['sku'],
  description: ['description', 'item description'],
  quantity: ['quantity', 'qty'],
  rate: ['rate', 'price', 'unit price'],
  itemTotal: ['item total', 'item_total', 'itemtotal', 'amount', 'line total'],
  hsn: ['hsn', 'hsn/sac', 'hsn_or_sac', 'hsn or sac', 'sac'],
  serialNumbers: [
    'serial numbers',
    'serial number',
    'serials',
    'serial_numbers',
    'serial_number',
  ],
};

const LINE_ITEM_FIELDS: InvoiceCsvField[] = [
  'itemName',
  'itemId',
  'lineItemId',
  'sku',
  'description',
  'quantity',
  'rate',
  'itemTotal',
  'hsn',
  'serialNumbers',
];

export type InvoiceCsvLineItem = {
  id: string;
  itemId: string | null;
  name: string;
  description: string | null;
  sku: string | null;
  quantity: number;
  rate: number;
  total: number;
  imageUrl: null;
  hsn: string | null;
  serialNumbers: string[];
};

/** Fields present in the CSV for this invoice (non-empty first-wins). */
export type InvoiceCsvHeaderPatch = {
  invoiceNumber?: string;
  date?: string;
  dueDate?: string | null;
  status?: string;
  total?: number;
  balance?: number;
  subtotal?: number | null;
  taxTotal?: number | null;
  currencyCode?: string;
  customerName?: string | null;
  referenceNumber?: string | null;
  lastPaymentDate?: string | null;
  salespersonId?: string | null;
  salespersonName?: string | null;
  invoiceUrl?: string | null;
  salesOrderId?: string | null;
  salesOrderNumber?: string | null;
  notes?: string | null;
  invoiceCategory?: InvoiceCategory | null;
};

export type InvoiceCsvGrouped = {
  key: string;
  invoiceId: string | null;
  customerId: string | null;
  sourceRows: number[];
  header: InvoiceCsvHeaderPatch;
  lineItems: InvoiceCsvLineItem[];
  hasLineItemColumns: boolean;
};

export type InvoiceCsvPreviewAction = 'create' | 'update' | 'skip' | 'error';

export type InvoiceCsvPreviewRow = {
  key: string;
  invoiceId: string | null;
  customerId: string | null;
  invoiceNumber: string | null;
  action: InvoiceCsvPreviewAction;
  lineItemCount: number;
  message: string | null;
};

export type InvoiceCsvParseResult = {
  groups: InvoiceCsvGrouped[];
  rawRowCount: number;
  presentFields: InvoiceCsvField[];
};

export type InvoiceCsvApplyBatchResult = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { invoiceId: string | null; customerId: string | null; message: string }[];
};

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildInvoiceCsvTemplate(): string {
  return `${INVOICE_CSV_TEMPLATE_HEADERS.map(h => escapeCsvCell(h)).join(',')}\n`;
}

export function downloadInvoiceCsvTemplate(): void {
  const blob = new Blob([buildInvoiceCsvTemplate()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'invoice-upsert-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return tabs >= commas && tabs > 0 ? '\t' : ',';
}

function resolveField(normalizedHeader: string): InvoiceCsvField | null {
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [InvoiceCsvField, string[]][]) {
    if (aliases.includes(normalizedHeader)) return field;
  }
  return null;
}

/** Normalize Zoho-style dates to YYYY-MM-DD when possible. */
export function normalizeInvoiceDate(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  const dmy = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3];
    return `${year}-${month}-${day}`;
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return value;
}

function parseNumber(raw: string | null | undefined): number | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const cleaned = value.replace(/,/g, '').replace(/[^\d.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseSerialNumbers(raw: string | null | undefined): string[] {
  const value = String(raw ?? '').trim();
  if (!value) return [];
  return [...new Set(
    value
      .split(/[|;,]+/)
      .map(part => part.trim())
      .filter(Boolean),
  )];
}

function parseCategory(raw: string | null | undefined): InvoiceCategory | null {
  const key = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  return INVOICE_CATEGORIES.has(key as InvoiceCategory) ? (key as InvoiceCategory) : null;
}

function firstNonEmpty(map: Map<string, string>, field: InvoiceCsvField): string | null {
  const value = map.get(field)?.trim();
  return value || null;
}

export function parseInvoiceUpsertCsv(text: string): InvoiceCsvParseResult {
  const normalized = text.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one data row.');
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  const columnMap: Array<InvoiceCsvField | null> = headers.map(resolveField);
  const presentFields = [...new Set(columnMap.filter((f): f is InvoiceCsvField => f != null))];

  if (!presentFields.includes('invoiceId') && !presentFields.includes('invoiceNumber')) {
    throw new Error('CSV must include Invoice ID and/or Invoice Number.');
  }
  if (!presentFields.includes('customerId') && !presentFields.includes('invoiceId')) {
    throw new Error('CSV must include Customer ID (required with Invoice Number for matching).');
  }

  const hasLineItemColumns = LINE_ITEM_FIELDS.some(f => presentFields.includes(f));
  const groups = new Map<string, InvoiceCsvGrouped>();
  let rawRowCount = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i], delimiter);
    const row = new Map<InvoiceCsvField, string>();
    let any = false;
    columnMap.forEach((field, idx) => {
      if (!field) return;
      const cell = String(cells[idx] ?? '').trim();
      if (cell) {
        row.set(field, cell);
        any = true;
      }
    });
    if (!any) continue;
    rawRowCount += 1;

    const invoiceId = firstNonEmpty(row, 'invoiceId');
    const customerId = firstNonEmpty(row, 'customerId');
    const invoiceNumber = firstNonEmpty(row, 'invoiceNumber');
    const key = invoiceId
      || (customerId && invoiceNumber ? `${customerId}::${invoiceNumber}` : null);
    if (!key) {
      throw new Error(
        `Row ${i + 1}: need Invoice ID, or Customer ID + Invoice Number.`,
      );
    }

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        invoiceId,
        customerId,
        sourceRows: [],
        header: {},
        lineItems: [],
        hasLineItemColumns,
      };
      groups.set(key, group);
    }
    group.sourceRows.push(i + 1);
    if (!group.invoiceId && invoiceId) group.invoiceId = invoiceId;
    if (!group.customerId && customerId) group.customerId = customerId;

    const h = group.header;
    const setStr = (field: keyof InvoiceCsvHeaderPatch, csvField: InvoiceCsvField) => {
      if (h[field] != null && h[field] !== '') return;
      const v = firstNonEmpty(row, csvField);
      if (v != null) (h as Record<string, unknown>)[field] = v;
    };
    const setDate = (field: 'date' | 'dueDate' | 'lastPaymentDate', csvField: InvoiceCsvField) => {
      if (h[field] != null && h[field] !== '') return;
      const v = normalizeInvoiceDate(firstNonEmpty(row, csvField));
      if (v != null) h[field] = v;
    };
    const setNum = (
      field: 'total' | 'balance' | 'subtotal' | 'taxTotal',
      csvField: InvoiceCsvField,
    ) => {
      if (h[field] != null) return;
      const n = parseNumber(firstNonEmpty(row, csvField));
      if (n != null) h[field] = n;
    };

    setStr('invoiceNumber', 'invoiceNumber');
    setDate('date', 'date');
    setDate('dueDate', 'dueDate');
    setStr('status', 'status');
    setNum('total', 'total');
    setNum('balance', 'balance');
    setNum('subtotal', 'subtotal');
    setNum('taxTotal', 'taxTotal');
    setStr('currencyCode', 'currencyCode');
    setStr('customerName', 'customerName');
    setStr('referenceNumber', 'referenceNumber');
    setDate('lastPaymentDate', 'lastPaymentDate');
    setStr('salespersonId', 'salespersonId');
    setStr('salespersonName', 'salespersonName');
    setStr('invoiceUrl', 'invoiceUrl');
    setStr('salesOrderId', 'salesOrderId');
    setStr('salesOrderNumber', 'salesOrderNumber');
    setStr('notes', 'notes');
    if (h.invoiceCategory == null) {
      const cat = parseCategory(firstNonEmpty(row, 'invoiceCategory'));
      if (cat) h.invoiceCategory = cat;
    }

    const itemName = firstNonEmpty(row, 'itemName');
    if (itemName) {
      const quantity = parseNumber(firstNonEmpty(row, 'quantity')) ?? 1;
      const rate = parseNumber(firstNonEmpty(row, 'rate')) ?? 0;
      const itemTotal = parseNumber(firstNonEmpty(row, 'itemTotal')) ?? quantity * rate;
      const itemId = firstNonEmpty(row, 'itemId');
      const lineItemId = firstNonEmpty(row, 'lineItemId')
        || itemId
        || `row-${i + 1}`;
      group.lineItems.push({
        id: lineItemId,
        itemId,
        name: itemName,
        description: firstNonEmpty(row, 'description'),
        sku: firstNonEmpty(row, 'sku'),
        quantity,
        rate,
        total: itemTotal,
        imageUrl: null,
        hsn: firstNonEmpty(row, 'hsn'),
        serialNumbers: parseSerialNumbers(firstNonEmpty(row, 'serialNumbers')),
      });
    }
  }

  return {
    groups: [...groups.values()],
    rawRowCount,
    presentFields,
  };
}

async function invoiceDocExists(
  customerId: string,
  invoiceId: string,
): Promise<boolean> {
  const snap = await getDoc(doc(db, 'zohoCustomers', customerId, 'invoices', invoiceId));
  return snap.exists();
}

export async function previewInvoiceCsvUpsert(
  groups: InvoiceCsvGrouped[],
): Promise<InvoiceCsvPreviewRow[]> {
  const results: InvoiceCsvPreviewRow[] = [];

  for (let i = 0; i < groups.length; i += 20) {
    const chunk = groups.slice(i, i + 20);
    const chunkResults = await Promise.all(chunk.map(async (group): Promise<InvoiceCsvPreviewRow> => {
      const invoiceNumber = group.header.invoiceNumber ?? null;
      const base = {
        key: group.key,
        invoiceId: group.invoiceId,
        customerId: group.customerId,
        invoiceNumber,
        lineItemCount: group.lineItems.length,
      };

      if (!group.invoiceId || !group.customerId) {
        return {
          ...base,
          action: 'error',
          message: 'Create/update requires Invoice ID and Customer ID on the CSV.',
        };
      }

      try {
        const exists = await invoiceDocExists(group.customerId, group.invoiceId);
        if (exists) {
          return {
            ...base,
            action: 'update',
            message: group.hasLineItemColumns && group.lineItems.length
              ? `Update header; replace ${group.lineItems.length} line item(s)`
              : 'Update header fields',
          };
        }

        const missing: string[] = [];
        if (!group.header.invoiceNumber) missing.push('Invoice Number');
        if (!group.header.date) missing.push('Invoice Date');
        if (group.header.total == null) missing.push('Total');
        if (missing.length) {
          return {
            ...base,
            action: 'error',
            message: `Create requires: ${missing.join(', ')}`,
          };
        }
        return {
          ...base,
          action: 'create',
          message: group.lineItems.length
            ? `Create with ${group.lineItems.length} line item(s)`
            : 'Create (no line items)',
        };
      } catch (err) {
        return {
          ...base,
          action: 'error',
          message: err instanceof Error ? err.message : 'Could not check existing invoice.',
        };
      }
    }));
    results.push(...chunkResults);
  }

  return results;
}

export type InvoiceCsvApplyPayloadInvoice = {
  invoiceId: string;
  customerId: string;
  header: InvoiceCsvHeaderPatch;
  lineItems: InvoiceCsvLineItem[] | null;
  replaceLineItems: boolean;
};

function toApplyPayload(group: InvoiceCsvGrouped): InvoiceCsvApplyPayloadInvoice | null {
  if (!group.invoiceId || !group.customerId) return null;
  return {
    invoiceId: group.invoiceId,
    customerId: group.customerId,
    header: group.header,
    lineItems: group.hasLineItemColumns ? group.lineItems : null,
    replaceLineItems: group.hasLineItemColumns,
  };
}

const APPLY_BATCH_SIZE = 40;

export async function applyInvoiceCsvUpsert(
  groups: InvoiceCsvGrouped[],
  options?: {
    onProgress?: (done: number, total: number, last: InvoiceCsvApplyBatchResult) => void;
  },
): Promise<InvoiceCsvApplyBatchResult> {
  const payloads = groups
    .map(toApplyPayload)
    .filter((p): p is InvoiceCsvApplyPayloadInvoice => p != null);

  const totals: InvoiceCsvApplyBatchResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const callable = httpsCallable<
    { invoices: InvoiceCsvApplyPayloadInvoice[] },
    InvoiceCsvApplyBatchResult
  >(functions, 'upsertInvoicesFromCsvFn', { timeout: 540_000 });

  for (let i = 0; i < payloads.length; i += APPLY_BATCH_SIZE) {
    const batch = payloads.slice(i, i + APPLY_BATCH_SIZE);
    try {
      const result = await callable({ invoices: batch });
      const data = result.data;
      totals.created += data.created ?? 0;
      totals.updated += data.updated ?? 0;
      totals.skipped += data.skipped ?? 0;
      totals.failed += data.failed ?? 0;
      if (Array.isArray(data.errors)) totals.errors.push(...data.errors);
      options?.onProgress?.(
        Math.min(i + batch.length, payloads.length),
        payloads.length,
        data,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch apply failed.';
      totals.failed += batch.length;
      for (const inv of batch) {
        totals.errors.push({
          invoiceId: inv.invoiceId,
          customerId: inv.customerId,
          message,
        });
      }
      options?.onProgress?.(
        Math.min(i + batch.length, payloads.length),
        payloads.length,
        {
          created: 0,
          updated: 0,
          skipped: 0,
          failed: batch.length,
          errors: [],
        },
      );
    }
  }

  return totals;
}
