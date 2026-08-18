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
  updateDoc,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, app, storage } from '../firebase';
import { formatStorageUploadError } from './storageErrors';
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

/** Portal list shows Zoho draft POs only. */
export const PORTAL_PURCHASE_ORDER_STATUS = 'draft';
/** Keep / show POs on or after this FY start. Older docs are deleted. */
export const PURCHASE_ORDER_KEEP_AFTER_DATE = '2026-04-01';
/** Older POs that must still appear in the portal. */
export const PURCHASE_ORDER_KEEP_NUMBERS = ['PO-00279', 'PO-00283'] as const;
/** POs that stay in Firebase but must not appear in the portal. */
export const PURCHASE_ORDER_HIDE_NUMBERS = ['PO-00307'] as const;

function normalizePurchaseOrderNumber(value?: string | null): string {
  return String(value ?? '').trim().toUpperCase();
}

export function isKeptPurchaseOrderNumber(value?: string | null): boolean {
  return PURCHASE_ORDER_KEEP_NUMBERS.includes(
    normalizePurchaseOrderNumber(value) as (typeof PURCHASE_ORDER_KEEP_NUMBERS)[number],
  );
}

export function isHiddenPurchaseOrderNumber(value?: string | null): boolean {
  return PURCHASE_ORDER_HIDE_NUMBERS.includes(
    normalizePurchaseOrderNumber(value) as (typeof PURCHASE_ORDER_HIDE_NUMBERS)[number],
  );
}

export function purchaseOrderVisibleInPortal(row: {
  date?: string | null;
  purchaseOrderNumber?: string | null;
}): boolean {
  if (isHiddenPurchaseOrderNumber(row.purchaseOrderNumber)) return false;
  if (isKeptPurchaseOrderNumber(row.purchaseOrderNumber)) return true;
  return String(row.date ?? '').trim().slice(0, 10) >= PURCHASE_ORDER_KEEP_AFTER_DATE;
}

function excludeHiddenPurchaseOrders(
  rows: AdminFirestorePurchaseOrder[],
): AdminFirestorePurchaseOrder[] {
  return rows.filter(row => !isHiddenPurchaseOrderNumber(row.purchaseOrderNumber));
}

export function clampPurchaseOrderDateStart(dateStart?: string | null): string {
  const start = String(dateStart ?? '').trim();
  if (!start || start < PURCHASE_ORDER_KEEP_AFTER_DATE) return PURCHASE_ORDER_KEEP_AFTER_DATE;
  return start;
}

export type AdminPurchaseOrderListQuery = {
  sort?: AdminPurchaseOrderSort;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  category?: InvoiceCategory | 'all';
  /** Inclusive YYYY-MM-DD */
  dateStart?: string | null;
  /** Inclusive YYYY-MM-DD */
  dateEnd?: string | null;
  /** Zoho status. Portal defaults to draft. */
  status?: string | null;
};

export interface AdminFirestorePurchaseOrder {
  id: string;
  purchaseOrderNumber: string;
  vendorId: string;
  vendorName: string | null;
  vendorState: string | null;
  vendorCountry: string | null;
  vendorCity: string | null;
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

export interface PurchaseOrderBl {
  containerNumber: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  uploadedAt: string | null;
}

export interface PurchaseOrderVendorPi {
  storagePath: string;
  fileName: string;
  contentType: string;
  uploadedAt: string | null;
}

export interface PurchaseOrderKotakPayout {
  transactionId: string;
  date: string | null;
  amountInr: number;
  amountUsd: number;
  usdToInrRate: number;
  bankCharges: number;
  zohoVendorPaymentId: string | null;
  payee: string | null;
  description: string | null;
  referenceNumber: string | null;
  associatedAt: string | null;
  associatedByName: string | null;
}

export interface PurchaseOrderTracking {
  poDate: string | null;
  paymentDate: string | null;
  loadingDate: string | null;
  sailingDate: string | null;
  arrivalDate: string | null;
  receivedDate: string | null;
}

export interface PurchaseOrderActivityLog {
  at: string;
  byName: string | null;
  action: string;
  detail: string;
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
  vendorCity: string | null;
  vendorState: string | null;
  vendorCountry: string | null;
  purchaseOrderCategory: InvoiceCategory | null;
  categories: InvoiceCategory[];
  categoryAmounts: Partial<Record<InvoiceCategory, number>>;
  subtotal: number;
  taxTotal: number;
  notes: string | null;
  lineItems: DealerInvoiceLineItem[];
  bl: PurchaseOrderBl | null;
  vendorPi: PurchaseOrderVendorPi | null;
  kotakPayout: PurchaseOrderKotakPayout | null;
  tracking: PurchaseOrderTracking;
  activityLogs: PurchaseOrderActivityLog[];
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
    vendorState: data.vendorState ? String(data.vendorState) : null,
    vendorCountry: data.vendorCountry ? String(data.vendorCountry) : null,
    vendorCity: data.vendorCity ? String(data.vendorCity) : null,
    date: data.date ? String(data.date) : null,
    createdTime: firstDateTimeValue(
      timestampToIso(data.createdTime),
      timestampToIso(data.zohoCreatedTime),
      timestampToIso(data.zohoLastModified),
    ),
    deliveryDate: data.deliveryDate ? String(data.deliveryDate) : null,
    status: String(data.status ?? 'draft').trim().toLowerCase(),
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
  const pageSize = Math.max(1, Math.min(Number(options.pageSize ?? 25) || 25, 100));
  const category = options.category ?? 'all';
  const dateStart = clampPurchaseOrderDateStart(options.dateStart);
  const dateEnd = options.dateEnd?.trim() || null;
  const status = String(options.status ?? PORTAL_PURCHASE_ORDER_STATUS).trim().toLowerCase();
  const constraints: QueryConstraint[] = [];

  if (status) constraints.push(where('status', '==', status));

  if (category && category !== 'all') {
    // Primary (high-value) category only — mixed POs with product + spare stay under product.
    constraints.push(where('purchaseOrderCategory', '==', category));
  }

  constraints.push(where('date', '>=', dateStart));
  if (dateEnd) constraints.push(where('date', '<=', dateEnd));
  constraints.push(orderBy('date', 'desc'));

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

function isFirestoreIndexError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /requires an index|currently building/i.test(msg);
}

function sortPurchaseOrdersByDateDesc(rows: AdminFirestorePurchaseOrder[]): AdminFirestorePurchaseOrder[] {
  return [...rows].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

export async function fetchKeptPurchaseOrders(): Promise<AdminFirestorePurchaseOrder[]> {
  if (!PURCHASE_ORDER_KEEP_NUMBERS.length) return [];
  const snap = await getDocs(
    query(
      collection(db, 'purchaseOrders'),
      where('purchaseOrderNumber', 'in', [...PURCHASE_ORDER_KEEP_NUMBERS]),
    ),
  );
  return snap.docs.map(mapAdminPurchaseOrderDoc);
}

function mergeKeptPurchaseOrders(
  rows: AdminFirestorePurchaseOrder[],
  kept: AdminFirestorePurchaseOrder[],
  options: { status?: string | null; category?: InvoiceCategory | 'all' } = {},
): AdminFirestorePurchaseOrder[] {
  const wanted = String(options.status ?? PORTAL_PURCHASE_ORDER_STATUS).trim().toLowerCase();
  const category = options.category ?? 'all';
  const extra = kept.filter(row => {
    if (isHiddenPurchaseOrderNumber(row.purchaseOrderNumber)) return false;
    if (wanted && row.status !== wanted) return false;
    if (category && category !== 'all') {
      const primary = row.purchaseOrderCategory
        ?? (row.categories.length ? row.categories[0] : null);
      if (primary !== category) return false;
    }
    return !rows.some(existing => existing.id === row.id);
  });
  if (!extra.length) return rows;
  return sortPurchaseOrdersByDateDesc([...rows, ...extra]);
}

export async function fetchAdminPurchaseOrdersPageDetailed(
  options: AdminPurchaseOrderListQuery,
): Promise<AdminPurchaseOrdersPageResult> {
  const mergeKept = !options.cursor;
  const kept = mergeKept ? await fetchKeptPurchaseOrders() : [];
  try {
    const snap = await getDocs(buildAdminPurchaseOrdersQuery(options));
    const rows = excludeHiddenPurchaseOrders(mergeKeptPurchaseOrders(
      snap.docs.map(mapAdminPurchaseOrderDoc),
      kept,
      { status: options.status, category: options.category },
    ));
    return {
      rows,
      docs: snap.docs,
      lastDoc: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    };
  } catch (err) {
    if (!isFirestoreIndexError(err)) throw err;
    const snap = await getDocs(buildAdminPurchaseOrdersQuery({ ...options, status: '' }));
    const wanted = String(options.status ?? PORTAL_PURCHASE_ORDER_STATUS).trim().toLowerCase();
    const rows = excludeHiddenPurchaseOrders(mergeKeptPurchaseOrders(
      snap.docs
        .map(mapAdminPurchaseOrderDoc)
        .filter(row => !wanted || row.status === wanted),
      kept,
      { status: options.status, category: options.category },
    ));
    return {
      rows,
      docs: snap.docs,
      lastDoc: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    };
  }
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
  const category = options.category ?? 'all';
  const dateStart = clampPurchaseOrderDateStart(options.dateStart);
  const dateEnd = options.dateEnd?.trim() || null;
  const status = String(options.status ?? PORTAL_PURCHASE_ORDER_STATUS).trim().toLowerCase();
  const constraints: QueryConstraint[] = [];

  if (status) constraints.push(where('status', '==', status));
  if (category && category !== 'all') {
    constraints.push(where('purchaseOrderCategory', '==', category));
  }
  constraints.push(where('date', '>=', dateStart));
  if (dateEnd) constraints.push(where('date', '<=', dateEnd));
  constraints.push(orderBy('date', 'desc'));

  try {
    const snap = await getCountFromServer(query(collection(db, 'purchaseOrders'), ...constraints));
    const kept = await fetchKeptPurchaseOrders();
    const extra = kept.filter(row => {
      if (isHiddenPurchaseOrderNumber(row.purchaseOrderNumber)) return false;
      if (status && row.status !== status) return false;
      if (category && category !== 'all') {
        const primary = row.purchaseOrderCategory
          ?? (row.categories.length ? row.categories[0] : null);
        if (primary !== category) return false;
      }
      const date = String(row.date ?? '').trim().slice(0, 10);
      if (date && date >= dateStart && (!dateEnd || date <= dateEnd)) return false;
      return true;
    }).length;
    const hidden = PURCHASE_ORDER_HIDE_NUMBERS.length
      ? await getDocs(query(
        collection(db, 'purchaseOrders'),
        where('purchaseOrderNumber', 'in', [...PURCHASE_ORDER_HIDE_NUMBERS]),
      ))
      : null;
    const hiddenInRange = (hidden?.docs ?? []).map(mapAdminPurchaseOrderDoc).filter(row => {
      if (status && row.status !== status) return false;
      if (category && category !== 'all') {
        const primary = row.purchaseOrderCategory
          ?? (row.categories.length ? row.categories[0] : null);
        if (primary !== category) return false;
      }
      const date = String(row.date ?? '').trim().slice(0, 10);
      if (dateStart && date && date < dateStart) return false;
      if (dateEnd && date && date > dateEnd) return false;
      return true;
    }).length;
    return snap.data().count + extra - hiddenInRange;
  } catch (err) {
    if (!isFirestoreIndexError(err)) throw err;
    const { rows } = await fetchAllAdminPurchaseOrdersInRange({
      sort: options.sort ?? 'date',
      category,
      dateStart,
      dateEnd,
      status: status || PORTAL_PURCHASE_ORDER_STATUS,
    });
    return rows.length;
  }
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
  status?: string | null;
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
      status: options.status ?? PORTAL_PURCHASE_ORDER_STATUS,
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

  const visible = excludeHiddenPurchaseOrders(rows);
  return { rows: truncated ? visible.slice(0, maxRows) : visible, truncated };
}

export function filterAdminPurchaseOrders(
  rows: AdminFirestorePurchaseOrder[],
  searchText: string,
  category: InvoiceCategory | 'all' = 'all',
): AdminFirestorePurchaseOrder[] {
  let next = rows.filter(row => (
    row.status === PORTAL_PURCHASE_ORDER_STATUS
    && purchaseOrderVisibleInPortal(row)
  ));
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
      row.vendorCity,
      row.vendorState,
      row.vendorCountry,
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
    status: String(data.status ?? 'draft').trim().toLowerCase(),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    currencyCode: data.currencyCode ? String(data.currencyCode).toUpperCase() : 'INR',
    vendorId: String(data.vendorId ?? ''),
    vendorName: data.vendorName ? String(data.vendorName) : null,
    vendorCity: data.vendorCity ? String(data.vendorCity) : null,
    vendorState: data.vendorState ? String(data.vendorState) : null,
    vendorCountry: data.vendorCountry ? String(data.vendorCountry) : null,
    purchaseOrderCategory: parseInvoiceCategory(data.purchaseOrderCategory),
    categories: normalizeInvoiceCategories(data.categories),
    categoryAmounts: normalizeInvoiceCategoryAmounts(data.categoryAmounts),
    subtotal: Number(data.subtotal ?? 0),
    taxTotal: Number(data.taxTotal ?? 0),
    notes: data.notes ? String(data.notes) : null,
    lineItems: Array.isArray(data.lineItems)
      ? data.lineItems.map(item => mapLineItem(item as Record<string, unknown>))
      : [],
    bl: parsePurchaseOrderBl(data),
    vendorPi: parsePurchaseOrderVendorPi(data),
    kotakPayout: parsePurchaseOrderKotakPayout(data),
    tracking: parsePurchaseOrderTracking(data),
    activityLogs: parsePurchaseOrderActivityLogs(data),
  };
}

export function parsePurchaseOrderBl(data: DocumentData): PurchaseOrderBl | null {
  const storagePath = typeof data.blStoragePath === 'string' ? data.blStoragePath.trim() : '';
  const containerNumber = typeof data.blContainerNumber === 'string'
    ? data.blContainerNumber.trim()
    : '';
  if (!storagePath && !containerNumber) return null;
  return {
    containerNumber,
    storagePath,
    fileName: typeof data.blFileName === 'string' ? data.blFileName.trim() : '',
    contentType: typeof data.blContentType === 'string' ? data.blContentType.trim() : '',
    uploadedAt: typeof data.blUploadedAt === 'string' ? data.blUploadedAt : null,
  };
}

export function parsePurchaseOrderVendorPi(data: DocumentData): PurchaseOrderVendorPi | null {
  const storagePath = typeof data.piStoragePath === 'string' ? data.piStoragePath.trim() : '';
  if (!storagePath) return null;
  return {
    storagePath,
    fileName: typeof data.piFileName === 'string' ? data.piFileName.trim() : '',
    contentType: typeof data.piContentType === 'string' ? data.piContentType.trim() : '',
    uploadedAt: typeof data.piUploadedAt === 'string' ? data.piUploadedAt : null,
  };
}

function parseYmd(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function parsePurchaseOrderKotakPayout(data: DocumentData): PurchaseOrderKotakPayout | null {
  const raw = data.kotakPayout;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const transactionId = String(row.transactionId ?? '').trim();
  if (!transactionId) return null;
  return {
    transactionId,
    date: parseYmd(row.date),
    amountInr: Number(row.amountInr ?? row.amount ?? 0) || 0,
    amountUsd: Number(row.amountUsd ?? 0) || 0,
    usdToInrRate: Number(row.usdToInrRate ?? 0) || 0,
    bankCharges: Number(row.bankCharges ?? 0) || 0,
    zohoVendorPaymentId: row.zohoVendorPaymentId ? String(row.zohoVendorPaymentId) : null,
    payee: row.payee ? String(row.payee) : null,
    description: row.description ? String(row.description) : null,
    referenceNumber: row.referenceNumber ? String(row.referenceNumber) : null,
    associatedAt: row.associatedAt ? String(row.associatedAt) : null,
    associatedByName: row.associatedByName ? String(row.associatedByName) : null,
  };
}

export function emptyPurchaseOrderTracking(poDate?: string | null): PurchaseOrderTracking {
  return {
    poDate: parseYmd(poDate),
    paymentDate: null,
    loadingDate: null,
    sailingDate: null,
    arrivalDate: null,
    receivedDate: null,
  };
}

export function parsePurchaseOrderTracking(data: DocumentData): PurchaseOrderTracking {
  const raw = data.tracking && typeof data.tracking === 'object'
    ? data.tracking as Record<string, unknown>
    : {};
  return {
    poDate: parseYmd(raw.poDate) || parseYmd(data.date),
    paymentDate: parseYmd(raw.paymentDate),
    loadingDate: parseYmd(raw.loadingDate),
    sailingDate: parseYmd(raw.sailingDate),
    arrivalDate: parseYmd(raw.arrivalDate),
    receivedDate: parseYmd(raw.receivedDate),
  };
}

export function parsePurchaseOrderActivityLogs(data: DocumentData): PurchaseOrderActivityLog[] {
  if (!Array.isArray(data.activityLogs)) return [];
  return data.activityLogs.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    const at = String(item.at ?? '').trim();
    if (!at) return [];
    return [{
      at,
      byName: item.byName ? String(item.byName) : null,
      action: String(item.action ?? ''),
      detail: String(item.detail ?? ''),
    }];
  });
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

export async function createAdminPurchaseOrder(input: {
  vendorId: string;
  date: string;
  referenceNumber: string;
  lines: Array<{
    productId: string;
    quantity: number;
    rate: number;
    name?: string;
  }>;
}): Promise<{ id: string; purchaseOrderNumber: string }> {
  const callable = httpsCallable<
    typeof input,
    { id?: string; purchaseOrderNumber?: string }
  >(functions, 'createPurchaseOrder', { timeout: 120_000 });
  try {
    const result = await callable({
      vendorId: input.vendorId,
      date: input.date,
      referenceNumber: input.referenceNumber,
      lines: input.lines,
    });
    const id = String(result.data?.id ?? '').trim();
    if (!id) throw new Error('Zoho did not return a purchase order id.');
    return {
      id,
      purchaseOrderNumber: String(result.data?.purchaseOrderNumber ?? ''),
    };
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

export async function updateAdminPurchaseOrder(input: {
  purchaseOrderId: string;
  vendorId?: string | null;
  date?: string | null;
  deliveryDate?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  lines: Array<{
    productId: string;
    quantity: number;
    rate: number;
    name?: string;
  }>;
}): Promise<AdminPurchaseOrderDetail> {
  const callable = httpsCallable(functions, 'updatePurchaseOrder', { timeout: 120_000 });
  try {
    await callable({
      purchaseOrderId: input.purchaseOrderId,
      vendorId: input.vendorId ?? undefined,
      date: input.date ?? undefined,
      deliveryDate: input.deliveryDate ?? null,
      referenceNumber: input.referenceNumber ?? null,
      notes: input.notes ?? null,
      lines: input.lines,
    });
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
  return fetchAdminPurchaseOrderDetail(input.purchaseOrderId);
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

const MAX_BL_BYTES = 16 * 1024 * 1024;

function blExtension(file: File): 'pdf' | 'jpg' | 'png' {
  const fromName = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (fromName === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (fromName === 'png' || file.type === 'image/png') return 'png';
  return 'jpg';
}

function blContentTypeForExt(ext: 'pdf' | 'jpg' | 'png'): string {
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  return 'image/jpeg';
}

function isAllowedBlFile(file: File): boolean {
  const type = file.type.toLowerCase();
  if (
    type === 'application/pdf'
    || type === 'image/jpeg'
    || type === 'image/jpg'
    || type === 'image/png'
  ) {
    return true;
  }
  return /\.(pdf|jpe?g|png)$/i.test(file.name);
}

export function purchaseOrderBlStoragePath(purchaseOrderId: string, ext: string): string {
  const safeId = purchaseOrderId.replace(/[^\w\-]+/g, '-').slice(0, 80) || 'po';
  const safeExt = ext.replace(/[^\w]+/g, '').slice(0, 8) || 'bin';
  return `purchaseOrderBl/${safeId}/bl.${safeExt}`;
}

export function purchaseOrderHasBl(bl?: PurchaseOrderBl | null): boolean {
  return Boolean(bl?.storagePath);
}

export async function savePurchaseOrderBl(input: {
  purchaseOrderId: string;
  containerNumber: string;
  file?: File | null;
  existing?: PurchaseOrderBl | null;
}): Promise<PurchaseOrderBl> {
  const containerNumber = input.containerNumber.trim();
  if (!containerNumber) {
    throw new Error('Enter the container number.');
  }
  if (!input.file && !input.existing?.storagePath) {
    throw new Error('Upload a PDF or JPG of the bill of lading.');
  }

  let storagePath = input.existing?.storagePath ?? '';
  let fileName = input.existing?.fileName ?? '';
  let contentType = input.existing?.contentType ?? '';

  if (input.file) {
    if (input.file.size > MAX_BL_BYTES) {
      throw new Error('File must be under 16 MB.');
    }
    if (!isAllowedBlFile(input.file)) {
      throw new Error('Upload a PDF or JPG.');
    }
    const ext = blExtension(input.file);
    const nextPath = purchaseOrderBlStoragePath(input.purchaseOrderId, ext);
    try {
      await uploadBytes(ref(storage, nextPath), input.file, {
        contentType: input.file.type || blContentTypeForExt(ext),
      });
    } catch (err) {
      throw new Error(formatStorageUploadError(err, 'Could not upload bill of lading.'));
    }
    if (input.existing?.storagePath && input.existing.storagePath !== nextPath) {
      try {
        await deleteObject(ref(storage, input.existing.storagePath));
      } catch {
        // ignore leftover file
      }
    }
    storagePath = nextPath;
    fileName = input.file.name;
    contentType = input.file.type || blContentTypeForExt(ext);
  }

  const uploadedAt = new Date().toISOString();
  await updateDoc(doc(db, 'purchaseOrders', input.purchaseOrderId), {
    blContainerNumber: containerNumber,
    blStoragePath: storagePath,
    blFileName: fileName,
    blContentType: contentType,
    blUploadedAt: uploadedAt,
    blUploadedBy: auth.currentUser?.uid ?? null,
  });

  return {
    containerNumber,
    storagePath,
    fileName,
    contentType,
    uploadedAt,
  };
}

export async function fetchPurchaseOrderBlPreview(storagePath: string): Promise<{
  url: string;
  bytes: Uint8Array | null;
  isPdf: boolean;
}> {
  const url = await getDownloadURL(ref(storage, storagePath));
  const isPdf = storagePath.toLowerCase().endsWith('.pdf')
    || storagePath.toLowerCase().includes('.pdf?');
  if (!isPdf) return { url, bytes: null, isPdf: false };
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Could not open the bill of lading.');
  }
  return { url, bytes: new Uint8Array(await res.arrayBuffer()), isPdf: true };
}

const MAX_PI_BYTES = 16 * 1024 * 1024;

const PI_EXCEL_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function piExtension(file: File): 'pdf' | 'xlsx' | 'xls' {
  const fromName = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (fromName === 'xls' || file.type === 'application/vnd.ms-excel') return 'xls';
  if (
    fromName === 'xlsx'
    || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'xlsx';
  }
  if (fromName === 'pdf' || file.type === 'application/pdf') return 'pdf';
  return 'xlsx';
}

function piContentTypeForExt(ext: 'pdf' | 'xlsx' | 'xls'): string {
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'xls') return 'application/vnd.ms-excel';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

function isAllowedPiFile(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === 'application/pdf' || PI_EXCEL_TYPES.has(type)) return true;
  return /\.(pdf|xlsx|xls)$/i.test(file.name);
}

export function purchaseOrderPiStoragePath(purchaseOrderId: string, ext: string): string {
  const safeId = purchaseOrderId.replace(/[^\w\-]+/g, '-').slice(0, 80) || 'po';
  const safeExt = ext.replace(/[^\w]+/g, '').slice(0, 8) || 'bin';
  return `purchaseOrderPi/${safeId}/pi.${safeExt}`;
}

export function purchaseOrderHasVendorPi(pi?: PurchaseOrderVendorPi | null): boolean {
  return Boolean(pi?.storagePath);
}

export function purchaseOrderVendorPiIsPdf(pi?: PurchaseOrderVendorPi | null): boolean {
  if (!pi) return false;
  const type = pi.contentType.toLowerCase();
  if (type === 'application/pdf') return true;
  return /\.pdf$/i.test(pi.storagePath) || /\.pdf$/i.test(pi.fileName);
}

export async function savePurchaseOrderVendorPi(input: {
  purchaseOrderId: string;
  file?: File | null;
  existing?: PurchaseOrderVendorPi | null;
}): Promise<PurchaseOrderVendorPi> {
  if (!input.file && !input.existing?.storagePath) {
    throw new Error('Upload a vendor PI as Excel or PDF.');
  }

  let storagePath = input.existing?.storagePath ?? '';
  let fileName = input.existing?.fileName ?? '';
  let contentType = input.existing?.contentType ?? '';

  if (input.file) {
    if (input.file.size > MAX_PI_BYTES) {
      throw new Error('File must be under 16 MB.');
    }
    if (!isAllowedPiFile(input.file)) {
      throw new Error('Upload an Excel (.xlsx / .xls) or PDF file.');
    }
    const ext = piExtension(input.file);
    const nextPath = purchaseOrderPiStoragePath(input.purchaseOrderId, ext);
    const uploadType = piContentTypeForExt(ext);
    try {
      await uploadBytes(ref(storage, nextPath), input.file, {
        contentType: uploadType,
      });
    } catch (err) {
      throw new Error(formatStorageUploadError(err, 'Could not upload vendor PI.'));
    }
    if (input.existing?.storagePath && input.existing.storagePath !== nextPath) {
      try {
        await deleteObject(ref(storage, input.existing.storagePath));
      } catch {
        // ignore leftover file
      }
    }
    storagePath = nextPath;
    fileName = input.file.name;
    contentType = uploadType;
  }

  const uploadedAt = new Date().toISOString();
  await updateDoc(doc(db, 'purchaseOrders', input.purchaseOrderId), {
    piStoragePath: storagePath,
    piFileName: fileName,
    piContentType: contentType,
    piUploadedAt: uploadedAt,
    piUploadedBy: auth.currentUser?.uid ?? null,
  });

  return {
    storagePath,
    fileName,
    contentType,
    uploadedAt,
  };
}

export async function fetchPurchaseOrderVendorPiPreview(storagePath: string): Promise<{
  url: string;
  bytes: Uint8Array | null;
  isPdf: boolean;
}> {
  const url = await getDownloadURL(ref(storage, storagePath));
  const isPdf = storagePath.toLowerCase().endsWith('.pdf')
    || storagePath.toLowerCase().includes('.pdf?');
  if (!isPdf) return { url, bytes: null, isPdf: false };
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Could not open the vendor PI.');
  }
  return { url, bytes: new Uint8Array(await res.arrayBuffer()), isPdf: true };
}

export async function associateKotakPayoutWithPurchaseOrder(input: {
  purchaseOrderId: string;
  feed: {
    transactionId: string;
    date: string | null;
    postedTime?: string | null;
    amount: number;
    debitOrCredit: string | null;
    payee: string | null;
    description: string | null;
    referenceNumber: string | null;
    accountId: string;
    importedTransactionId: string | null;
  };
  amountUsd: number;
  usdToInrRate: number;
}): Promise<{
  kotakPayout: PurchaseOrderKotakPayout;
  tracking: PurchaseOrderTracking;
  activityLogs: PurchaseOrderActivityLog[];
}> {
  const callable = httpsCallable<typeof input, {
    kotakPayout: PurchaseOrderKotakPayout;
    tracking: PurchaseOrderTracking;
    activityLogs: PurchaseOrderActivityLog[];
  }>(
    functions,
    'associateKotakPayoutWithPurchaseOrder',
    { timeout: 120_000 },
  );
  try {
    const result = await callable(input);
    return result.data;
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

export async function savePurchaseOrderTracking(input: {
  purchaseOrderId: string;
} & PurchaseOrderTracking): Promise<{
  tracking: PurchaseOrderTracking;
  activityLogs: PurchaseOrderActivityLog[];
}> {
  const callable = httpsCallable<typeof input, {
    tracking: PurchaseOrderTracking;
    activityLogs: PurchaseOrderActivityLog[];
  }>(
    functions,
    'savePurchaseOrderTracking',
    { timeout: 30_000 },
  );
  try {
    const result = await callable(input);
    return result.data;
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}
