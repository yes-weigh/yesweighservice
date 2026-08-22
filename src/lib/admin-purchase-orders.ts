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
import { parseVendorPiExcelFile } from './vendorPiExcel';
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
  /** Shipment milestones used for New PO / Underproduction / Shipped / Transit filters. */
  tracking: PurchaseOrderTracking;
  /** True when a Bill of Lading file is stored on the PO (counts as Shipped). */
  hasBl: boolean;
  /** Shipping line + container/B/L set — BL can be live-tracked (Transit once sailed). */
  blTrackable: boolean;
}

/** Portal pipeline chips under the Draft POs summary. */
export type PurchaseOrderPipelineStage =
  | 'new_po'
  | 'underproduction'
  | 'shipped'
  | 'transit';

export const PURCHASE_ORDER_PIPELINE_STAGES: PurchaseOrderPipelineStage[] = [
  'new_po',
  'underproduction',
  'shipped',
  'transit',
];

export const PURCHASE_ORDER_PIPELINE_LABELS: Record<PurchaseOrderPipelineStage, string> = {
  new_po: 'New PO',
  underproduction: 'Underproduction',
  shipped: 'Shipped',
  transit: 'Transit',
};

/**
 * Highest milestone wins:
 * Transit (trackable BL + sailed date, or arrived/received)
 * → Shipped (BL uploaded; sailed but not trackable stays here)
 * → Underproduction (paid/loading) → New PO.
 */
export function purchaseOrderPipelineStage(
  row: Pick<AdminFirestorePurchaseOrder, 'tracking' | 'hasBl' | 'blTrackable'>,
): PurchaseOrderPipelineStage {
  const t = row.tracking;
  if (t.arrivalDate || t.receivedDate) return 'transit';
  // Trackable BL + sailed date → Transit (vessel has left).
  if (row.blTrackable && t.sailingDate) return 'transit';
  // Vendor BL received → Shipped.
  if (row.hasBl || t.sailingDate) return 'shipped';
  if (t.loadingDate || t.paymentDate) return 'underproduction';
  return 'new_po';
}

export function countPurchaseOrdersByPipeline(
  rows: AdminFirestorePurchaseOrder[],
): Record<PurchaseOrderPipelineStage | 'all', number> {
  const counts: Record<PurchaseOrderPipelineStage | 'all', number> = {
    all: rows.length,
    new_po: 0,
    underproduction: 0,
    shipped: 0,
    transit: 0,
  };
  for (const row of rows) {
    counts[purchaseOrderPipelineStage(row)] += 1;
  }
  return counts;
}

export interface PurchaseOrderBl {
  containerNumber: string;
  /** Carrier used for live cargo tracking (e.g. Wan Hai). */
  shippingLine: string;
  /** Bill of lading / MBL number used for carrier tracking. */
  blNumber: string;
  /** Vessel name or voyage (optional; usually filled from tracking later). */
  vesselName: string;
  /** BL / shipped-on-board date (YYYY-MM-DD) — copied to tracking.sailingDate. */
  blDate: string | null;
  storagePath: string;
  fileName: string;
  contentType: string;
  uploadedAt: string | null;
  /** When set, this PO reuses the BL file stored on another PO (same container). */
  linkedFromPurchaseOrderId: string | null;
  linkedFromPurchaseOrderNumber: string | null;
}

/** Known ocean carriers we can track (extend as integrations are added). */
export const PURCHASE_ORDER_SHIPPING_LINES = [
  'Wan Hai',
  'Maersk',
  'MSC',
  'CMA CGM',
  'COSCO',
  'Hapag-Lloyd',
  'ONE',
  'Evergreen',
  'Yang Ming',
  'Other',
] as const;

export type PurchaseOrderShippingLine = (typeof PURCHASE_ORDER_SHIPPING_LINES)[number];

export function normalizePurchaseOrderShippingLine(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = PURCHASE_ORDER_SHIPPING_LINES.find(
    line => line.toLowerCase() === raw.toLowerCase(),
  );
  return match ?? raw;
}

export interface PurchaseOrderVendorPi {
  storagePath: string;
  fileName: string;
  contentType: string;
  uploadedAt: string | null;
  totalAmount: number | null;
  currencyCode: string | null;
  /** Vendor PI document date from the spreadsheet (YYYY-MM-DD). */
  piDate: string | null;
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
  /** Factory / vendor QC photos (multi-image). */
  qcImages: PurchaseOrderQcImage[];
  kotakPayout: PurchaseOrderKotakPayout | null;
  /** Latest Wan Hai site scrape (extension-assisted live track). */
  wanHaiTrack: WanHaiLiveTrackSnapshot | null;
  tracking: PurchaseOrderTracking;
  activityLogs: PurchaseOrderActivityLog[];
}

export interface PurchaseOrderQcImage {
  id: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  uploadedAt: string;
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
    tracking: parsePurchaseOrderTracking(data),
    hasBl: typeof data.blStoragePath === 'string' && Boolean(data.blStoragePath.trim()),
    blTrackable: (() => {
      const shippingLine = normalizePurchaseOrderShippingLine(data.blShippingLine);
      const containerNumber = typeof data.blContainerNumber === 'string'
        ? data.blContainerNumber.trim()
        : '';
      const blNumber = typeof data.blNumber === 'string' ? data.blNumber.trim() : '';
      return Boolean(shippingLine && (containerNumber || blNumber));
    })(),
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
  pipelineStage: PurchaseOrderPipelineStage | 'all' = 'all',
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
  if (pipelineStage && pipelineStage !== 'all') {
    next = next.filter(row => purchaseOrderPipelineStage(row) === pipelineStage);
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
    qcImages: parsePurchaseOrderQcImages(data),
    kotakPayout: parsePurchaseOrderKotakPayout(data),
    wanHaiTrack: parseWanHaiLiveTrack(data),
    tracking: parsePurchaseOrderTracking(data),
    activityLogs: parsePurchaseOrderActivityLogs(data),
  };
}

export function parsePurchaseOrderBl(data: DocumentData): PurchaseOrderBl | null {
  const storagePath = typeof data.blStoragePath === 'string' ? data.blStoragePath.trim() : '';
  const containerNumber = typeof data.blContainerNumber === 'string'
    ? data.blContainerNumber.trim()
    : '';
  const shippingLine = normalizePurchaseOrderShippingLine(data.blShippingLine);
  const blNumber = typeof data.blNumber === 'string' ? data.blNumber.trim() : '';
  const vesselName = typeof data.blVesselName === 'string' ? data.blVesselName.trim() : '';
  const blDate = parseYmd(data.blDate);
  if (!storagePath && !containerNumber && !blNumber && !shippingLine && !blDate) return null;
  return {
    containerNumber,
    shippingLine,
    blNumber,
    vesselName,
    blDate,
    storagePath,
    fileName: typeof data.blFileName === 'string' ? data.blFileName.trim() : '',
    contentType: typeof data.blContentType === 'string' ? data.blContentType.trim() : '',
    uploadedAt: typeof data.blUploadedAt === 'string' ? data.blUploadedAt : null,
    linkedFromPurchaseOrderId: typeof data.blLinkedFromPurchaseOrderId === 'string'
      ? data.blLinkedFromPurchaseOrderId.trim() || null
      : null,
    linkedFromPurchaseOrderNumber: typeof data.blLinkedFromPurchaseOrderNumber === 'string'
      ? data.blLinkedFromPurchaseOrderNumber.trim() || null
      : null,
  };
}

export function parsePurchaseOrderVendorPi(data: DocumentData): PurchaseOrderVendorPi | null {
  const storagePath = typeof data.piStoragePath === 'string' ? data.piStoragePath.trim() : '';
  if (!storagePath) return null;
  const totalAmount = Number(data.piTotalAmount);
  return {
    storagePath,
    fileName: typeof data.piFileName === 'string' ? data.piFileName.trim() : '',
    contentType: typeof data.piContentType === 'string' ? data.piContentType.trim() : '',
    uploadedAt: typeof data.piUploadedAt === 'string' ? data.piUploadedAt : null,
    totalAmount: Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : null,
    currencyCode: typeof data.piCurrencyCode === 'string' && data.piCurrencyCode.trim()
      ? data.piCurrencyCode.trim().toUpperCase()
      : null,
    piDate: parseYmd(data.piDate),
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

/** Reference used for carrier live tracking (container preferred, else B/L). */
export function purchaseOrderBlTrackingReference(bl?: PurchaseOrderBl | null): string {
  if (!bl) return '';
  return (bl.containerNumber || bl.blNumber || '').trim().toUpperCase();
}

const BL_LIVE_TRACK_SEALINES: Record<string, string> = {
  'Wan Hai': 'whl',
  Maersk: 'maeu',
  MSC: 'mscu',
  'CMA CGM': 'cmau',
  COSCO: 'cosu',
  'Hapag-Lloyd': 'hlcu',
  ONE: 'oney',
  Evergreen: 'eglv',
  'Yang Ming': 'ymlu',
};

/**
 * Public cargo-tracking URL for the BL’s shipping line + container/B/L.
 * Wan Hai opens Quick Search; Chrome extension pastes container after CAPTCHA.
 */
export function purchaseOrderBlLiveTrackingUrl(bl?: PurchaseOrderBl | null): string | null {
  if (!bl) return null;
  const reference = purchaseOrderBlTrackingReference(bl);
  const shippingLine = normalizePurchaseOrderShippingLine(bl.shippingLine);
  if (!reference || !shippingLine) return null;

  const encoded = encodeURIComponent(reference);
  switch (shippingLine) {
    case 'Wan Hai':
      return 'https://www.wanhai.com/views/cargo_track_v2/tracking_query.xhtml';
    case 'Maersk':
      return `https://www.maersk.com/tracking/${encoded}`;
    case 'MSC':
      return `https://www.msc.com/en/track-a-shipment?query=${encoded}`;
    case 'CMA CGM':
      return `https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Container&Reference=${encoded}`;
    case 'COSCO':
      return `https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=CONTAINER&number=${encoded}`;
    case 'Hapag-Lloyd':
      return `https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=${encoded}`;
    case 'ONE':
      return `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNo=${encoded}`;
    case 'Evergreen':
      return `https://www.shipmentlink.com/servlet/TDB1_CargoTracking.do`;
    case 'Yang Ming':
      return `https://www.yangming.com/e-service/Track_Trace/track_trace_cargo_tracking.aspx`;
    default: {
      const sealine = BL_LIVE_TRACK_SEALINES[shippingLine] || 'auto';
      return `https://www.searates.com/container/tracking/?number=${encoded}&sealine=${encodeURIComponent(sealine)}`;
    }
  }
}

export interface WanHaiLiveTrackSnapshot {
  containerNumber: string;
  blNumber: string | null;
  statusName: string | null;
  depotName: string | null;
  voyage: string | null;
  vesselName: string | null;
  eventAt: string | null;
  bookingRef: string | null;
  rows: Array<Record<string, string>>;
  fetchedAt: string;
  sourceUrl: string | null;
}

export function parseWanHaiLiveTrack(data: DocumentData): WanHaiLiveTrackSnapshot | null {
  const raw = data.wanHaiTrack;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const containerNumber = String(row.containerNumber ?? '').trim().toUpperCase();
  if (!containerNumber) return null;
  const rows = Array.isArray(row.rows)
    ? row.rows.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        out[String(key)] = String(value ?? '').trim();
      }
      return [out];
    })
    : [];
  return {
    containerNumber,
    blNumber: row.blNumber ? String(row.blNumber).trim().toUpperCase() : null,
    statusName: row.statusName ? String(row.statusName).trim() : null,
    depotName: row.depotName ? String(row.depotName).trim() : null,
    voyage: row.voyage ? String(row.voyage).trim() : null,
    vesselName: row.vesselName ? String(row.vesselName).trim() : null,
    eventAt: row.eventAt ? String(row.eventAt).trim() : null,
    bookingRef: row.bookingRef ? String(row.bookingRef).trim() : null,
    rows,
    fetchedAt: row.fetchedAt ? String(row.fetchedAt) : new Date().toISOString(),
    sourceUrl: row.sourceUrl ? String(row.sourceUrl).trim() : null,
  };
}

/** Persist Wan Hai live-track scrape onto the PO (Wan Hai only). */
export async function saveWanHaiLiveTrack(input: {
  purchaseOrderId: string;
  snapshot: WanHaiLiveTrackSnapshot;
}): Promise<{
  wanHaiTrack: WanHaiLiveTrackSnapshot;
  tracking: PurchaseOrderTracking;
  bl: PurchaseOrderBl | null;
}> {
  const purchaseOrderId = input.purchaseOrderId.trim();
  if (!purchaseOrderId) throw new Error('Purchase order is required.');
  const snap = input.snapshot;
  if (!snap.containerNumber) throw new Error('Container number is required.');

  const poRef = doc(db, 'purchaseOrders', purchaseOrderId);
  const poSnap = await getDoc(poRef);
  if (!poSnap.exists()) throw new Error('Purchase order not found.');
  const data = poSnap.data();
  const bl = parsePurchaseOrderBl(data);
  const shippingLine = normalizePurchaseOrderShippingLine(bl?.shippingLine || data.blShippingLine);
  if (shippingLine && shippingLine !== 'Wan Hai') {
    throw new Error('Automatic live track import is only supported for Wan Hai.');
  }

  const tracking = parsePurchaseOrderTracking(data);
  const vesselFromTrack = [snap.vesselName, snap.voyage].filter(Boolean).join(' / ');

  const patch: Record<string, unknown> = {
    wanHaiTrack: {
      containerNumber: snap.containerNumber,
      blNumber: snap.blNumber,
      statusName: snap.statusName,
      depotName: snap.depotName,
      voyage: snap.voyage,
      vesselName: snap.vesselName,
      eventAt: snap.eventAt,
      bookingRef: snap.bookingRef,
      rows: snap.rows.slice(0, 20),
      fetchedAt: snap.fetchedAt || new Date().toISOString(),
      sourceUrl: snap.sourceUrl,
    },
  };

  if (vesselFromTrack) {
    patch.blVesselName = vesselFromTrack;
  }

  const eventDigits = String(snap.eventAt || '').replace(/\D/g, '');
  const eventYmd = parseFlexibleBlDate(String(snap.eventAt || '').slice(0, 10))
    || (eventDigits.length >= 8 ? parseFlexibleBlDate(eventDigits.slice(0, 8)) : null);
  if (eventYmd && !tracking.sailingDate) {
    patch.tracking = { ...tracking, sailingDate: eventYmd };
  }
  if (eventYmd && !bl?.blDate) {
    patch.blDate = eventYmd;
  }

  await updateDoc(poRef, patch);
  const nextSnap = await getDoc(poRef);
  const nextData = nextSnap.data() || {};
  return {
    wanHaiTrack: parseWanHaiLiveTrack(nextData)!,
    tracking: parsePurchaseOrderTracking(nextData),
    bl: parsePurchaseOrderBl(nextData),
  };
}

/** Open live tracking; Wan Hai on Android APK uses in-app WebView after CAPTCHA. */
export async function openPurchaseOrderBlLiveTracking(
  bl?: PurchaseOrderBl | null,
  options?: { purchaseOrderId?: string | null },
): Promise<'saved' | 'opened' | false> {
  const url = purchaseOrderBlLiveTrackingUrl(bl);
  if (!url || !bl) return false;
  const reference = purchaseOrderBlTrackingReference(bl);
  const shippingLine = normalizePurchaseOrderShippingLine(bl.shippingLine);
  const purchaseOrderId = String(options?.purchaseOrderId ?? '').trim();
  const containerNumber = (bl.containerNumber || reference).trim().toUpperCase();

  if (reference && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(reference);
    } catch {
      // still open the site
    }
  }

  // Phone (YesOne Android APK): in-app WebView — user CAPTCHA, then auto paste/query/save.
  if (shippingLine === 'Wan Hai' && purchaseOrderId && containerNumber) {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { WanHaiTrack } = await import('wanhai-track');
        const result = await WanHaiTrack.track({ url, containerNumber });
        let rows: Array<Record<string, string>> = [];
        try {
          const parsed = JSON.parse(result.rowsJson || '[]');
          if (Array.isArray(parsed)) {
            rows = parsed.map((item) => {
              const out: Record<string, string> = {};
              if (item && typeof item === 'object') {
                for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
                  out[String(key)] = String(value ?? '').trim();
                }
              }
              return out;
            });
          }
        } catch {
          rows = [];
        }
        await saveWanHaiLiveTrack({
          purchaseOrderId,
          snapshot: {
            containerNumber: result.containerNumber || containerNumber,
            blNumber: bl.blNumber || null,
            statusName: result.statusName ?? null,
            depotName: result.depotName ?? null,
            voyage: result.voyage ?? null,
            vesselName: result.vesselName ?? null,
            eventAt: result.eventAt ?? null,
            bookingRef: result.bookingRef ?? null,
            rows,
            fetchedAt: new Date().toISOString(),
            sourceUrl: result.sourceUrl ?? null,
          },
        });
        return 'saved';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? '');
      if (/cancel/i.test(message)) return false;
      // Fall through to browser open when plugin missing.
    }
  }

  if (shippingLine === 'Wan Hai' && purchaseOrderId && reference) {
    window.dispatchEvent(new CustomEvent('YesWeighWanHaiTrackRequest', {
      detail: {
        purchaseOrderId,
        containerNumber,
        blNumber: bl.blNumber || null,
      },
    }));
  }

  window.open(url, '_blank', 'noopener,noreferrer');
  return 'opened';
}

export function purchaseOrderBlTrackingSummary(bl?: PurchaseOrderBl | null): string | null {
  if (!bl) return null;
  const parts = [
    bl.shippingLine?.trim() || null,
    bl.containerNumber?.trim() || null,
    bl.blNumber?.trim() ? `B/L ${bl.blNumber.trim()}` : null,
    bl.blDate?.trim() || null,
    bl.vesselName?.trim() || null,
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return bl.fileName?.trim() || null;
}

/** Normalize common BL date strings to YYYY-MM-DD. */
export function parseFlexibleBlDate(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const ymd = parseYmd(raw);
  if (ymd) return ymd;

  const dmy = raw.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const mdy = raw.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})$/);
  if (mdy) {
    // Ambiguous with dmy when both parts <= 12 — prefer day-first already handled above.
  }

  const ymdCompact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymdCompact) {
    return parseYmd(`${ymdCompact[1]}-${ymdCompact[2]}-${ymdCompact[3]}`);
  }

  const yymmdd = raw.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (yymmdd) {
    const year = 2000 + Number(yymmdd[1]);
    const month = Number(yymmdd[2]);
    const day = Number(yymmdd[3]);
    if (year >= 2020 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const monthName = raw.match(
    /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$|^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/,
  );
  if (monthName) {
    const months: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, sept: 9, september: 9,
      oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    let day: number;
    let monthKey: string;
    let yearRaw: string;
    if (monthName[1]) {
      day = Number(monthName[1]);
      monthKey = monthName[2].toLowerCase();
      yearRaw = monthName[3];
    } else {
      monthKey = monthName[4].toLowerCase();
      day = Number(monthName[5]);
      yearRaw = monthName[6];
    }
    const month = months[monthKey];
    let year = Number(yearRaw);
    if (year < 100) year += 2000;
    if (month && year >= 2000 && year <= 2100 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

function extractBlDateFromText(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ');
  const labeledPatterns = [
    /(?:shipped\s+on\s+board(?:\s+date)?|on\s*board\s*date|装船日期)[:\s#-]*([0-9]{4}[./\-][0-9]{1,2}[./\-][0-9]{1,2}|[0-9]{1,2}[./\-][0-9]{1,2}[./\-][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{2,4}|[A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{2,4}|[0-9]{6,8})/i,
    /(?:date\s+of\s+issue|b\/?\s*l\s*date|bl\s*date|提单日期|签发日期|issue\s*date)[:\s#-]*([0-9]{4}[./\-][0-9]{1,2}[./\-][0-9]{1,2}|[0-9]{1,2}[./\-][0-9]{1,2}[./\-][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{2,4}|[A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{2,4}|[0-9]{6,8})/i,
  ];
  for (const pattern of labeledPatterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const parsed = parseFlexibleBlDate(match[1]);
    if (parsed) return parsed;
  }
  return null;
}

function extractBlDateFromFileName(fileName: string): string | null {
  const name = String(fileName || '');
  const underscored = name.match(/(?:^|[_\-])(\d{6})(?:[_\-]|\.|$)/);
  if (underscored?.[1]) {
    const parsed = parseFlexibleBlDate(underscored[1]);
    if (parsed) return parsed;
  }
  const eight = name.match(/(?:^|[_\-])(\d{8})(?:[_\-]|\.|$)/);
  if (eight?.[1]) {
    const parsed = parseFlexibleBlDate(eight[1]);
    if (parsed) return parsed;
  }
  return null;
}

/** Read BL / shipped-on-board date from PDF text or filename. */
export async function extractPurchaseOrderBlDate(input: {
  file?: File | null;
  fileName?: string | null;
  pdfBytes?: Uint8Array | null;
}): Promise<string | null> {
  const fileName = input.file?.name || input.fileName || '';
  if (input.pdfBytes?.length) {
    try {
      const { pdfjs } = await import('./pdfjsSetup');
      const pdf = await pdfjs.getDocument({ data: input.pdfBytes.slice() }).promise;
      const maxPages = Math.min(pdf.numPages, 3);
      let text = '';
      for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        text += ` ${content.items.map(item => ('str' in item ? item.str : '')).join(' ')}`;
      }
      const fromText = extractBlDateFromText(text);
      if (fromText) return fromText;
    } catch {
      // fall through to filename
    }
  } else if (input.file && (input.file.type.includes('pdf') || /\.pdf$/i.test(input.file.name))) {
    try {
      const buf = new Uint8Array(await input.file.arrayBuffer());
      return extractPurchaseOrderBlDate({ file: input.file, fileName, pdfBytes: buf });
    } catch {
      // fall through
    }
  }
  return extractBlDateFromFileName(fileName);
}

export type PurchaseOrderBlSource = {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  vendorName: string | null;
  bl: PurchaseOrderBl;
};

/** Draft POs that already have a BL file — for “ship together / link same container”. */
export async function listPurchaseOrderBlSources(options?: {
  excludePurchaseOrderId?: string | null;
  maxScan?: number;
}): Promise<PurchaseOrderBlSource[]> {
  const excludeId = String(options?.excludePurchaseOrderId ?? '').trim();
  const maxScan = Math.max(50, Math.min(options?.maxScan ?? 300, 500));
  const q = query(
    collection(db, 'purchaseOrders'),
    where('status', '==', PORTAL_PURCHASE_ORDER_STATUS),
    where('date', '>=', PURCHASE_ORDER_KEEP_AFTER_DATE),
    orderBy('date', 'desc'),
    limit(maxScan),
  );
  const snap = await getDocs(q);
  const out: PurchaseOrderBlSource[] = [];
  for (const docSnap of snap.docs) {
    if (excludeId && docSnap.id === excludeId) continue;
    const data = docSnap.data();
    const bl = parsePurchaseOrderBl(data);
    if (!purchaseOrderHasBl(bl) || !bl) continue;
    // Prefer primary (non-linked) BLs so we link to the PO that owns the file.
    if (bl.linkedFromPurchaseOrderId) continue;
    out.push({
      purchaseOrderId: docSnap.id,
      purchaseOrderNumber: String(data.purchaseOrderNumber ?? docSnap.id),
      vendorName: data.vendorName ? String(data.vendorName) : null,
      bl,
    });
  }
  return out;
}

export async function savePurchaseOrderBl(input: {
  purchaseOrderId: string;
  containerNumber: string;
  shippingLine: string;
  blNumber: string;
  vesselName?: string | null;
  blDate?: string | null;
  file?: File | null;
  existing?: PurchaseOrderBl | null;
}): Promise<PurchaseOrderBl> {
  const containerNumber = input.containerNumber.trim().toUpperCase();
  const shippingLine = normalizePurchaseOrderShippingLine(input.shippingLine);
  const blNumber = String(input.blNumber ?? '').trim().toUpperCase();
  const vesselName = String(input.vesselName ?? '').trim();
  const blDate = parseFlexibleBlDate(input.blDate) || parseYmd(input.blDate);

  if (!shippingLine) {
    throw new Error('Select the shipping company (required for live tracking).');
  }
  if (!containerNumber) {
    throw new Error('Enter the container number (required for live tracking).');
  }
  if (!blNumber) {
    throw new Error('Enter the B/L number (required for live tracking).');
  }
  if (!blDate) {
    throw new Error('Enter the BL date (used as Sailed date).');
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
    const prevPath = input.existing?.storagePath ?? '';
    const ownedPrev = prevPath
      && !input.existing?.linkedFromPurchaseOrderId
      && prevPath.includes(`purchaseOrderBl/${input.purchaseOrderId}/`)
      && prevPath !== nextPath;
    if (ownedPrev) {
      try {
        await deleteObject(ref(storage, prevPath));
      } catch {
        // ignore leftover file
      }
    }
    storagePath = nextPath;
    fileName = input.file.name;
    contentType = input.file.type || blContentTypeForExt(ext);
  }

  const uploadedAt = new Date().toISOString();
  const poRef = doc(db, 'purchaseOrders', input.purchaseOrderId);
  const poSnap = await getDoc(poRef);
  const tracking = parsePurchaseOrderTracking(poSnap.exists() ? poSnap.data() : {});
  const nextTracking: PurchaseOrderTracking = {
    ...tracking,
    sailingDate: blDate,
  };

  await updateDoc(poRef, {
    blContainerNumber: containerNumber,
    blShippingLine: shippingLine,
    blNumber,
    blVesselName: vesselName || null,
    blDate,
    blStoragePath: storagePath,
    blFileName: fileName,
    blContentType: contentType,
    blUploadedAt: uploadedAt,
    blUploadedBy: auth.currentUser?.uid ?? null,
    blLinkedFromPurchaseOrderId: null,
    blLinkedFromPurchaseOrderNumber: null,
    tracking: nextTracking,
  });

  return {
    containerNumber,
    shippingLine,
    blNumber,
    vesselName,
    blDate,
    storagePath,
    fileName,
    contentType,
    uploadedAt,
    linkedFromPurchaseOrderId: null,
    linkedFromPurchaseOrderNumber: null,
  };
}

/** Point this PO at another PO’s BL (same container / ship together). Does not re-upload. */
export async function linkPurchaseOrderBlFromSource(input: {
  purchaseOrderId: string;
  sourcePurchaseOrderId: string;
}): Promise<PurchaseOrderBl> {
  const targetId = input.purchaseOrderId.trim();
  const sourceId = input.sourcePurchaseOrderId.trim();
  if (!targetId || !sourceId) {
    throw new Error('Choose a purchase order that already has a bill of lading.');
  }
  if (targetId === sourceId) {
    throw new Error('Cannot link a bill of lading to the same purchase order.');
  }

  const sourceSnap = await getDoc(doc(db, 'purchaseOrders', sourceId));
  if (!sourceSnap.exists()) {
    throw new Error('Source purchase order not found.');
  }
  const sourceData = sourceSnap.data();
  const sourceBl = parsePurchaseOrderBl(sourceData);
  if (!purchaseOrderHasBl(sourceBl) || !sourceBl) {
    throw new Error('That purchase order has no bill of lading file yet.');
  }
  // If source itself is linked, resolve to the same path but label with the primary PO when possible.
  const primaryId = sourceBl.linkedFromPurchaseOrderId || sourceId;
  const primaryNumber = sourceBl.linkedFromPurchaseOrderNumber
    || String(sourceData.purchaseOrderNumber ?? sourceId);

  const targetSnap = await getDoc(doc(db, 'purchaseOrders', targetId));
  const existing = targetSnap.exists() ? parsePurchaseOrderBl(targetSnap.data()) : null;
  const prevPath = existing?.storagePath ?? '';
  const ownedPrev = prevPath
    && !existing?.linkedFromPurchaseOrderId
    && prevPath.includes(`purchaseOrderBl/${targetId}/`)
    && prevPath !== sourceBl.storagePath;
  if (ownedPrev) {
    try {
      await deleteObject(ref(storage, prevPath));
    } catch {
      // ignore
    }
  }

  const uploadedAt = new Date().toISOString();
  const targetTracking = parsePurchaseOrderTracking(targetSnap.exists() ? targetSnap.data() : {});
  const sourceTracking = parsePurchaseOrderTracking(sourceData);
  const blDate = sourceBl.blDate || sourceTracking.sailingDate;
  const nextTracking: PurchaseOrderTracking = {
    ...targetTracking,
    sailingDate: blDate || targetTracking.sailingDate,
  };

  await updateDoc(doc(db, 'purchaseOrders', targetId), {
    blContainerNumber: sourceBl.containerNumber,
    blShippingLine: sourceBl.shippingLine || null,
    blNumber: sourceBl.blNumber || null,
    blVesselName: sourceBl.vesselName || null,
    blDate: blDate || null,
    blStoragePath: sourceBl.storagePath,
    blFileName: sourceBl.fileName,
    blContentType: sourceBl.contentType,
    blUploadedAt: uploadedAt,
    blUploadedBy: auth.currentUser?.uid ?? null,
    blLinkedFromPurchaseOrderId: primaryId,
    blLinkedFromPurchaseOrderNumber: primaryNumber,
    tracking: nextTracking,
  });

  return {
    containerNumber: sourceBl.containerNumber,
    shippingLine: sourceBl.shippingLine,
    blNumber: sourceBl.blNumber,
    vesselName: sourceBl.vesselName,
    blDate: blDate || null,
    storagePath: sourceBl.storagePath,
    fileName: sourceBl.fileName,
    contentType: sourceBl.contentType,
    uploadedAt,
    linkedFromPurchaseOrderId: primaryId,
    linkedFromPurchaseOrderNumber: primaryNumber,
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

const MAX_QC_BYTES = 12 * 1024 * 1024;
const MAX_QC_IMAGES = 40;

export function parsePurchaseOrderQcImages(data: DocumentData): PurchaseOrderQcImage[] {
  const raw = data.qcImages;
  if (!Array.isArray(raw)) return [];
  const out: PurchaseOrderQcImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const storagePath = typeof row.storagePath === 'string' ? row.storagePath.trim() : '';
    if (!storagePath) continue;
    const id = typeof row.id === 'string' && row.id.trim()
      ? row.id.trim()
      : storagePath.split('/').pop()?.replace(/\.[^.]+$/, '') || `qc-${out.length + 1}`;
    out.push({
      id,
      storagePath,
      fileName: typeof row.fileName === 'string' ? row.fileName.trim() : '',
      contentType: typeof row.contentType === 'string' ? row.contentType.trim() : 'image/jpeg',
      uploadedAt: typeof row.uploadedAt === 'string' ? row.uploadedAt : new Date(0).toISOString(),
    });
  }
  return out.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
}

export function purchaseOrderHasQc(images?: PurchaseOrderQcImage[] | null): boolean {
  return Array.isArray(images) && images.length > 0;
}

function isAllowedQcImage(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
}

function qcExtension(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (fromName === 'png') return 'png';
  if (fromName === 'webp') return 'webp';
  if (fromName === 'heic' || fromName === 'heif') return 'heic';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/heic' || file.type === 'image/heif') return 'heic';
  return 'jpg';
}

export function purchaseOrderQcStoragePath(purchaseOrderId: string, imageId: string, ext: string): string {
  const safeId = purchaseOrderId.replace(/[^\w\-]+/g, '-').slice(0, 80) || 'po';
  const safeImage = imageId.replace(/[^\w\-]+/g, '-').slice(0, 40) || 'img';
  const safeExt = ext.replace(/[^\w]+/g, '').slice(0, 8) || 'jpg';
  return `purchaseOrderQc/${safeId}/${safeImage}.${safeExt}`;
}

export async function addPurchaseOrderQcImages(input: {
  purchaseOrderId: string;
  files: File[];
  existing?: PurchaseOrderQcImage[] | null;
}): Promise<PurchaseOrderQcImage[]> {
  const files = (input.files ?? []).filter(Boolean);
  if (!files.length) throw new Error('Choose one or more photos to upload.');
  const existing = Array.isArray(input.existing) ? [...input.existing] : [];
  if (existing.length + files.length > MAX_QC_IMAGES) {
    throw new Error(`You can store up to ${MAX_QC_IMAGES} QC photos on a purchase order.`);
  }

  const uploaded: PurchaseOrderQcImage[] = [];
  for (const file of files) {
    if (file.size > MAX_QC_BYTES) {
      throw new Error(`Each photo must be under 12 MB (${file.name}).`);
    }
    if (!isAllowedQcImage(file)) {
      throw new Error(`Upload photos only (JPG / PNG / HEIC). Skipped ${file.name}.`);
    }
    const imageId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `qc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const ext = qcExtension(file);
    const storagePath = purchaseOrderQcStoragePath(input.purchaseOrderId, imageId, ext);
    const contentType = file.type || (ext === 'png' ? 'image/png' : 'image/jpeg');
    try {
      await uploadBytes(ref(storage, storagePath), file, { contentType });
    } catch (err) {
      throw new Error(formatStorageUploadError(err, `Could not upload ${file.name}.`));
    }
    uploaded.push({
      id: imageId,
      storagePath,
      fileName: file.name,
      contentType,
      uploadedAt: new Date().toISOString(),
    });
  }

  const next = [...uploaded, ...existing];
  await updateDoc(doc(db, 'purchaseOrders', input.purchaseOrderId), {
    qcImages: next,
  });
  return next;
}

export async function deletePurchaseOrderQcImage(input: {
  purchaseOrderId: string;
  imageId: string;
  existing?: PurchaseOrderQcImage[] | null;
}): Promise<PurchaseOrderQcImage[]> {
  const existing = Array.isArray(input.existing) ? input.existing : [];
  const target = existing.find(row => row.id === input.imageId);
  if (!target) throw new Error('QC photo not found.');
  const next = existing.filter(row => row.id !== input.imageId);
  await updateDoc(doc(db, 'purchaseOrders', input.purchaseOrderId), {
    qcImages: next,
  });
  try {
    await deleteObject(ref(storage, target.storagePath));
  } catch {
    // ignore orphaned file
  }
  return next;
}

export async function fetchPurchaseOrderQcImageUrl(storagePath: string): Promise<string> {
  return getDownloadURL(ref(storage, storagePath));
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

export function formatPurchaseOrderVendorPiTotal(
  pi?: PurchaseOrderVendorPi | null,
): string | null {
  if (pi?.totalAmount == null || !(pi.totalAmount > 0)) return null;
  const code = (pi.currencyCode || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(pi.totalAmount);
  } catch {
    return `${code} ${pi.totalAmount.toFixed(2)}`;
  }
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

  let totalAmount = input.existing?.totalAmount ?? null;
  let currencyCode = input.existing?.currencyCode ?? null;
  let piDate = input.existing?.piDate ?? null;
  if (input.file && piExtension(input.file) !== 'pdf') {
    try {
      const parsed = await parseVendorPiExcelFile(input.file);
      totalAmount = parsed.totalAmount;
      currencyCode = parsed.currencyCode;
      piDate = parsed.piDate;
    } catch {
      totalAmount = null;
      currencyCode = null;
      piDate = null;
    }
  } else if (input.file && piExtension(input.file) === 'pdf') {
    totalAmount = null;
    currencyCode = null;
    piDate = null;
  }

  const uploadedAt = new Date().toISOString();
  await updateDoc(doc(db, 'purchaseOrders', input.purchaseOrderId), {
    piStoragePath: storagePath,
    piFileName: fileName,
    piContentType: contentType,
    piUploadedAt: uploadedAt,
    piUploadedBy: auth.currentUser?.uid ?? null,
    piTotalAmount: totalAmount,
    piCurrencyCode: currencyCode,
    piDate,
  });

  return {
    storagePath,
    fileName,
    contentType,
    uploadedAt,
    totalAmount,
    currencyCode,
    piDate,
  };
}

export async function persistPurchaseOrderVendorPiTotal(input: {
  purchaseOrderId: string;
  existing: PurchaseOrderVendorPi;
  totalAmount?: number | null;
  currencyCode?: string | null;
  piDate?: string | null;
}): Promise<PurchaseOrderVendorPi> {
  const nextAmount = input.totalAmount != null && Number(input.totalAmount) > 0
    ? Number(input.totalAmount)
    : input.existing.totalAmount;
  const nextCurrency = input.currencyCode?.trim().toUpperCase()
    || input.existing.currencyCode;
  const nextPiDate = parseYmd(input.piDate) || input.existing.piDate;
  if (
    nextAmount === input.existing.totalAmount
    && (nextCurrency || null) === (input.existing.currencyCode || null)
    && (nextPiDate || null) === (input.existing.piDate || null)
  ) {
    return input.existing;
  }
  await updateDoc(doc(db, 'purchaseOrders', input.purchaseOrderId), {
    piTotalAmount: nextAmount,
    piCurrencyCode: nextCurrency,
    piDate: nextPiDate,
  });
  return {
    ...input.existing,
    totalAmount: nextAmount,
    currencyCode: nextCurrency,
    piDate: nextPiDate,
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
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Could not open the vendor PI.');
  }
  return { url, bytes: new Uint8Array(await res.arrayBuffer()), isPdf };
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
