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
  serverTimestamp,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, app } from '../firebase';
import { getOpenAuditCycle } from './auditCycles/data';
import { recordCatalogProductAudit } from './catalogProductAudit/data';
import {
  getCatalogSiteInventory,
  saveCatalogSiteInventory,
} from './catalogSiteInventory/data';
import { enrichInvoiceDetailImages } from './invoiceLineItemImages';
import {
  getInvoicePeriodBounds,
  invoiceErrorMessage,
  normalizeInvoiceCategories,
  normalizeInvoiceCategoryAmounts,
  parseInvoiceCategory,
  sumInvoiceProductQuantity,
} from './invoices';
import type {
  CatalogSiteInventoryLocationRow,
} from '../types/catalog-site-inventory';
import {
  getCatalogSiteInventoryLocations,
} from '../types/catalog-site-inventory';
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
export type GoodsReceiptLocation = 'head_office' | 'cochin';
export type GoodsReceiptLocationFilter = GoodsReceiptLocation | 'all';

export type AdminGoodsReceiptListQuery = {
  sort?: AdminGoodsReceiptSort;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  /** @deprecated Prefer location */
  category?: InvoiceCategory | 'all';
  location?: GoodsReceiptLocationFilter;
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
  locationId: string | null;
  locationName: string | null;
  inventorySite: GoodsReceiptLocation | null;
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
  /** Vendor billing state / province when Zoho provides it. */
  vendorState: string | null;
  /** Vendor billing country when Zoho provides it. */
  vendorCountry: string | null;
  vendorCity: string | null;
  locationId: string | null;
  locationName: string | null;
  inventorySite: GoodsReceiptLocation | null;
  goodsReceiptCategory: InvoiceCategory | null;
  categories: InvoiceCategory[];
  categoryAmounts: Partial<Record<InvoiceCategory, number>>;
  subtotal: number;
  taxTotal: number;
  notes: string | null;
  lineItems: DealerInvoiceLineItem[];
  /** Ops receive check — keyed by Zoho line item id. */
  receiveCheck: GoodsReceiptReceiveCheck | null;
}

export type GoodsReceiptReceiveLocation = {
  zoneId: string;
  zoneRowNumber: number;
  quantity: number;
};

export type GoodsReceiptReceiveLine = {
  /** Total received qty (sum of location quantities, or standalone when no locations). */
  receivedQty: number;
  /**
   * Legacy single placement — mirrored from locations[0] when present.
   * Prefer `locations`.
   */
  zoneId: string | null;
  zoneRowNumber: number | null;
  /** Warehouse placements for this line (zone + row + qty each). */
  locations: GoodsReceiptReceiveLocation[];
};

export type GoodsReceiptReceiveCheck = {
  /** Per-line receive verification (preferred). */
  lines: Record<string, GoodsReceiptReceiveLine>;
  /** Legacy qty-only map — kept in sync when saving. */
  byLineId: Record<string, number>;
  updatedAt: string | null;
  updatedByUid: string | null;
  updatedByName: string | null;
};

/** Normalize placements from a saved receive line (supports legacy single zone/row). */
export function receiveLineLocations(
  line: GoodsReceiptReceiveLine | null | undefined,
): GoodsReceiptReceiveLocation[] {
  if (!line) return [];
  if (Array.isArray(line.locations) && line.locations.length > 0) {
    return line.locations
      .map(loc => ({
        zoneId: String(loc.zoneId ?? '').trim().toLowerCase(),
        zoneRowNumber: Math.max(1, Math.floor(Number(loc.zoneRowNumber))),
        quantity: Math.max(0, Number(loc.quantity)),
      }))
      .filter(loc => loc.zoneId && Number.isFinite(loc.zoneRowNumber) && Number.isFinite(loc.quantity));
  }
  if (line.zoneId && line.zoneRowNumber != null && Number(line.receivedQty) > 0) {
    return [{
      zoneId: String(line.zoneId).trim().toLowerCase(),
      zoneRowNumber: Math.max(1, Math.floor(Number(line.zoneRowNumber))),
      quantity: Math.max(0, Number(line.receivedQty)),
    }];
  }
  return [];
}

export interface AdminGoodsReceiptsPageResult {
  rows: AdminFirestoreGoodsReceipt[];
  docs: QueryDocumentSnapshot<DocumentData>[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
}

export type AdminGoodsReceiptLocationCounts = {
  all: number;
  head_office: number;
  cochin: number;
};

export function parseGoodsReceiptLocation(value: unknown): GoodsReceiptLocation | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const s = raw.replace(/\s+/g, '_');
  if (s === 'head_office' || s === 'headoffice' || (raw.includes('head') && raw.includes('office'))) {
    return 'head_office';
  }
  if (s === 'cochin' || raw.includes('cochin') || raw.includes('kochi')) return 'cochin';
  return null;
}

export function goodsReceiptLocationLabel(
  site: GoodsReceiptLocation | null | undefined,
): string {
  if (site === 'head_office') return 'Head office';
  if (site === 'cochin') return 'Cochin';
  return '—';
}

/** Zoho draft purchase bills are shown as Scheduled in Goods receipt. */
export function goodsReceiptStatusLabel(status: string): string {
  const key = String(status ?? '').trim().toLowerCase();
  if (key === 'draft') return 'Scheduled';
  if (!key) return '—';
  return key.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
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
    locationId: data.locationId != null ? String(data.locationId) : null,
    locationName: data.locationName ? String(data.locationName) : null,
    inventorySite: parseGoodsReceiptLocation(data.inventorySite)
      ?? parseGoodsReceiptLocation(data.branchName)
      ?? parseGoodsReceiptLocation(data.locationName),
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
  const location = options.location ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const constraints: QueryConstraint[] = [];

  if (location && location !== 'all') {
    constraints.push(where('inventorySite', '==', location));
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
  location: GoodsReceiptLocationFilter = 'all',
) {
  return buildAdminGoodsReceiptsQuery({ sort, pageSize, cursor, location });
}

export function subscribeAdminGoodsReceipts(
  sort: AdminGoodsReceiptSort,
  pageSize: number,
  onData: (rows: AdminFirestoreGoodsReceipt[]) => void,
  onError: (message: string) => void,
  location: GoodsReceiptLocationFilter = 'all',
) {
  const q = buildAdminGoodsReceiptsQuery({ sort, pageSize, cursor: null, location });
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
  location: GoodsReceiptLocationFilter = 'all',
): Promise<AdminFirestoreGoodsReceipt[]> {
  const options: AdminGoodsReceiptListQuery = typeof sortOrOptions === 'string'
    ? { sort: sortOrOptions, pageSize, cursor, location }
    : sortOrOptions;
  const result = await fetchAdminGoodsReceiptsPageDetailed(options);
  return result.rows;
}

export async function countAdminGoodsReceipts(
  options: Omit<AdminGoodsReceiptListQuery, 'pageSize' | 'cursor'>,
): Promise<number> {
  const sort = options.sort ?? 'date';
  const location = options.location ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const constraints: QueryConstraint[] = [];

  if (location && location !== 'all') {
    constraints.push(where('inventorySite', '==', location));
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

export async function countAdminGoodsReceiptsByLocation(options: {
  dateStart?: string | null;
  dateEnd?: string | null;
}): Promise<AdminGoodsReceiptLocationCounts> {
  const base = {
    dateStart: options.dateStart ?? null,
    dateEnd: options.dateEnd ?? null,
  } as const;

  const [all, head_office, cochin] = await Promise.all([
    countAdminGoodsReceipts({ ...base, location: 'all' }),
    countAdminGoodsReceipts({ ...base, location: 'head_office' }),
    countAdminGoodsReceipts({ ...base, location: 'cochin' }),
  ]);

  return { all, head_office, cochin };
}

export async function fetchAllAdminGoodsReceiptsInRange(options: {
  sort?: AdminGoodsReceiptSort;
  location?: GoodsReceiptLocationFilter;
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
      location: options.location ?? 'all',
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
  location: GoodsReceiptLocationFilter = 'all',
): AdminFirestoreGoodsReceipt[] {
  let next = rows;
  if (location && location !== 'all') {
    next = next.filter(row => row.inventorySite === location);
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
      row.locationName,
      row.inventorySite,
      goodsReceiptLocationLabel(row.inventorySite),
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

function mapReceiveCheck(raw: unknown): GoodsReceiptReceiveCheck | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const lines: Record<string, GoodsReceiptReceiveLine> = {};
  const byLineId: Record<string, number> = {};

  const linesRaw = data.lines;
  if (linesRaw && typeof linesRaw === 'object') {
    for (const [key, value] of Object.entries(linesRaw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const row = value as Record<string, unknown>;
      const qty = Number(row.receivedQty);
      if (!Number.isFinite(qty)) continue;
      const zoneId = row.zoneId != null && String(row.zoneId).trim()
        ? String(row.zoneId).trim().toLowerCase()
        : null;
      const zoneRowNumber = row.zoneRowNumber != null && Number.isFinite(Number(row.zoneRowNumber))
        ? Math.max(1, Math.floor(Number(row.zoneRowNumber)))
        : null;
      const locationsRaw = Array.isArray(row.locations) ? row.locations : [];
      const locations: GoodsReceiptReceiveLocation[] = locationsRaw
        .filter((loc): loc is Record<string, unknown> => Boolean(loc) && typeof loc === 'object')
        .map(loc => ({
          zoneId: String(loc.zoneId ?? '').trim().toLowerCase(),
          zoneRowNumber: Math.max(1, Math.floor(Number(loc.zoneRowNumber))),
          quantity: Math.max(0, Number(loc.quantity)),
        }))
        .filter(loc => (
          loc.zoneId
          && Number.isFinite(loc.zoneRowNumber)
          && Number.isFinite(loc.quantity)
          && loc.quantity > 0
        ));
      const normalizedLocations = locations.length > 0
        ? locations
        : (zoneId && zoneRowNumber != null && qty > 0
          ? [{ zoneId, zoneRowNumber, quantity: qty }]
          : []);
      const receivedQty = normalizedLocations.length > 0
        ? normalizedLocations.reduce((sum, loc) => sum + loc.quantity, 0)
        : qty;
      const first = normalizedLocations[0] ?? null;
      lines[key] = {
        receivedQty,
        zoneId: first?.zoneId ?? zoneId,
        zoneRowNumber: first?.zoneRowNumber ?? zoneRowNumber,
        locations: normalizedLocations,
      };
      byLineId[key] = receivedQty;
    }
  }

  // Legacy: byLineId only
  const byLineRaw = data.byLineId;
  if (byLineRaw && typeof byLineRaw === 'object') {
    for (const [key, value] of Object.entries(byLineRaw as Record<string, unknown>)) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      byLineId[key] = n;
      if (!lines[key]) {
        lines[key] = { receivedQty: n, zoneId: null, zoneRowNumber: null, locations: [] };
      }
    }
  }

  return {
    lines,
    byLineId,
    updatedAt: timestampToIso(data.updatedAt),
    updatedByUid: data.updatedByUid != null ? String(data.updatedByUid) : null,
    updatedByName: data.updatedByName != null ? String(data.updatedByName) : null,
  };
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
    vendorState: data.vendorState ? String(data.vendorState) : null,
    vendorCountry: data.vendorCountry ? String(data.vendorCountry) : null,
    vendorCity: data.vendorCity ? String(data.vendorCity) : null,
    locationId: data.locationId != null ? String(data.locationId) : null,
    locationName: data.locationName ? String(data.locationName) : null,
    inventorySite: parseGoodsReceiptLocation(data.inventorySite)
      ?? parseGoodsReceiptLocation(data.branchName)
      ?? parseGoodsReceiptLocation(data.locationName),
    goodsReceiptCategory: parseInvoiceCategory(data.goodsReceiptCategory),
    categories: normalizeInvoiceCategories(data.categories),
    categoryAmounts: normalizeInvoiceCategoryAmounts(data.categoryAmounts),
    subtotal: Number(data.subtotal ?? 0),
    taxTotal: Number(data.taxTotal ?? 0),
    notes: data.notes ? String(data.notes) : null,
    lineItems: Array.isArray(data.lineItems)
      ? data.lineItems.map(item => mapLineItem(item as Record<string, unknown>))
      : [],
    receiveCheck: mapReceiveCheck(data.receiveCheck),
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

type GoodsReceiptReceiveLineInput = {
  locations: Array<{
    zoneId: string;
    zoneRowNumber: number;
    quantity: number;
  }>;
};

function normalizeReceiveLines(
  inputLines: Record<string, GoodsReceiptReceiveLineInput>,
): { lines: Record<string, GoodsReceiptReceiveLine>; byLineId: Record<string, number> } {
  const lines: Record<string, GoodsReceiptReceiveLine> = {};
  const byLineId: Record<string, number> = {};
  for (const [lineId, value] of Object.entries(inputLines)) {
    const key = String(lineId || '').trim();
    if (!key) continue;
    const locations: GoodsReceiptReceiveLocation[] = [];
    for (const loc of value.locations ?? []) {
      const zoneId = String(loc.zoneId ?? '').trim().toLowerCase();
      const zoneRowNumber = Number(loc.zoneRowNumber);
      const quantity = Number(loc.quantity);
      if (!zoneId && !Number.isFinite(zoneRowNumber) && !(Number.isFinite(quantity) && quantity > 0)) {
        continue;
      }
      if (!zoneId || !Number.isFinite(zoneRowNumber) || zoneRowNumber < 1) {
        throw new Error('Each warehouse location needs a zone and row.');
      }
      if (!Number.isFinite(quantity) || quantity < 0) {
        throw new Error('Location qty must be a non-negative number.');
      }
      if (quantity <= 0) continue;
      locations.push({
        zoneId,
        zoneRowNumber: Math.max(1, Math.floor(zoneRowNumber)),
        quantity: Math.floor(quantity),
      });
    }
    // Merge duplicate zone/row pairs on the same line.
    const merged = new Map<string, GoodsReceiptReceiveLocation>();
    for (const loc of locations) {
      const mergeKey = `${loc.zoneId}:${loc.zoneRowNumber}`;
      const existing = merged.get(mergeKey);
      if (existing) {
        existing.quantity += loc.quantity;
      } else {
        merged.set(mergeKey, { ...loc });
      }
    }
    const normalizedLocations = [...merged.values()];
    const receivedQty = normalizedLocations.reduce((sum, loc) => sum + loc.quantity, 0);
    const first = normalizedLocations[0] ?? null;
    lines[key] = {
      receivedQty,
      zoneId: first?.zoneId ?? null,
      zoneRowNumber: first?.zoneRowNumber ?? null,
      locations: normalizedLocations,
    };
    byLineId[key] = receivedQty;
  }
  return { lines, byLineId };
}

function receiveLineHasPlacement(line: GoodsReceiptReceiveLine | null | undefined): boolean {
  return receiveLineLocations(line).some(loc => loc.quantity > 0);
}

function applyLocationDelta(
  locations: CatalogSiteInventoryLocationRow[],
  zoneId: string,
  zoneRowNumber: number,
  deltaQty: number,
): CatalogSiteInventoryLocationRow[] {
  if (!deltaQty) return locations;
  const zone = zoneId.trim().toLowerCase();
  const row = Math.max(1, Math.floor(zoneRowNumber));
  const next = locations.map(loc => ({ ...loc }));
  const idx = next.findIndex(loc => loc.zoneId === zone && loc.zoneRowNumber === row);
  if (idx >= 0) {
    next[idx] = {
      ...next[idx],
      quantity: Math.max(0, next[idx].quantity + deltaQty),
    };
  } else if (deltaQty > 0) {
    next.push({ zoneId: zone, zoneRowNumber: row, quantity: Math.floor(deltaQty) });
  }
  return next.filter(loc => loc.quantity > 0);
}

/**
 * Persist receive check, place zone/row qty onto Cochin site inventory (delta vs previous),
 * and write a product audit log for each affected catalog item.
 */
export async function saveGoodsReceiptReceiveCheck(
  goodsReceiptId: string,
  input: {
    lines: Record<string, GoodsReceiptReceiveLineInput>;
    lineItems: DealerInvoiceLineItem[];
    previous: GoodsReceiptReceiveCheck | null;
  },
  actor: { uid: string; displayName?: string | null },
): Promise<GoodsReceiptReceiveCheck> {
  const id = String(goodsReceiptId || '').trim();
  if (!id) throw new Error('Goods receipt id is required.');

  const { lines, byLineId } = normalizeReceiveLines(input.lines);
  const previousLines = input.previous?.lines ?? {};
  const itemIdByLineId = new Map(
    input.lineItems
      .filter(line => line.id)
      .map(line => [line.id, line.itemId?.trim() || null] as const),
  );

  const placementLineIds = new Set<string>([
    ...Object.keys(lines).filter(lineId => receiveLineHasPlacement(lines[lineId])),
    ...Object.keys(previousLines).filter(lineId => receiveLineHasPlacement(previousLines[lineId])),
  ]);

  let openCycleId: string | null = null;
  if (placementLineIds.size > 0) {
    const openCycle = await getOpenAuditCycle('cochin');
    if (!openCycle?.id) {
      throw new Error('No open audit cycle for Cochin. Counting is locked — open a cycle to place stock.');
    }
    openCycleId = openCycle.id;

    for (const lineId of placementLineIds) {
      const itemId = itemIdByLineId.get(lineId);
      const lineName = input.lineItems.find(l => l.id === lineId)?.name ?? lineId;
      const needsForward = receiveLineHasPlacement(lines[lineId]);
      if (!itemId) {
        if (needsForward) {
          throw new Error(`No catalog product linked for ${lineName} — cannot place zone/row.`);
        }
        continue;
      }
      const productSnap = await getDoc(doc(db, 'catalogProducts', itemId));
      if (!productSnap.exists()) {
        if (needsForward) {
          throw new Error(`Catalog product not found for ${lineName}.`);
        }
        continue;
      }
    }
  }

  // Aggregate location deltas per catalog product (reverse old placement, apply new).
  const deltasByProduct = new Map<string, CatalogSiteInventoryLocationRow[]>();

  const ensureProductLocations = async (catalogProductId: string) => {
    let locs = deltasByProduct.get(catalogProductId);
    if (locs) return locs;
    const existing = await getCatalogSiteInventory(catalogProductId, 'cochin');
    locs = getCatalogSiteInventoryLocations(existing).map(row => ({ ...row }));
    deltasByProduct.set(catalogProductId, locs);
    return locs;
  };

  for (const lineId of placementLineIds) {
    const catalogProductId = itemIdByLineId.get(lineId);
    if (!catalogProductId) continue;
    const prevLocs = receiveLineLocations(previousLines[lineId]);
    const nextLocs = receiveLineLocations(lines[lineId]);
    let working = await ensureProductLocations(catalogProductId);

    for (const loc of prevLocs) {
      working = applyLocationDelta(working, loc.zoneId, loc.zoneRowNumber, -loc.quantity);
    }
    for (const loc of nextLocs) {
      working = applyLocationDelta(working, loc.zoneId, loc.zoneRowNumber, loc.quantity);
    }
    deltasByProduct.set(catalogProductId, working);
  }

  const receiveCheck = {
    lines,
    byLineId,
    updatedAt: serverTimestamp(),
    updatedByUid: actor.uid,
    updatedByName: actor.displayName?.trim() || null,
  };

  try {
    await updateDoc(doc(db, 'goodsReceipts', id), { receiveCheck });
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }

  const auditedProducts = new Set<string>();
  try {
    for (const [catalogProductId, locations] of deltasByProduct) {
      await saveCatalogSiteInventory({
        catalogProductId,
        site: 'cochin',
        locations,
        updatedByUid: actor.uid,
        updatedByName: actor.displayName,
      });
      if (openCycleId) {
        await recordCatalogProductAudit(catalogProductId, 'cochin_inventory', openCycleId);
        auditedProducts.add(catalogProductId);
      }
    }
  } catch (err) {
    // Receive check already saved — surface inventory/audit failure clearly.
    const detail = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(
      `Receive check saved, but warehouse / audit update failed (${auditedProducts.size} product(s) audited): ${detail}`,
    );
  }

  return {
    lines,
    byLineId,
    updatedAt: new Date().toISOString(),
    updatedByUid: actor.uid,
    updatedByName: actor.displayName?.trim() || null,
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
