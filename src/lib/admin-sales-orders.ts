import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, app } from '../firebase';
import { enrichInvoiceDetailImages } from './invoiceLineItemImages';
import {
  getInvoicePeriodBounds,
  invoiceErrorMessage,
  parseInvoiceCategory,
  sumInvoiceProductQuantity,
} from './invoices';
import {
  appendSalespersonIdConstraint,
  filterRowsBySalespersonScope,
} from './salespersonScope';
import type {
  DealerInvoiceLineItem,
  InvoiceCategory,
  InvoiceDocumentDownload,
  InvoiceSalesEntry,
  KpiPeriod,
} from '../types/invoices';

const functions = getFunctions(app, 'asia-south1');

export type AdminSalesOrderSort = 'syncedAt' | 'date';

export type AdminSalesOrderListQuery = {
  sort?: AdminSalesOrderSort;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  category?: InvoiceCategory | 'all';
  /** Inclusive YYYY-MM-DD */
  dateStart?: string | null;
  /** Inclusive YYYY-MM-DD */
  dateEnd?: string | null;
  statusIn?: readonly string[] | null;
  /**
   * When set, restrict to these Zoho salesperson ids.
   * Empty array → no results. Omit / null → org-wide (super admin).
   */
  salespersonIds?: string[] | null;
};

/** Zoho SO statuses treated as finished in the unified pipeline. */
export const ZOHO_DONE_STATUSES = ['fulfilled', 'closed', 'invoiced', 'shipped'] as const;
/** Zoho SO statuses treated as rejected/void. */
export const ZOHO_REJECTED_STATUSES = ['void', 'cancelled', 'canceled'] as const;
/** Active / open Zoho SO statuses (unified "SO" stage). */
export const ZOHO_OPEN_STATUSES = [
  'draft',
  'open',
  'confirmed',
  'approved',
  'partially_invoiced',
  'overdue',
  'pending',
] as const;

export interface AdminFirestoreSalesOrder {
  id: string;
  salesOrderNumber: string;
  customerId: string;
  customerName: string | null;
  /** Zoho Inventory salesperson (KAM) id/name when present on the SO. */
  salespersonId?: string | null;
  salespersonName?: string | null;
  date: string | null;
  shipmentDate: string | null;
  status: string;
  total: number;
  balance: number;
  currencyCode: string;
  referenceNumber: string | null;
  syncedAt: string | null;
  itemQuantity: number | null;
  salesOrderCategory: InvoiceCategory | null;
  /** YesOne workflow stage on the SO mirror (null for legacy sync-only rows). */
  yesOneStage?: string | null;
  /** True when this Draft SO was created from a dealer cart submit. */
  yesOneCreatedFromCart?: boolean;
}

export interface AdminSalesOrderDetail {
  id: string;
  salesOrderNumber: string;
  date: string | null;
  shipmentDate: string | null;
  status: string;
  total: number;
  balance: number;
  referenceNumber: string | null;
  currencyCode: string;
  customerId: string;
  customerName: string | null;
  salespersonId?: string | null;
  salespersonName?: string | null;
  /** Formatted shipping address from the SO or customer record. */
  shippingAddress?: string | null;
  shippingAddressId?: string | null;
  salesOrderCategory: InvoiceCategory | null;
  subtotal: number;
  taxTotal: number;
  notes: string | null;
  lineItems: DealerInvoiceLineItem[];
  yesOneStage?: string | null;
  paymentAmount?: number | null;
  paymentUtr?: string | null;
  paymentScreenshotStoragePath?: string | null;
  paymentScreenshotUrl?: string | null;
  paymentSubmittedAt?: string | null;
  paymentVerifiedAt?: string | null;
  readyForPaymentAt?: string | null;
  readyForPaymentByName?: string | null;
  zohoInvoiceId?: string | null;
  zohoInvoiceNumber?: string | null;
}

export interface AdminSalesOrdersPageResult {
  rows: AdminFirestoreSalesOrder[];
  docs: QueryDocumentSnapshot<DocumentData>[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
}

function timestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function mapLineItem(raw: Record<string, unknown>): DealerInvoiceLineItem {
  return {
    id: String(raw.id ?? ''),
    itemId: raw.itemId ? String(raw.itemId) : null,
    name: String(raw.name ?? 'Item'),
    description: raw.description ? String(raw.description) : null,
    sku: raw.sku ? String(raw.sku) : null,
    quantity: Number(raw.quantity ?? 0),
    rate: Number(raw.rate ?? 0),
    total: Number(raw.total ?? 0),
    imageUrl: raw.imageUrl ? String(raw.imageUrl) : null,
    hsn: raw.hsn != null && String(raw.hsn).trim() ? String(raw.hsn) : null,
  };
}

export function mapAdminSalesOrderDoc(
  docSnap: QueryDocumentSnapshot<DocumentData>,
): AdminFirestoreSalesOrder {
  const data = docSnap.data();
  const lineItems = Array.isArray(data.lineItems)
    ? data.lineItems.map(item => mapLineItem(item as Record<string, unknown>))
    : [];
  return {
    id: docSnap.id,
    salesOrderNumber: String(data.salesOrderNumber ?? ''),
    customerId: String(data.customerId ?? ''),
    customerName: data.customerName ? String(data.customerName) : null,
    salespersonId: data.salespersonId ? String(data.salespersonId) : null,
    salespersonName: data.salespersonName ? String(data.salespersonName) : null,
    date: data.date ? String(data.date) : null,
    shipmentDate: data.shipmentDate ? String(data.shipmentDate) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    currencyCode: data.currencyCode ? String(data.currencyCode).toUpperCase() : 'INR',
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    syncedAt: timestampToIso(data.syncedAt),
    itemQuantity: lineItems.length
      ? sumInvoiceProductQuantity(lineItems)
      : (data.itemQuantity != null ? Number(data.itemQuantity) : null),
    salesOrderCategory: parseInvoiceCategory(data.salesOrderCategory),
    yesOneStage: data.yesOneStage ? String(data.yesOneStage) : null,
    yesOneCreatedFromCart: Boolean(data.yesOneCreatedFromCart),
  };
}

/** Format a Date as local YYYY-MM-DD for Firestore string date fields. */
export function toSalesOrderDateKey(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildAdminSalesOrdersQuery(options: AdminSalesOrderListQuery) {
  const sort = options.sort ?? 'date';
  const pageSize = Math.max(1, Math.min(Number(options.pageSize ?? 25) || 25, 100));
  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const statusIn = options.statusIn?.length ? [...options.statusIn] : null;
  const constraints: QueryConstraint[] = [];

  if (appendSalespersonIdConstraint(constraints, options.salespersonIds) === 'empty') {
    // Impossible match so callers that ignore empty-scope still get zero docs.
    constraints.push(where('salespersonId', '==', '__none__'));
  }

  if (category && category !== 'all') {
    constraints.push(where('salesOrderCategory', '==', category));
  }
  if (statusIn) {
    constraints.push(where('status', 'in', statusIn.slice(0, 10)));
  }

  // Date range forces orderBy('date') so inequality + orderBy stay on the same field.
  if (dateStart || dateEnd) {
    if (dateStart) constraints.push(where('date', '>=', dateStart));
    if (dateEnd) constraints.push(where('date', '<=', dateEnd));
    constraints.push(orderBy('date', 'desc'));
  } else {
    const field = sort === 'syncedAt' ? 'syncedAt' : 'date';
    constraints.push(orderBy(field, 'desc'));
  }

  if (options.cursor) constraints.push(startAfter(options.cursor));
  constraints.push(limit(pageSize));

  return query(collection(db, 'salesOrders'), ...constraints);
}

/** @deprecated Prefer buildAdminSalesOrdersQuery(options). */
export function buildAdminSalesOrdersQueryLegacy(
  sort: AdminSalesOrderSort,
  pageSize: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
) {
  return buildAdminSalesOrdersQuery({ sort, pageSize, cursor, category });
}

export function subscribeAdminSalesOrders(
  sort: AdminSalesOrderSort,
  pageSize: number,
  onData: (rows: AdminFirestoreSalesOrder[]) => void,
  onError: (message: string) => void,
  category: InvoiceCategory | 'all' = 'all',
) {
  const q = buildAdminSalesOrdersQuery({ sort, pageSize, cursor: null, category });
  return onSnapshot(
    q,
    snap => {
      onData(snap.docs.map(mapAdminSalesOrderDoc));
    },
    err => {
      onError(err.message || 'Could not load Sales orders from Firestore.');
    },
  );
}

export async function fetchAdminSalesOrdersPage(
  sortOrOptions: AdminSalesOrderSort | AdminSalesOrderListQuery,
  pageSize?: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
): Promise<AdminFirestoreSalesOrder[]> {
  const options: AdminSalesOrderListQuery = typeof sortOrOptions === 'string'
    ? { sort: sortOrOptions, pageSize, cursor, category }
    : sortOrOptions;
  const result = await fetchAdminSalesOrdersPageDetailed(options);
  return result.rows;
}

export async function fetchAdminSalesOrdersPageDetailed(
  options: AdminSalesOrderListQuery,
): Promise<AdminSalesOrdersPageResult> {
  if (
    options.salespersonIds != null
    && appendSalespersonIdConstraint([], options.salespersonIds) === 'empty'
  ) {
    return { rows: [], docs: [], lastDoc: null };
  }
  const snap = await getDocs(buildAdminSalesOrdersQuery(options));
  return {
    rows: snap.docs.map(mapAdminSalesOrderDoc),
    docs: snap.docs,
    lastDoc: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
  };
}

export async function countAdminSalesOrders(
  options: Omit<AdminSalesOrderListQuery, 'pageSize' | 'cursor'>,
): Promise<number> {
  if (
    options.salespersonIds != null
    && appendSalespersonIdConstraint([], options.salespersonIds) === 'empty'
  ) {
    return 0;
  }

  const sort = options.sort ?? 'date';
  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const statusIn = options.statusIn?.length ? [...options.statusIn] : null;
  const constraints: QueryConstraint[] = [];

  if (appendSalespersonIdConstraint(constraints, options.salespersonIds) === 'empty') {
    return 0;
  }
  if (category && category !== 'all') {
    constraints.push(where('salesOrderCategory', '==', category));
  }
  if (statusIn) {
    constraints.push(where('status', 'in', statusIn.slice(0, 10)));
  }
  if (dateStart || dateEnd) {
    if (dateStart) constraints.push(where('date', '>=', dateStart));
    if (dateEnd) constraints.push(where('date', '<=', dateEnd));
    constraints.push(orderBy('date', 'desc'));
  } else if (sort === 'syncedAt') {
    constraints.push(orderBy('syncedAt', 'desc'));
  } else {
    constraints.push(orderBy('date', 'desc'));
  }

  const countQuery = query(collection(db, 'salesOrders'), ...constraints);
  const snap = await getCountFromServer(countQuery);
  return snap.data().count;
}

export async function countAdminSalesOrdersByUnifiedStages(options: {
  category?: InvoiceCategory | 'all';
  dateStart?: string | null;
  dateEnd?: string | null;
  salespersonIds?: string[] | null;
}): Promise<{ all: number; so: number; done: number; rejected: number }> {
  const base = {
    category: options.category ?? 'all',
    dateStart: options.dateStart ?? null,
    dateEnd: options.dateEnd ?? null,
    salespersonIds: options.salespersonIds ?? null,
  } as const;

  const [all, so, done, rejected] = await Promise.all([
    countAdminSalesOrders(base),
    countAdminSalesOrders({ ...base, statusIn: ZOHO_OPEN_STATUSES }),
    countAdminSalesOrders({ ...base, statusIn: ZOHO_DONE_STATUSES }),
    countAdminSalesOrders({ ...base, statusIn: ZOHO_REJECTED_STATUSES }),
  ]);

  return { all, so, done, rejected };
}

export type AdminSalesOrderCategoryCounts = {
  all: number;
  product: number;
  spare: number;
  software_key: number;
  service: number;
  gatc: number;
};

export async function countAdminSalesOrdersByCategory(options: {
  dateStart?: string | null;
  dateEnd?: string | null;
  salespersonIds?: string[] | null;
}): Promise<AdminSalesOrderCategoryCounts> {
  const base = {
    dateStart: options.dateStart ?? null,
    dateEnd: options.dateEnd ?? null,
    salespersonIds: options.salespersonIds ?? null,
  } as const;

  const [all, product, spare, software_key, service, gatc] = await Promise.all([
    countAdminSalesOrders({ ...base, category: 'all' }),
    countAdminSalesOrders({ ...base, category: 'product' }),
    countAdminSalesOrders({ ...base, category: 'spare' }),
    countAdminSalesOrders({ ...base, category: 'software_key' }),
    countAdminSalesOrders({ ...base, category: 'service' }),
    countAdminSalesOrders({ ...base, category: 'gatc' }),
  ]);

  return { all, product, spare, software_key, service, gatc };
}

export function countZohoRowsByCategory(
  rows: AdminFirestoreSalesOrder[],
): AdminSalesOrderCategoryCounts {
  const counts: AdminSalesOrderCategoryCounts = {
    all: rows.length,
    product: 0,
    spare: 0,
    software_key: 0,
    service: 0,
    gatc: 0,
  };
  for (const row of rows) {
    const key = row.salesOrderCategory;
    if (
      key === 'product'
      || key === 'spare'
      || key === 'software_key'
      || key === 'service'
      || key === 'gatc'
    ) {
      counts[key] += 1;
    }
  }
  return counts;
}

/**
 * Load Zoho SOs for one or more dealers (newest-first per customer), then merge.
 * Used when the admin filter sheet selects specific dealers — avoids org-wide
 * pagination missing the chosen customers.
 */
export async function fetchAdminSalesOrdersForCustomers(options: {
  customerIds: string[];
  dateStart?: string | null;
  dateEnd?: string | null;
  category?: InvoiceCategory | 'all';
  statusIn?: readonly string[] | null;
  sort?: AdminSalesOrderSort;
  maxPerCustomer?: number;
  salespersonIds?: string[] | null;
}): Promise<AdminFirestoreSalesOrder[]> {
  const ids = [...new Set(
    options.customerIds.map(id => String(id ?? '').trim()).filter(Boolean),
  )];
  if (!ids.length) return [];
  if (
    options.salespersonIds != null
    && appendSalespersonIdConstraint([], options.salespersonIds) === 'empty'
  ) {
    return [];
  }

  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const sort = options.sort ?? 'date';
  const maxPerCustomer = Math.min(Math.max(Number(options.maxPerCustomer ?? 500) || 500, 1), 2000);
  const pageSize = 100;

  const perCustomer = await Promise.all(ids.map(async customerId => {
    const rows: AdminFirestoreSalesOrder[] = [];
    let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

    while (rows.length < maxPerCustomer) {
      const constraints: QueryConstraint[] = [where('customerId', '==', customerId)];
      if (appendSalespersonIdConstraint(constraints, options.salespersonIds) === 'empty') {
        return [];
      }
      if (dateStart) constraints.push(where('date', '>=', dateStart));
      if (dateEnd) constraints.push(where('date', '<=', dateEnd));
      if (dateStart || dateEnd || sort !== 'syncedAt') {
        constraints.push(orderBy('date', 'desc'));
      } else {
        constraints.push(orderBy('syncedAt', 'desc'));
      }
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(Math.min(pageSize, maxPerCustomer - rows.length)));

      const snap = await getDocs(query(collection(db, 'salesOrders'), ...constraints));
      if (snap.empty) break;
      rows.push(...snap.docs.map(mapAdminSalesOrderDoc));
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.size < pageSize) break;
    }
    return rows;
  }));

  let merged = filterRowsBySalespersonScope(perCustomer.flat(), options.salespersonIds);

  if (options.category && options.category !== 'all') {
    merged = merged.filter(row => row.salesOrderCategory === options.category);
  }
  if (options.statusIn?.length) {
    const allowed = new Set(options.statusIn.map(s => String(s).toLowerCase()));
    merged = merged.filter(row => allowed.has(String(row.status || '').toLowerCase()));
  }

  merged.sort((a, b) => {
    if (sort === 'syncedAt') {
      return String(b.syncedAt ?? '').localeCompare(String(a.syncedAt ?? ''));
    }
    const byDate = String(b.date ?? '').localeCompare(String(a.date ?? ''));
    if (byDate) return byDate;
    return String(b.syncedAt ?? '').localeCompare(String(a.syncedAt ?? ''));
  });

  return merged;
}

/** Stage counts from an already-loaded dealer-scoped Zoho list. */
export function countZohoRowsByUnifiedStages(
  rows: AdminFirestoreSalesOrder[],
): { all: number; so: number; done: number; rejected: number } {
  const open = new Set(ZOHO_OPEN_STATUSES.map(s => s.toLowerCase()));
  const done = new Set(ZOHO_DONE_STATUSES.map(s => s.toLowerCase()));
  const rejected = new Set(ZOHO_REJECTED_STATUSES.map(s => s.toLowerCase()));
  let so = 0;
  let doneCount = 0;
  let rejectedCount = 0;
  for (const row of rows) {
    const status = String(row.status || '').toLowerCase().replace(/\s+/g, '_');
    if (rejected.has(status) || status === 'cancelled' || status === 'canceled') {
      rejectedCount += 1;
    } else if (done.has(status) || status.includes('invoice')) {
      doneCount += 1;
    } else if (open.has(status) || status === 'draft') {
      so += 1;
    } else {
      so += 1;
    }
  }
  return { all: rows.length, so, done: doneCount, rejected: rejectedCount };
}



export function filterAdminSalesOrders(
  rows: AdminFirestoreSalesOrder[],
  searchText: string,
  category: InvoiceCategory | 'all' = 'all',
): AdminFirestoreSalesOrder[] {
  let next = rows;
  if (category && category !== 'all') {
    next = next.filter(row => row.salesOrderCategory === category);
  }
  const needle = searchText.trim().toLowerCase();
  if (!needle) return next;
  return next.filter(row => {
    const haystack = [
      row.salesOrderNumber,
      row.customerName,
      row.customerId,
      row.referenceNumber,
      row.id,
      row.status,
      row.salesOrderCategory,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function parsePoDay(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? NaN : ts;
}

export function filterAdminSalesOrdersByPeriod(
  rows: AdminFirestoreSalesOrder[],
  period: KpiPeriod,
): AdminFirestoreSalesOrder[] {
  const bounds = getInvoicePeriodBounds(period);
  if (!bounds) return rows;
  return rows.filter(row => {
    if (!row.date) return false;
    const ts = parsePoDay(row.date);
    if (Number.isNaN(ts)) return false;
    return ts >= bounds.start.getTime() && ts <= bounds.end.getTime();
  });
}

export function buildAdminSalesOrderSalesEntries(
  rows: AdminFirestoreSalesOrder[],
): InvoiceSalesEntry[] {
  return rows
    .filter(row => row.date)
    .map(row => ({ date: row.date!, total: row.total }));
}

export function mapAdminSalesOrderDetail(
  poId: string,
  data: DocumentData,
): AdminSalesOrderDetail {
  return {
    id: String(data.id ?? poId),
    salesOrderNumber: String(data.salesOrderNumber ?? ''),
    date: data.date ? String(data.date) : null,
    shipmentDate: data.shipmentDate ? String(data.shipmentDate) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    currencyCode: data.currencyCode ? String(data.currencyCode) : 'INR',
    customerId: String(data.customerId ?? ''),
    customerName: data.customerName ? String(data.customerName) : null,
    salespersonId: data.salespersonId ? String(data.salespersonId) : null,
    salespersonName: data.salespersonName ? String(data.salespersonName) : null,
    shippingAddress: data.shippingAddress ? String(data.shippingAddress) : null,
    shippingAddressId: data.shippingAddressId ? String(data.shippingAddressId) : null,
    salesOrderCategory: parseInvoiceCategory(data.salesOrderCategory),
    subtotal: Number(data.subtotal ?? 0),
    taxTotal: Number(data.taxTotal ?? 0),
    notes: data.notes ? String(data.notes) : null,
    lineItems: Array.isArray(data.lineItems)
      ? data.lineItems.map(item => mapLineItem(item as Record<string, unknown>))
      : [],
    yesOneStage: data.yesOneStage ? String(data.yesOneStage) : null,
    paymentAmount: data.paymentAmount != null ? Number(data.paymentAmount) : null,
    paymentUtr: data.paymentUtr ? String(data.paymentUtr) : null,
    paymentScreenshotStoragePath: data.paymentScreenshotStoragePath
      ? String(data.paymentScreenshotStoragePath)
      : null,
    paymentScreenshotUrl: data.paymentScreenshotUrl ? String(data.paymentScreenshotUrl) : null,
    paymentSubmittedAt: data.paymentSubmittedAt ? String(data.paymentSubmittedAt) : null,
    paymentVerifiedAt: data.paymentVerifiedAt ? String(data.paymentVerifiedAt) : null,
    readyForPaymentAt: data.readyForPaymentAt ? String(data.readyForPaymentAt) : null,
    readyForPaymentByName: data.readyForPaymentByName ? String(data.readyForPaymentByName) : null,
    zohoInvoiceId: data.zohoInvoiceId ? String(data.zohoInvoiceId) : null,
    zohoInvoiceNumber: data.zohoInvoiceNumber ? String(data.zohoInvoiceNumber) : null,
  };
}

async function resolveShippingAddressFallback(
  detail: AdminSalesOrderDetail,
): Promise<string | null> {
  if (detail.shippingAddress) return detail.shippingAddress;
  const customerId = String(detail.customerId || '').trim();
  if (!customerId) return null;
  try {
    const snap = await getDoc(doc(db, 'zohoCustomers', customerId));
    if (!snap.exists()) return null;
    const data = snap.data();
    const addr = data.zohoShippingAddress || data.shippingAddress;
    return addr ? String(addr) : null;
  } catch {
    return null;
  }
}

export async function fetchAdminSalesOrderDetail(
  salesOrderId: string,
): Promise<AdminSalesOrderDetail> {
  const snap = await getDoc(doc(db, 'salesOrders', salesOrderId));
  if (!snap.exists()) {
    throw new Error('Sales order not found.');
  }
  const detail = mapAdminSalesOrderDetail(salesOrderId, snap.data());
  const [withImages, shippingAddress] = await Promise.all([
    enrichInvoiceDetailImages({
      ...detail,
      invoiceNumber: detail.salesOrderNumber,
      dueDate: detail.shipmentDate,
      lastPaymentDate: null,
      customerName: detail.customerName,
      invoiceUrl: null,
      salesOrderId: null,
      salesOrderNumber: null,
    }),
    resolveShippingAddressFallback(detail),
  ]);
  return {
    ...detail,
    shippingAddress,
    lineItems: withImages.lineItems,
  };
}

export async function downloadSalesOrderDocument(
  salesOrderId: string,
): Promise<InvoiceDocumentDownload> {
  const callable = httpsCallable<
    { salesOrderId: string },
    InvoiceDocumentDownload
  >(
    functions,
    'downloadSalesOrderDocument',
    { timeout: 60_000 },
  );
  try {
    const result = await callable({ salesOrderId });
    return result.data;
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}
