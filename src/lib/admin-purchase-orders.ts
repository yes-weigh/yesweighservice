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
  normalizeInvoiceCategories,
  normalizeInvoiceCategoryAmounts,
  parseInvoiceCategory,
  sumInvoiceProductQuantity,
  firstDateTimeValue,
} from './invoices';
import type {
  DealerInvoiceLineItem,
  InvoiceCategory,
  InvoiceDocumentDownload,
  InvoiceSalesEntry,
  KpiPeriod,
} from '../types/invoices';

const functions = getFunctions(app, 'asia-south1');
const ADMIN_PO_PAGE_SIZE = 100;
const ADMIN_PO_AGGREGATE_MAX_ROWS = 2500;

export type AdminPurchaseOrderSort = 'syncedAt' | 'date';

export type AdminPurchaseOrderListQuery = {
  sort?: AdminPurchaseOrderSort;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  category?: InvoiceCategory | 'all';
  /** Inclusive YYYY-MM-DD */
  dateStart?: string | null;
  /** Inclusive YYYY-MM-DD */
  dateEnd?: string | null;
};

export interface AdminFirestorePurchaseOrder {
  id: string;
  purchaseOrderNumber: string;
  vendorId: string;
  vendorName: string | null;
  date: string | null;
  createdTime?: string | null;
  deliveryDate: string | null;
  status: string;
  total: number;
  balance: number;
  currencyCode: string;
  referenceNumber: string | null;
  syncedAt: string | null;
  itemQuantity: number | null;
  purchaseOrderCategory: InvoiceCategory | null;
  categories: InvoiceCategory[];
  categoryAmounts: Partial<Record<InvoiceCategory, number>>;
}

export interface AdminPurchaseOrderDetail {
  id: string;
  purchaseOrderNumber: string;
  date: string | null;
  deliveryDate: string | null;
  status: string;
  total: number;
  balance: number;
  referenceNumber: string | null;
  currencyCode: string;
  vendorId: string;
  vendorName: string | null;
  purchaseOrderCategory: InvoiceCategory | null;
  categories: InvoiceCategory[];
  categoryAmounts: Partial<Record<InvoiceCategory, number>>;
  subtotal: number;
  taxTotal: number;
  notes: string | null;
  lineItems: DealerInvoiceLineItem[];
}

export interface AdminPurchaseOrdersPageResult {
  rows: AdminFirestorePurchaseOrder[];
  docs: QueryDocumentSnapshot<DocumentData>[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
}

export type AdminPurchaseOrderCategoryCounts = {
  all: number;
  product: number;
  spare: number;
  software_key: number;
  service: number;
  gatc: number;
};

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

export function mapAdminPurchaseOrderDoc(
  docSnap: QueryDocumentSnapshot<DocumentData>,
): AdminFirestorePurchaseOrder {
  const data = docSnap.data();
  const lineItems = Array.isArray(data.lineItems)
    ? data.lineItems.map(item => mapLineItem(item as Record<string, unknown>))
    : [];
  return {
    id: docSnap.id,
    purchaseOrderNumber: String(data.purchaseOrderNumber ?? ''),
    vendorId: String(data.vendorId ?? ''),
    vendorName: data.vendorName ? String(data.vendorName) : null,
    date: data.date ? String(data.date) : null,
    createdTime: firstDateTimeValue(
      timestampToIso(data.createdTime),
      timestampToIso(data.zohoCreatedTime),
      timestampToIso(data.zohoLastModified),
    ),
    deliveryDate: data.deliveryDate ? String(data.deliveryDate) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    currencyCode: data.currencyCode ? String(data.currencyCode).toUpperCase() : 'INR',
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    syncedAt: timestampToIso(data.syncedAt),
    itemQuantity: lineItems.length
      ? sumInvoiceProductQuantity(lineItems)
      : (data.itemQuantity != null ? Number(data.itemQuantity) : null),
    purchaseOrderCategory: parseInvoiceCategory(data.purchaseOrderCategory),
    categories: normalizeInvoiceCategories(data.categories),
    categoryAmounts: normalizeInvoiceCategoryAmounts(data.categoryAmounts),
  };
}

/** Format a Date as local YYYY-MM-DD for Firestore string date fields. */
export function toPurchaseOrderDateKey(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildAdminPurchaseOrdersQuery(options: AdminPurchaseOrderListQuery) {
  const sort = options.sort ?? 'date';
  const pageSize = Math.max(1, Math.min(Number(options.pageSize ?? 25) || 25, 100));
  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const constraints: QueryConstraint[] = [];

  if (category && category !== 'all') {
    // Primary (high-value) category only — mixed POs with product + spare stay under product.
    constraints.push(where('purchaseOrderCategory', '==', category));
  }

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

  return query(collection(db, 'purchaseOrders'), ...constraints);
}

/** @deprecated Prefer buildAdminPurchaseOrdersQuery(options). */
export function buildAdminPurchaseOrdersQueryLegacy(
  sort: AdminPurchaseOrderSort,
  pageSize: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
) {
  return buildAdminPurchaseOrdersQuery({ sort, pageSize, cursor, category });
}

export function subscribeAdminPurchaseOrders(
  sort: AdminPurchaseOrderSort,
  pageSize: number,
  onData: (rows: AdminFirestorePurchaseOrder[]) => void,
  onError: (message: string) => void,
  category: InvoiceCategory | 'all' = 'all',
) {
  const q = buildAdminPurchaseOrdersQuery({ sort, pageSize, cursor: null, category });
  return onSnapshot(
    q,
    snap => {
      onData(snap.docs.map(mapAdminPurchaseOrderDoc));
    },
    err => {
      onError(err.message || 'Could not load purchase orders from Firestore.');
    },
  );
}

export async function fetchAdminPurchaseOrdersPageDetailed(
  options: AdminPurchaseOrderListQuery,
): Promise<AdminPurchaseOrdersPageResult> {
  const snap = await getDocs(buildAdminPurchaseOrdersQuery(options));
  return {
    rows: snap.docs.map(mapAdminPurchaseOrderDoc),
    docs: snap.docs,
    lastDoc: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
  };
}

export async function fetchAdminPurchaseOrdersPage(
  sortOrOptions: AdminPurchaseOrderSort | AdminPurchaseOrderListQuery,
  pageSize?: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
): Promise<AdminFirestorePurchaseOrder[]> {
  const options: AdminPurchaseOrderListQuery = typeof sortOrOptions === 'string'
    ? { sort: sortOrOptions, pageSize, cursor, category }
    : sortOrOptions;
  const result = await fetchAdminPurchaseOrdersPageDetailed(options);
  return result.rows;
}

export async function countAdminPurchaseOrders(
  options: Omit<AdminPurchaseOrderListQuery, 'pageSize' | 'cursor'>,
): Promise<number> {
  const sort = options.sort ?? 'date';
  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const constraints: QueryConstraint[] = [];

  if (category && category !== 'all') {
    constraints.push(where('purchaseOrderCategory', '==', category));
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

  const snap = await getCountFromServer(query(collection(db, 'purchaseOrders'), ...constraints));
  return snap.data().count;
}

export async function countAdminPurchaseOrdersByCategory(options: {
  dateStart?: string | null;
  dateEnd?: string | null;
}): Promise<AdminPurchaseOrderCategoryCounts> {
  const base = {
    dateStart: options.dateStart ?? null,
    dateEnd: options.dateEnd ?? null,
  } as const;

  const [all, product, spare, software_key, service, gatc] = await Promise.all([
    countAdminPurchaseOrders({ ...base, category: 'all' }),
    countAdminPurchaseOrders({ ...base, category: 'product' }),
    countAdminPurchaseOrders({ ...base, category: 'spare' }),
    countAdminPurchaseOrders({ ...base, category: 'software_key' }),
    countAdminPurchaseOrders({ ...base, category: 'service' }),
    countAdminPurchaseOrders({ ...base, category: 'gatc' }),
  ]);

  return { all, product, spare, software_key, service, gatc };
}

export function countPurchaseOrderRowsByCategory(
  rows: AdminFirestorePurchaseOrder[],
): AdminPurchaseOrderCategoryCounts {
  const counts: AdminPurchaseOrderCategoryCounts = {
    all: rows.length,
    product: 0,
    spare: 0,
    software_key: 0,
    service: 0,
    gatc: 0,
  };
  for (const row of rows) {
    const primary = row.purchaseOrderCategory
      ?? (row.categories.length ? row.categories[0] : null);
    if (primary && primary in counts) {
      counts[primary] += 1;
    }
  }
  return counts;
}

export async function fetchAllAdminPurchaseOrdersInRange(options: {
  sort?: AdminPurchaseOrderSort;
  category?: InvoiceCategory | 'all';
  dateStart?: string | null;
  dateEnd?: string | null;
  maxRows?: number;
}): Promise<{ rows: AdminFirestorePurchaseOrder[]; truncated: boolean }> {
  const maxRows = options.maxRows ?? ADMIN_PO_AGGREGATE_MAX_ROWS;
  const rows: AdminFirestorePurchaseOrder[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  let truncated = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await fetchAdminPurchaseOrdersPageDetailed({
      sort: options.sort ?? 'date',
      pageSize: ADMIN_PO_PAGE_SIZE,
      cursor,
      category: options.category ?? 'all',
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
    });
    if (!result.rows.length) break;
    rows.push(...result.rows);
    cursor = result.lastDoc;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    if (result.rows.length < ADMIN_PO_PAGE_SIZE) break;
  }

  return { rows: truncated ? rows.slice(0, maxRows) : rows, truncated };
}

export function filterAdminPurchaseOrders(
  rows: AdminFirestorePurchaseOrder[],
  searchText: string,
  category: InvoiceCategory | 'all' = 'all',
): AdminFirestorePurchaseOrder[] {
  let next = rows;
  if (category && category !== 'all') {
    next = next.filter(row => {
      const primary = row.purchaseOrderCategory
        ?? (row.categories.length ? row.categories[0] : null);
      return primary === category;
    });
  }
  const needle = searchText.trim().toLowerCase();
  if (!needle) return next;
  return next.filter(row => {
    const haystack = [
      row.purchaseOrderNumber,
      row.vendorName,
      row.vendorId,
      row.referenceNumber,
      row.id,
      row.status,
      row.purchaseOrderCategory,
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

export function filterAdminPurchaseOrdersByPeriod(
  rows: AdminFirestorePurchaseOrder[],
  period: KpiPeriod,
): AdminFirestorePurchaseOrder[] {
  const bounds = getInvoicePeriodBounds(period);
  if (!bounds) return rows;
  return rows.filter(row => {
    if (!row.date) return false;
    const ts = parsePoDay(row.date);
    if (Number.isNaN(ts)) return false;
    return ts >= bounds.start.getTime() && ts <= bounds.end.getTime();
  });
}

export function buildAdminPurchaseOrderSalesEntries(
  rows: AdminFirestorePurchaseOrder[],
): InvoiceSalesEntry[] {
  return rows
    .filter(row => row.date)
    .map(row => ({ date: row.date!, total: row.total }));
}

export function mapAdminPurchaseOrderDetail(
  poId: string,
  data: DocumentData,
): AdminPurchaseOrderDetail {
  return {
    id: String(data.id ?? poId),
    purchaseOrderNumber: String(data.purchaseOrderNumber ?? ''),
    date: data.date ? String(data.date) : null,
    deliveryDate: data.deliveryDate ? String(data.deliveryDate) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    currencyCode: data.currencyCode ? String(data.currencyCode).toUpperCase() : 'INR',
    vendorId: String(data.vendorId ?? ''),
    vendorName: data.vendorName ? String(data.vendorName) : null,
    purchaseOrderCategory: parseInvoiceCategory(data.purchaseOrderCategory),
    categories: normalizeInvoiceCategories(data.categories),
    categoryAmounts: normalizeInvoiceCategoryAmounts(data.categoryAmounts),
    subtotal: Number(data.subtotal ?? 0),
    taxTotal: Number(data.taxTotal ?? 0),
    notes: data.notes ? String(data.notes) : null,
    lineItems: Array.isArray(data.lineItems)
      ? data.lineItems.map(item => mapLineItem(item as Record<string, unknown>))
      : [],
  };
}

export async function fetchAdminPurchaseOrderDetail(
  purchaseOrderId: string,
): Promise<AdminPurchaseOrderDetail> {
  const snap = await getDoc(doc(db, 'purchaseOrders', purchaseOrderId));
  if (!snap.exists()) {
    throw new Error('Purchase order not found.');
  }
  const detail = mapAdminPurchaseOrderDetail(purchaseOrderId, snap.data());
  const withImages = await enrichInvoiceDetailImages({
    ...detail,
    invoiceNumber: detail.purchaseOrderNumber,
    dueDate: detail.deliveryDate,
    lastPaymentDate: null,
    customerName: detail.vendorName,
    invoiceUrl: null,
    salesOrderId: null,
    salesOrderNumber: null,
  });
  return {
    ...detail,
    lineItems: withImages.lineItems,
  };
}

export async function downloadPurchaseOrderDocument(
  purchaseOrderId: string,
): Promise<InvoiceDocumentDownload> {
  const callable = httpsCallable<
    { purchaseOrderId: string },
    InvoiceDocumentDownload
  >(
    functions,
    'downloadPurchaseOrderDocument',
    { timeout: 60_000 },
  );
  try {
    const result = await callable({ purchaseOrderId });
    return result.data;
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}
