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
  invoiceHasCategory,
  invoiceErrorMessage,
  normalizeInvoiceCategories,
  normalizeInvoiceCategoryAmounts,
  parseInvoiceCategory,
  sumInvoiceProductQuantity,
} from './invoices';
import type {
  DealerInvoiceLineItem,
  InvoiceCategory,
  InvoiceDocumentDownload,
  InvoiceSalesEntry,
  KpiPeriod,
} from '../types/invoices';

const functions = getFunctions(app, 'asia-south1');
const ADMIN_GR_PAGE_SIZE = 100;
const ADMIN_GR_AGGREGATE_MAX_ROWS = 2500;

export type AdminGoodsReceiptSort = 'syncedAt' | 'date';

export type AdminGoodsReceiptListQuery = {
  sort?: AdminGoodsReceiptSort;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  category?: InvoiceCategory | 'all';
  /** Inclusive YYYY-MM-DD */
  dateStart?: string | null;
  /** Inclusive YYYY-MM-DD */
  dateEnd?: string | null;
};

export interface AdminFirestoreGoodsReceipt {
  id: string;
  billNumber: string;
  vendorId: string;
  vendorName: string | null;
  date: string | null;
  dueDate: string | null;
  status: string;
  total: number;
  balance: number;
  currencyCode: string;
  referenceNumber: string | null;
  syncedAt: string | null;
  itemQuantity: number | null;
  goodsReceiptCategory: InvoiceCategory | null;
  categories: InvoiceCategory[];
  categoryAmounts: Partial<Record<InvoiceCategory, number>>;
}

export interface AdminGoodsReceiptDetail {
  id: string;
  billNumber: string;
  date: string | null;
  dueDate: string | null;
  status: string;
  total: number;
  balance: number;
  referenceNumber: string | null;
  currencyCode: string;
  vendorId: string;
  vendorName: string | null;
  goodsReceiptCategory: InvoiceCategory | null;
  categories: InvoiceCategory[];
  categoryAmounts: Partial<Record<InvoiceCategory, number>>;
  subtotal: number;
  taxTotal: number;
  notes: string | null;
  lineItems: DealerInvoiceLineItem[];
}

export interface AdminGoodsReceiptsPageResult {
  rows: AdminFirestoreGoodsReceipt[];
  docs: QueryDocumentSnapshot<DocumentData>[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
}

export type AdminGoodsReceiptCategoryCounts = {
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

export function mapAdminGoodsReceiptDoc(
  docSnap: QueryDocumentSnapshot<DocumentData>,
): AdminFirestoreGoodsReceipt {
  const data = docSnap.data();
  const lineItems = Array.isArray(data.lineItems)
    ? data.lineItems.map(item => mapLineItem(item as Record<string, unknown>))
    : [];
  return {
    id: docSnap.id,
    billNumber: String(data.billNumber ?? ''),
    vendorId: String(data.vendorId ?? ''),
    vendorName: data.vendorName ? String(data.vendorName) : null,
    date: data.date ? String(data.date) : null,
    dueDate: data.dueDate ? String(data.dueDate) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    currencyCode: data.currencyCode ? String(data.currencyCode).toUpperCase() : 'INR',
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    syncedAt: timestampToIso(data.syncedAt),
    itemQuantity: lineItems.length
      ? sumInvoiceProductQuantity(lineItems)
      : (data.itemQuantity != null ? Number(data.itemQuantity) : null),
    goodsReceiptCategory: parseInvoiceCategory(data.goodsReceiptCategory),
    categories: normalizeInvoiceCategories(data.categories),
    categoryAmounts: normalizeInvoiceCategoryAmounts(data.categoryAmounts),
  };
}

/** Format a Date as local YYYY-MM-DD for Firestore string date fields. */
export function toGoodsReceiptDateKey(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildAdminGoodsReceiptsQuery(options: AdminGoodsReceiptListQuery) {
  const sort = options.sort ?? 'date';
  const pageSize = Math.max(1, Math.min(Number(options.pageSize ?? 25) || 25, 100));
  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const constraints: QueryConstraint[] = [];

  if (category && category !== 'all') {
    constraints.push(where('categories', 'array-contains', category));
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

  return query(collection(db, 'goodsReceipts'), ...constraints);
}

/** @deprecated Prefer buildAdminGoodsReceiptsQuery(options). */
export function buildAdminGoodsReceiptsQueryLegacy(
  sort: AdminGoodsReceiptSort,
  pageSize: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
) {
  return buildAdminGoodsReceiptsQuery({ sort, pageSize, cursor, category });
}

export function subscribeAdminGoodsReceipts(
  sort: AdminGoodsReceiptSort,
  pageSize: number,
  onData: (rows: AdminFirestoreGoodsReceipt[]) => void,
  onError: (message: string) => void,
  category: InvoiceCategory | 'all' = 'all',
) {
  const q = buildAdminGoodsReceiptsQuery({ sort, pageSize, cursor: null, category });
  return onSnapshot(
    q,
    snap => {
      onData(snap.docs.map(mapAdminGoodsReceiptDoc));
    },
    err => {
      onError(err.message || 'Could not load goods receipts from Firestore.');
    },
  );
}

export async function fetchAdminGoodsReceiptsPageDetailed(
  options: AdminGoodsReceiptListQuery,
): Promise<AdminGoodsReceiptsPageResult> {
  const snap = await getDocs(buildAdminGoodsReceiptsQuery(options));
  return {
    rows: snap.docs.map(mapAdminGoodsReceiptDoc),
    docs: snap.docs,
    lastDoc: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
  };
}

export async function fetchAdminGoodsReceiptsPage(
  sortOrOptions: AdminGoodsReceiptSort | AdminGoodsReceiptListQuery,
  pageSize?: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
): Promise<AdminFirestoreGoodsReceipt[]> {
  const options: AdminGoodsReceiptListQuery = typeof sortOrOptions === 'string'
    ? { sort: sortOrOptions, pageSize, cursor, category }
    : sortOrOptions;
  const result = await fetchAdminGoodsReceiptsPageDetailed(options);
  return result.rows;
}

export async function countAdminGoodsReceipts(
  options: Omit<AdminGoodsReceiptListQuery, 'pageSize' | 'cursor'>,
): Promise<number> {
  const sort = options.sort ?? 'date';
  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const constraints: QueryConstraint[] = [];

  if (category && category !== 'all') {
    constraints.push(where('categories', 'array-contains', category));
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

  const snap = await getCountFromServer(query(collection(db, 'goodsReceipts'), ...constraints));
  return snap.data().count;
}

export async function countAdminGoodsReceiptsByCategory(options: {
  dateStart?: string | null;
  dateEnd?: string | null;
}): Promise<AdminGoodsReceiptCategoryCounts> {
  const base = {
    dateStart: options.dateStart ?? null,
    dateEnd: options.dateEnd ?? null,
  } as const;

  const [all, product, spare, software_key, service, gatc] = await Promise.all([
    countAdminGoodsReceipts({ ...base, category: 'all' }),
    countAdminGoodsReceipts({ ...base, category: 'product' }),
    countAdminGoodsReceipts({ ...base, category: 'spare' }),
    countAdminGoodsReceipts({ ...base, category: 'software_key' }),
    countAdminGoodsReceipts({ ...base, category: 'service' }),
    countAdminGoodsReceipts({ ...base, category: 'gatc' }),
  ]);

  return { all, product, spare, software_key, service, gatc };
}

export function countGoodsReceiptRowsByCategory(
  rows: AdminFirestoreGoodsReceipt[],
): AdminGoodsReceiptCategoryCounts {
  const counts: AdminGoodsReceiptCategoryCounts = {
    all: rows.length,
    product: 0,
    spare: 0,
    software_key: 0,
    service: 0,
    gatc: 0,
  };
  for (const row of rows) {
    const categories = row.categories.length
      ? row.categories
      : (row.goodsReceiptCategory ? [row.goodsReceiptCategory] : []);
    for (const key of categories) {
      counts[key] += 1;
    }
  }
  return counts;
}

export async function fetchAllAdminGoodsReceiptsInRange(options: {
  sort?: AdminGoodsReceiptSort;
  category?: InvoiceCategory | 'all';
  dateStart?: string | null;
  dateEnd?: string | null;
  maxRows?: number;
}): Promise<{ rows: AdminFirestoreGoodsReceipt[]; truncated: boolean }> {
  const maxRows = options.maxRows ?? ADMIN_GR_AGGREGATE_MAX_ROWS;
  const rows: AdminFirestoreGoodsReceipt[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  let truncated = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await fetchAdminGoodsReceiptsPageDetailed({
      sort: options.sort ?? 'date',
      pageSize: ADMIN_GR_PAGE_SIZE,
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
    if (result.rows.length < ADMIN_GR_PAGE_SIZE) break;
  }

  return { rows: truncated ? rows.slice(0, maxRows) : rows, truncated };
}

export function filterAdminGoodsReceipts(
  rows: AdminFirestoreGoodsReceipt[],
  searchText: string,
  category: InvoiceCategory | 'all' = 'all',
): AdminFirestoreGoodsReceipt[] {
  let next = rows;
  if (category && category !== 'all') {
    next = next.filter(row => invoiceHasCategory({
      categories: row.categories,
      invoiceCategory: row.goodsReceiptCategory,
    }, category));
  }
  const needle = searchText.trim().toLowerCase();
  if (!needle) return next;
  return next.filter(row => {
    const haystack = [
      row.billNumber,
      row.vendorName,
      row.vendorId,
      row.referenceNumber,
      row.id,
      row.status,
      row.goodsReceiptCategory,
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

export function filterAdminGoodsReceiptsByPeriod(
  rows: AdminFirestoreGoodsReceipt[],
  period: KpiPeriod,
): AdminFirestoreGoodsReceipt[] {
  const bounds = getInvoicePeriodBounds(period);
  if (!bounds) return rows;
  return rows.filter(row => {
    if (!row.date) return false;
    const ts = parsePoDay(row.date);
    if (Number.isNaN(ts)) return false;
    return ts >= bounds.start.getTime() && ts <= bounds.end.getTime();
  });
}

export function buildAdminGoodsReceiptSalesEntries(
  rows: AdminFirestoreGoodsReceipt[],
): InvoiceSalesEntry[] {
  return rows
    .filter(row => row.date)
    .map(row => ({ date: row.date!, total: row.total }));
}

export function mapAdminGoodsReceiptDetail(
  poId: string,
  data: DocumentData,
): AdminGoodsReceiptDetail {
  return {
    id: String(data.id ?? poId),
    billNumber: String(data.billNumber ?? ''),
    date: data.date ? String(data.date) : null,
    dueDate: data.dueDate ? String(data.dueDate) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    currencyCode: data.currencyCode ? String(data.currencyCode).toUpperCase() : 'INR',
    vendorId: String(data.vendorId ?? ''),
    vendorName: data.vendorName ? String(data.vendorName) : null,
    goodsReceiptCategory: parseInvoiceCategory(data.goodsReceiptCategory),
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

export async function fetchAdminGoodsReceiptDetail(
  goodsReceiptId: string,
): Promise<AdminGoodsReceiptDetail> {
  const snap = await getDoc(doc(db, 'goodsReceipts', goodsReceiptId));
  if (!snap.exists()) {
    throw new Error('Goods receipt not found.');
  }
  const detail = mapAdminGoodsReceiptDetail(goodsReceiptId, snap.data());
  const withImages = await enrichInvoiceDetailImages({
    ...detail,
    invoiceNumber: detail.billNumber,
    dueDate: detail.dueDate,
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

export async function downloadGoodsReceiptDocument(
  goodsReceiptId: string,
): Promise<InvoiceDocumentDownload> {
  const callable = httpsCallable<
    { goodsReceiptId: string },
    InvoiceDocumentDownload
  >(
    functions,
    'downloadGoodsReceiptDocument',
    { timeout: 60_000 },
  );
  try {
    const result = await callable({ goodsReceiptId });
    return result.data;
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}
