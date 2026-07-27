import {
  collection,
  collectionGroup,
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
  type QuerySnapshot,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../firebase';
import { toSalesOrderDateKey } from './admin-sales-orders';
import { enrichInvoiceDetailImages } from './invoiceLineItemImages';
import {
  getInvoicePeriodBounds,
  invoiceAmountExclGst,
  parseInvoiceCategory,
  sumInvoiceProductQuantity,
} from './invoices';
import {
  appendSalespersonIdConstraint,
  filterRowsBySalespersonScope,
} from './salespersonScope';
import { resolveZohoCustomerDisplayContact } from './zohoCustomerContact';
import type {
  DealerInvoiceDetail,
  DealerInvoiceLineItem,
  InvoiceCategory,
  InvoiceChartPoint,
  InvoiceSalesEntry,
  KpiPeriod,
} from '../types/invoices';

export { toSalesOrderDateKey as toInvoiceDateKey };

export type AdminInvoiceSort = 'syncedAt' | 'date';

export interface AdminFirestoreInvoice {
  id: string;
  customerId: string;
  invoiceNumber: string;
  customerName: string | null;
  salespersonId?: string | null;
  salespersonName?: string | null;
  date: string | null;
  status: string;
  /** Grand total including GST. */
  total: number;
  /** Pre-tax amount (excludes GST). Null on older docs. */
  subtotal: number | null;
  /** GST / tax total. Null on older docs. */
  taxTotal: number | null;
  balance: number;
  referenceNumber: string | null;
  syncedAt: string | null;
  itemQuantity: number | null;
  invoiceCategory: InvoiceCategory | null;
  /** Set when Aggregate mode clubs invoices into one row per dealer. */
  aggregateInvoiceCount?: number;
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

export function mapAdminInvoiceDoc(
  docSnap: QueryDocumentSnapshot<DocumentData>,
): AdminFirestoreInvoice {
  const data = docSnap.data();
  const customerId = String(data.customerId ?? docSnap.ref.parent.parent?.id ?? '');
  const itemQuantity = data.itemQuantity != null
    ? Number(data.itemQuantity)
    : (Array.isArray(data.lineItems)
      ? sumInvoiceProductQuantity(
        data.lineItems.map(item => mapAdminInvoiceLineItem(item as Record<string, unknown>)),
      )
      : null);
  return {
    id: docSnap.id,
    customerId,
    invoiceNumber: String(data.invoiceNumber ?? ''),
    customerName: data.customerName ? String(data.customerName) : null,
    salespersonId: data.salespersonId ? String(data.salespersonId) : null,
    salespersonName: data.salespersonName ? String(data.salespersonName) : null,
    date: data.date ? String(data.date) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    subtotal: data.subtotal != null ? Number(data.subtotal) : null,
    taxTotal: data.taxTotal != null ? Number(data.taxTotal) : null,
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    syncedAt: timestampToIso(data.syncedAt),
    itemQuantity,
    invoiceCategory: parseInvoiceCategory(data.invoiceCategory),
  };
}

export type AdminInvoiceListQuery = {
  sort?: AdminInvoiceSort;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  category?: InvoiceCategory | 'all';
  /** Inclusive YYYY-MM-DD */
  dateStart?: string | null;
  /** Inclusive YYYY-MM-DD */
  dateEnd?: string | null;
  /**
   * When set, restrict to these Zoho salesperson ids.
   * Empty array → no results. Omit / null → org-wide (super admin).
   */
  salespersonIds?: string[] | null;
};

const ADMIN_INVOICES_PAGE_SIZE = 300;
const ADMIN_LIST_PAGE_SIZE = 25;
/** Soft cap when Aggregate mode must scan a bounded date window. */
const ADMIN_AGGREGATE_MAX_ROWS = 2500;

export type AdminInvoiceListCollection = 'invoices' | 'invoiceSummaries';

let cachedListCollection: AdminInvoiceListCollection | null = null;

/** Prefer slim invoiceSummaries after backfill sets invoiceStats/config.listSource. */
export async function resolveAdminInvoiceListCollection(): Promise<AdminInvoiceListCollection> {
  if (cachedListCollection) return cachedListCollection;
  try {
    const snap = await getDoc(doc(db, 'invoiceStats', 'config'));
    const source = snap.exists() ? String(snap.data()?.listSource ?? '') : '';
    cachedListCollection = source === 'summaries' ? 'invoiceSummaries' : 'invoices';
  } catch {
    cachedListCollection = 'invoices';
  }
  return cachedListCollection;
}

export function clearAdminInvoiceListCollectionCache(): void {
  cachedListCollection = null;
}

export function buildAdminInvoicesQuery(options: AdminInvoiceListQuery & {
  listCollection?: AdminInvoiceListCollection;
}) {
  const sort = options.sort ?? 'date';
  const pageSize = Math.max(1, Math.min(Number(options.pageSize ?? ADMIN_LIST_PAGE_SIZE) || ADMIN_LIST_PAGE_SIZE, 500));
  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const listCollection = options.listCollection ?? 'invoices';
  const constraints: QueryConstraint[] = [];

  if (appendSalespersonIdConstraint(constraints, options.salespersonIds) === 'empty') {
    constraints.push(where('salespersonId', '==', '__none__'));
  }

  if (category && category !== 'all') {
    constraints.push(where('invoiceCategory', '==', category));
  }

  // Date inequalities must share orderBy('date'); client re-sorts by syncedAt if needed.
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
  return query(collectionGroup(db, listCollection), ...constraints);
}

function isFirestoreIndexError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /requires an index|COLLECTION_GROUP/i.test(msg);
}

type AdminInvoicesQueryOptions = AdminInvoiceListQuery & {
  listCollection?: AdminInvoiceListCollection;
};

async function getAdminInvoicesQuerySnap(
  options: AdminInvoicesQueryOptions,
  listCollection: AdminInvoiceListCollection,
): Promise<QuerySnapshot<DocumentData>> {
  try {
    return await getDocs(buildAdminInvoicesQuery({ ...options, listCollection }));
  } catch (err) {
    if (listCollection === 'invoiceSummaries' && isFirestoreIndexError(err)) {
      return getDocs(buildAdminInvoicesQuery({ ...options, listCollection: 'invoices' }));
    }
    throw err;
  }
}

export function subscribeAdminInvoices(
  sort: AdminInvoiceSort,
  pageSize: number,
  onData: (rows: AdminFirestoreInvoice[]) => void,
  onError: (message: string) => void,
  category: InvoiceCategory | 'all' = 'all',
  dateStart?: string | null,
  dateEnd?: string | null,
) {
  const q = buildAdminInvoicesQuery({
    sort,
    pageSize,
    cursor: null,
    category,
    dateStart,
    dateEnd,
  });
  return onSnapshot(
    q,
    snap => {
      onData(snap.docs.map(mapAdminInvoiceDoc));
    },
    err => {
      onError(err.message || 'Could not load invoices from Firestore.');
    },
  );
}

export async function fetchAdminInvoicesPage(
  sort: AdminInvoiceSort,
  pageSize: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
  dateStart?: string | null,
  dateEnd?: string | null,
  salespersonIds?: string[] | null,
): Promise<AdminFirestoreInvoice[]> {
  if (
    salespersonIds != null
    && appendSalespersonIdConstraint([], salespersonIds) === 'empty'
  ) {
    return [];
  }
  const listCollection = await resolveAdminInvoiceListCollection();
  const snap = await getAdminInvoicesQuerySnap({
    sort,
    pageSize,
    cursor,
    category,
    dateStart,
    dateEnd,
    salespersonIds,
  }, listCollection);
  return snap.docs.map(mapAdminInvoiceDoc);
}

export async function fetchAdminInvoicesPageResult(options: {
  sort?: AdminInvoiceSort;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  category?: InvoiceCategory | 'all';
  dateStart?: string | null;
  dateEnd?: string | null;
  salespersonIds?: string[] | null;
}): Promise<{
  rows: AdminFirestoreInvoice[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}> {
  if (
    options.salespersonIds != null
    && appendSalespersonIdConstraint([], options.salespersonIds) === 'empty'
  ) {
    return { rows: [], lastDoc: null, hasMore: false };
  }
  const pageSize = options.pageSize ?? ADMIN_LIST_PAGE_SIZE;
  const listCollection = await resolveAdminInvoiceListCollection();
  const snap = await getAdminInvoicesQuerySnap({
    sort: options.sort ?? 'date',
    pageSize,
    cursor: options.cursor ?? null,
    category: options.category ?? 'all',
    dateStart: options.dateStart,
    dateEnd: options.dateEnd,
    salespersonIds: options.salespersonIds,
  }, listCollection);
  return {
    rows: snap.docs.map(mapAdminInvoiceDoc),
    lastDoc: snap.docs[snap.docs.length - 1] ?? null,
    hasMore: snap.size >= pageSize,
  };
}

/**
 * Load invoices in the date window for Aggregate mode only.
 * Soft-capped so All-time aggregate cannot dump 20k+ docs.
 */
export async function fetchAllAdminInvoicesInRange(options: {
  sort?: AdminInvoiceSort;
  category?: InvoiceCategory | 'all';
  dateStart?: string | null;
  dateEnd?: string | null;
  salespersonIds?: string[] | null;
  maxRows?: number;
}): Promise<{ rows: AdminFirestoreInvoice[]; truncated: boolean }> {
  if (
    options.salespersonIds != null
    && appendSalespersonIdConstraint([], options.salespersonIds) === 'empty'
  ) {
    return { rows: [], truncated: false };
  }

  const sort = options.sort ?? 'date';
  const category = options.category ?? 'all';
  const maxRows = options.maxRows ?? ADMIN_AGGREGATE_MAX_ROWS;
  const listCollection = await resolveAdminInvoiceListCollection();
  const rows: AdminFirestoreInvoice[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  let truncated = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pageSnap: QuerySnapshot<DocumentData> = await getAdminInvoicesQuerySnap({
      sort,
      pageSize: ADMIN_INVOICES_PAGE_SIZE,
      cursor,
      category,
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
      salespersonIds: options.salespersonIds,
    }, listCollection);
    if (pageSnap.empty) break;
    rows.push(...pageSnap.docs.map(mapAdminInvoiceDoc));
    cursor = pageSnap.docs[pageSnap.docs.length - 1] ?? null;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    if (pageSnap.size < ADMIN_INVOICES_PAGE_SIZE) break;
  }

  if (sort === 'syncedAt' && (options.dateStart || options.dateEnd)) {
    rows.sort((a, b) => String(b.syncedAt ?? '').localeCompare(String(a.syncedAt ?? '')));
  }

  return { rows: truncated ? rows.slice(0, maxRows) : rows, truncated };
}

export function filterAdminInvoices(
  rows: AdminFirestoreInvoice[],
  searchText: string,
  category: InvoiceCategory | 'all' = 'all',
): AdminFirestoreInvoice[] {
  let next = rows;
  if (category && category !== 'all') {
    next = next.filter(row => row.invoiceCategory === category);
  }
  const needle = searchText.trim().toLowerCase();
  if (!needle) return next;
  return next.filter(row => {
    const haystack = [
      row.invoiceNumber,
      row.customerName,
      row.customerId,
      row.referenceNumber,
      row.id,
      row.status,
      row.invoiceCategory,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function filterAdminInvoicesByPeriod(
  rows: AdminFirestoreInvoice[],
  period: KpiPeriod,
): AdminFirestoreInvoice[] {
  const bounds = getInvoicePeriodBounds(period);
  if (!bounds) return rows;
  return rows.filter(row => {
    if (!row.date) return false;
    const ts = parseInvoiceDay(row.date);
    if (Number.isNaN(ts)) return false;
    return ts >= bounds.start.getTime() && ts <= bounds.end.getTime();
  });
}

function parseInvoiceDay(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? NaN : ts;
}

export function buildAdminSalesEntries(rows: AdminFirestoreInvoice[]): InvoiceSalesEntry[] {
  return rows
    .filter(row => row.date)
    .map(row => ({ date: row.date!, total: invoiceAmountExclGst(row) }));
}

function compareInvoiceSortKey(
  a: AdminFirestoreInvoice,
  b: AdminFirestoreInvoice,
  sort: AdminInvoiceSort,
): number {
  if (sort === 'syncedAt') {
    const aTs = a.syncedAt ? Date.parse(a.syncedAt) : 0;
    const bTs = b.syncedAt ? Date.parse(b.syncedAt) : 0;
    return bTs - aTs;
  }
  const aTs = a.date ? parseInvoiceDay(a.date) : NaN;
  const bTs = b.date ? parseInvoiceDay(b.date) : NaN;
  const aSafe = Number.isNaN(aTs) ? 0 : aTs;
  const bSafe = Number.isNaN(bTs) ? 0 : bTs;
  return bSafe - aSafe;
}

/** Club invoices into one row per dealer (sums amounts / qty; latest date). */
export function aggregateAdminInvoicesByDealer(
  rows: AdminFirestoreInvoice[],
  sort: AdminInvoiceSort = 'date',
): AdminFirestoreInvoice[] {
  const byCustomer = new Map<string, AdminFirestoreInvoice[]>();
  for (const row of rows) {
    const key = row.customerId || '__unknown__';
    const list = byCustomer.get(key);
    if (list) list.push(row);
    else byCustomer.set(key, [row]);
  }

  const aggregates: AdminFirestoreInvoice[] = [];
  for (const [customerId, invoices] of byCustomer) {
    const ordered = [...invoices].sort((a, b) => compareInvoiceSortKey(a, b, sort));
    const latest = ordered[0];

    let total = 0;
    let balance = 0;
    let itemQuantity = 0;
    let subtotalSum = 0;
    let taxTotalSum = 0;
    let hasSubtotal = false;
    let hasTaxTotal = false;
    const categories = new Set<InvoiceCategory>();

    for (const inv of invoices) {
      total += Number(inv.total ?? 0);
      balance += Number(inv.balance ?? 0);
      if (inv.itemQuantity != null) itemQuantity += inv.itemQuantity;
      if (inv.subtotal != null) {
        subtotalSum += inv.subtotal;
        hasSubtotal = true;
      }
      if (inv.taxTotal != null) {
        taxTotalSum += inv.taxTotal;
        hasTaxTotal = true;
      }
      if (inv.invoiceCategory) categories.add(inv.invoiceCategory);
    }

    const count = invoices.length;
    aggregates.push({
      id: count === 1 ? latest.id : `agg-${customerId}`,
      customerId: customerId === '__unknown__' ? '' : customerId,
      invoiceNumber: count === 1 ? (latest.invoiceNumber || latest.id) : `${count} invoices`,
      customerName: latest.customerName,
      date: latest.date,
      status: count === 1 ? latest.status : 'aggregated',
      total,
      subtotal: hasSubtotal ? subtotalSum : null,
      taxTotal: hasTaxTotal ? taxTotalSum : null,
      balance,
      referenceNumber: count === 1 ? latest.referenceNumber : null,
      syncedAt: latest.syncedAt,
      itemQuantity: invoices.some(inv => inv.itemQuantity != null) ? itemQuantity : null,
      invoiceCategory: categories.size === 1 ? [...categories][0]! : null,
      aggregateInvoiceCount: count,
    });
  }

  // Highest excl-GST amount first; break ties by latest invoice date.
  return aggregates.sort((a, b) => {
    const amountDiff = invoiceAmountExclGst(b) - invoiceAmountExclGst(a);
    if (amountDiff !== 0) return amountDiff;
    return compareInvoiceSortKey(a, b, sort);
  });
}

export function buildAdminDailySales(
  rows: AdminFirestoreInvoice[],
  dayCount = 30,
): InvoiceChartPoint[] {
  const now = new Date();
  const dailySales: InvoiceChartPoint[] = [];

  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - i);
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    let dayTotal = 0;
    for (const row of rows) {
      if (!row.date) continue;
      const ts = parseInvoiceDay(row.date);
      if (Number.isNaN(ts)) continue;
      if (ts >= dayStart.getTime() && ts <= dayEnd.getTime()) {
        dayTotal += invoiceAmountExclGst(row);
      }
    }

    dailySales.push({
      label: day.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      total: dayTotal,
    });
  }

  return dailySales;
}

export function sumAdminOutstanding(rows: AdminFirestoreInvoice[]): number {
  return rows.reduce((sum, row) => sum + row.balance, 0);
}

export function countAdminInvoicesByStatus(
  rows: AdminFirestoreInvoice[],
  status: string,
): number {
  return rows.filter(row => row.status.toLowerCase() === status.toLowerCase()).length;
}

export type AdminInvoiceCategoryCounts = {
  all: number;
  product: number;
  spare: number;
  software_key: number;
  service: number;
  gatc: number;
};

export async function countAdminInvoices(options: {
  category?: InvoiceCategory | 'all';
  dateStart?: string | null;
  dateEnd?: string | null;
  salespersonIds?: string[] | null;
}): Promise<number> {
  if (
    options.salespersonIds != null
    && appendSalespersonIdConstraint([], options.salespersonIds) === 'empty'
  ) {
    return 0;
  }

  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const listCollection = await resolveAdminInvoiceListCollection();
  const constraints: QueryConstraint[] = [];

  if (appendSalespersonIdConstraint(constraints, options.salespersonIds) === 'empty') {
    return 0;
  }
  if (category && category !== 'all') {
    constraints.push(where('invoiceCategory', '==', category));
  }
  if (dateStart || dateEnd) {
    if (dateStart) constraints.push(where('date', '>=', dateStart));
    if (dateEnd) constraints.push(where('date', '<=', dateEnd));
    constraints.push(orderBy('date', 'desc'));
  } else {
    constraints.push(orderBy('date', 'desc'));
  }

  const countQuery = query(collectionGroup(db, listCollection), ...constraints);
  try {
    const snap = await getCountFromServer(countQuery);
    return snap.data().count;
  } catch (err) {
    if (listCollection === 'invoiceSummaries' && isFirestoreIndexError(err)) {
      const fallback = query(collectionGroup(db, 'invoices'), ...constraints);
      const snap = await getCountFromServer(fallback);
      return snap.data().count;
    }
    throw err;
  }
}

/**
 * Live Firestore SUM() on collectionGroup('invoices') fails with failed-precondition
 * (mixed/missing numeric fields across ~20k docs). Amount KPIs come from rollups only.
 */
export async function sumAdminInvoiceAmount(_options: {
  category?: InvoiceCategory | 'all';
  dateStart?: string | null;
  dateEnd?: string | null;
  salespersonIds?: string[] | null;
}): Promise<number> {
  return 0;
}

/** One-time seed of invoiceStats / invoiceMonthStats / invoiceSummaries (super admin). */
export async function runInvoiceStatsBackfill(): Promise<{
  invoiceCount: number;
  summaryCount: number;
  monthDocs: number;
}> {
  const functions = getFunctions(app, 'asia-south1');
  const callable = httpsCallable<
    Record<string, never>,
    { invoiceCount: number; summaryCount: number; monthDocs: number }
  >(functions, 'backfillInvoiceStatsAndSummariesFn', { timeout: 540_000 });
  const result = await callable({});
  clearAdminInvoiceListCollectionCache();
  return result.data;
}

export type AdminInvoiceStatsKpi = {
  invoiceCount: number;
  totalAmount: number;
  categoryCounts: AdminInvoiceCategoryCounts;
  source: 'rollup' | 'query';
};

function emptyCategoryCounts(): AdminInvoiceCategoryCounts {
  return {
    all: 0,
    product: 0,
    spare: 0,
    software_key: 0,
    service: 0,
    gatc: 0,
  };
}

function monthKeysForRange(dateStart: string | null, dateEnd: string | null): string[] | null {
  if (!dateStart || !dateEnd) return null;
  const start = dateStart.slice(0, 7);
  const end = dateEnd.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return null;
  const keys: string[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  // Cap multi-month rollup reads
  for (let i = 0; i < 24; i += 1) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    keys.push(key);
    if (y === ey && m === em) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

/**
 * Prefer precomputed invoiceStats / invoiceMonthStats when salesperson is org-wide.
 * Falls back to count + sum queries.
 */
export async function loadAdminInvoiceKpis(options: {
  dateStart?: string | null;
  dateEnd?: string | null;
  category?: InvoiceCategory | 'all';
  salespersonIds?: string[] | null;
}): Promise<AdminInvoiceStatsKpi> {
  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const scoped = options.salespersonIds != null;

  if (!scoped) {
    try {
      if (!dateStart && !dateEnd) {
        const org = await getDoc(doc(db, 'invoiceStats', 'org'));
        if (org.exists()) {
          const data = org.data() ?? {};
          const byCategory = (data.byCategory ?? {}) as Record<string, number>;
          const amountByCategory = (data.amountByCategory ?? {}) as Record<string, number>;
          const categoryCounts: AdminInvoiceCategoryCounts = {
            all: Number(data.count ?? 0),
            product: Number(byCategory.product ?? 0),
            spare: Number(byCategory.spare ?? 0),
            software_key: Number(byCategory.software_key ?? 0),
            service: Number(byCategory.service ?? 0),
            gatc: Number(byCategory.gatc ?? 0),
          };
          const totalAmount = category === 'all'
            ? Number(data.amount ?? 0)
            : Number(amountByCategory[category] ?? 0);
          const invoiceCount = category === 'all'
            ? categoryCounts.all
            : categoryCounts[category];
          return {
            invoiceCount,
            totalAmount,
            categoryCounts,
            source: 'rollup',
          };
        }
      } else {
        const keys = monthKeysForRange(dateStart, dateEnd);
        if (keys?.length) {
          const snaps = await Promise.all(
            keys.map(key => getDoc(doc(db, 'invoiceMonthStats', key))),
          );
          const categoryCounts = emptyCategoryCounts();
          let totalAmountAll = 0;
          const amountByCategory: Record<string, number> = {
            product: 0, spare: 0, software_key: 0, service: 0, gatc: 0,
          };
          let any = false;
          for (const snap of snaps) {
            if (!snap.exists()) continue;
            any = true;
            const data = snap.data() ?? {};
            categoryCounts.all += Number(data.count ?? 0);
            totalAmountAll += Number(data.amount ?? 0);
            const byCategory = (data.byCategory ?? {}) as Record<string, number>;
            const amounts = (data.amountByCategory ?? {}) as Record<string, number>;
            for (const key of ['product', 'spare', 'software_key', 'service', 'gatc'] as const) {
              categoryCounts[key] += Number(byCategory[key] ?? 0);
              amountByCategory[key] += Number(amounts[key] ?? 0);
            }
          }
          if (any) {
            return {
              invoiceCount: category === 'all' ? categoryCounts.all : categoryCounts[category],
              totalAmount: category === 'all' ? totalAmountAll : amountByCategory[category],
              categoryCounts,
              source: 'rollup',
            };
          }
        }
      }
    } catch {
      // fall through to live queries
    }
  }

  // Counts only — amount requires rollups (run backfillInvoiceStatsAndSummariesFn once).
  const categoryCounts = await countAdminInvoicesByCategory({
    dateStart,
    dateEnd,
    salespersonIds: options.salespersonIds,
  });

  return {
    invoiceCount: category === 'all' ? categoryCounts.all : categoryCounts[category],
    totalAmount: 0,
    categoryCounts,
    source: 'query',
  };
}

export async function countAdminInvoicesByCategory(options: {
  dateStart?: string | null;
  dateEnd?: string | null;
  salespersonIds?: string[] | null;
}): Promise<AdminInvoiceCategoryCounts> {
  const base = {
    dateStart: options.dateStart ?? null,
    dateEnd: options.dateEnd ?? null,
    salespersonIds: options.salespersonIds ?? null,
  } as const;

  const [all, product, spare, software_key, service, gatc] = await Promise.all([
    countAdminInvoices({ ...base, category: 'all' }),
    countAdminInvoices({ ...base, category: 'product' }),
    countAdminInvoices({ ...base, category: 'spare' }),
    countAdminInvoices({ ...base, category: 'software_key' }),
    countAdminInvoices({ ...base, category: 'service' }),
    countAdminInvoices({ ...base, category: 'gatc' }),
  ]);

  return { all, product, spare, software_key, service, gatc };
}

export function countInvoiceRowsByCategory(
  rows: AdminFirestoreInvoice[],
): AdminInvoiceCategoryCounts {
  const counts: AdminInvoiceCategoryCounts = {
    all: rows.length,
    product: 0,
    spare: 0,
    software_key: 0,
    service: 0,
    gatc: 0,
  };
  for (const row of rows) {
    const key = row.invoiceCategory;
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
 * Load invoices for one or more dealers (newest-first per customer), then merge.
 * Used when the admin filter sheet selects specific dealers.
 */
export async function fetchAdminInvoicesForCustomers(options: {
  customerIds: string[];
  dateStart?: string | null;
  dateEnd?: string | null;
  category?: InvoiceCategory | 'all';
  sort?: AdminInvoiceSort;
  salespersonIds?: string[] | null;
}): Promise<AdminFirestoreInvoice[]> {
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
  const pageSize = 100;

  const perCustomer = await Promise.all(ids.map(async customerId => {
    const rows: AdminFirestoreInvoice[] = [];
    let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const constraints: QueryConstraint[] = [];
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
      constraints.push(limit(pageSize));

      const snap = await getDocs(
        query(collection(db, 'zohoCustomers', customerId, 'invoices'), ...constraints),
      );
      if (snap.empty) break;
      rows.push(...snap.docs.map(mapAdminInvoiceDoc));
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.size < pageSize) break;
    }
    return rows;
  }));

  let merged = filterRowsBySalespersonScope(perCustomer.flat(), options.salespersonIds);

  if (options.category && options.category !== 'all') {
    merged = merged.filter(row => row.invoiceCategory === options.category);
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

export interface AdminCustomerLocation {
  district: string | null;
  state: string | null;
}

export function formatAdminCustomerLocation(location: AdminCustomerLocation | undefined): string | null {
  if (!location) return null;
  const parts = [location.district, location.state].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export async function fetchAdminCustomerLocations(
  customerIds: string[],
): Promise<Map<string, AdminCustomerLocation>> {
  const unique = [...new Set(customerIds.filter(Boolean))];
  const map = new Map<string, AdminCustomerLocation>();
  await Promise.all(
    unique.map(async customerId => {
      try {
        const snap = await getDoc(doc(db, 'zohoCustomers', customerId));
        if (!snap.exists()) return;
        const data = snap.data();
        map.set(customerId, {
          district: data.district ? String(data.district) : null,
          state: data.billingState ? String(data.billingState) : null,
        });
      } catch {
        // ignore per-customer lookup failures
      }
    }),
  );
  return map;
}

function mapAdminInvoiceLineItem(raw: Record<string, unknown>): DealerInvoiceLineItem {
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

export function mapAdminInvoiceDetail(
  invoiceId: string,
  data: DocumentData,
): DealerInvoiceDetail {
  return {
    id: String(data.id ?? invoiceId),
    invoiceNumber: String(data.invoiceNumber ?? ''),
    date: data.date ? String(data.date) : null,
    dueDate: data.dueDate ? String(data.dueDate) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    lastPaymentDate: data.lastPaymentDate ? String(data.lastPaymentDate) : null,
    currencyCode: data.currencyCode ? String(data.currencyCode) : 'INR',
    customerName: data.customerName ? String(data.customerName) : null,
    salespersonId: data.salespersonId ? String(data.salespersonId) : null,
    salespersonName: data.salespersonName ? String(data.salespersonName) : null,
    invoiceUrl: data.invoiceUrl ? String(data.invoiceUrl) : null,
    invoiceCategory: parseInvoiceCategory(data.invoiceCategory),
    salesOrderId: data.salesOrderId ? String(data.salesOrderId) : null,
    salesOrderNumber: data.salesOrderNumber ? String(data.salesOrderNumber) : null,
    subtotal: Number(data.subtotal ?? 0),
    taxTotal: Number(data.taxTotal ?? 0),
    notes: data.notes ? String(data.notes) : null,
    lineItems: Array.isArray(data.lineItems)
      ? data.lineItems.map(item => mapAdminInvoiceLineItem(item as Record<string, unknown>))
      : [],
  };
}

export async function fetchAdminInvoiceDetail(
  customerId: string,
  invoiceId: string,
): Promise<DealerInvoiceDetail> {
  const snap = await getDoc(doc(db, 'zohoCustomers', customerId, 'invoices', invoiceId));
  if (!snap.exists()) {
    throw new Error('Invoice not found.');
  }
  const data = snap.data();
  const detail = mapAdminInvoiceDetail(invoiceId, data);
  const preferredAddress = String(
    data.shippingAddress || data.billingAddress || '',
  ).trim() || null;
  const [withImages, contact] = await Promise.all([
    enrichInvoiceDetailImages(detail),
    resolveZohoCustomerDisplayContact(customerId, preferredAddress),
  ]);
  return {
    ...withImages,
    shippingAddress: contact.address,
    customerPhone: contact.phone,
    customerTelHref: contact.telHref,
    customerWhatsappHref: contact.whatsappHref,
  };
}
