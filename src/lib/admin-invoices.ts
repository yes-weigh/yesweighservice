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
import { db } from '../firebase';
import { toSalesOrderDateKey } from './admin-sales-orders';
import { enrichInvoiceDetailImages } from './invoiceLineItemImages';
import {
  getInvoicePeriodBounds,
  invoiceAmountExclGst,
  parseInvoiceCategory,
  sumInvoiceProductQuantity,
} from './invoices';
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
  const lineItems = Array.isArray(data.lineItems)
    ? data.lineItems.map(item => mapAdminInvoiceLineItem(item as Record<string, unknown>))
    : [];
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
    itemQuantity: lineItems.length ? sumInvoiceProductQuantity(lineItems) : null,
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
};

const ADMIN_INVOICES_PAGE_SIZE = 300;

export function buildAdminInvoicesQuery(options: AdminInvoiceListQuery) {
  const sort = options.sort ?? 'date';
  const pageSize = Math.max(1, Math.min(Number(options.pageSize ?? 25) || 25, 500));
  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const constraints: QueryConstraint[] = [];

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
  return query(collectionGroup(db, 'invoices'), ...constraints);
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
): Promise<AdminFirestoreInvoice[]> {
  const snap = await getDocs(buildAdminInvoicesQuery({
    sort,
    pageSize,
    cursor,
    category,
    dateStart,
    dateEnd,
  }));
  return snap.docs.map(mapAdminInvoiceDoc);
}

/**
 * Load every invoice in the date window (paginated), for Aggregate / KPI totals.
 * When sort is syncedAt with a date range, results are re-sorted client-side.
 */
export async function fetchAllAdminInvoicesInRange(options: {
  sort?: AdminInvoiceSort;
  category?: InvoiceCategory | 'all';
  dateStart?: string | null;
  dateEnd?: string | null;
}): Promise<{ rows: AdminFirestoreInvoice[]; truncated: boolean }> {
  const sort = options.sort ?? 'date';
  const category = options.category ?? 'all';
  const rows: AdminFirestoreInvoice[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  // Page until Firestore is exhausted — no soft row cap.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pageQuery = buildAdminInvoicesQuery({
      sort,
      pageSize: ADMIN_INVOICES_PAGE_SIZE,
      cursor,
      category,
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
    });
    const pageSnap: QuerySnapshot<DocumentData> = await getDocs(pageQuery);
    if (pageSnap.empty) break;
    rows.push(...pageSnap.docs.map(mapAdminInvoiceDoc));
    cursor = pageSnap.docs[pageSnap.docs.length - 1] ?? null;
    if (pageSnap.size < ADMIN_INVOICES_PAGE_SIZE) break;
  }

  if (sort === 'syncedAt' && (options.dateStart || options.dateEnd)) {
    rows.sort((a, b) => String(b.syncedAt ?? '').localeCompare(String(a.syncedAt ?? '')));
  }

  return { rows, truncated: false };
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
}): Promise<number> {
  const category = options.category ?? 'all';
  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const constraints: QueryConstraint[] = [];

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

  const countQuery = query(collectionGroup(db, 'invoices'), ...constraints);
  const snap = await getCountFromServer(countQuery);
  return snap.data().count;
}

export async function countAdminInvoicesByCategory(options: {
  dateStart?: string | null;
  dateEnd?: string | null;
}): Promise<AdminInvoiceCategoryCounts> {
  const base = {
    dateStart: options.dateStart ?? null,
    dateEnd: options.dateEnd ?? null,
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
}): Promise<AdminFirestoreInvoice[]> {
  const ids = [...new Set(
    options.customerIds.map(id => String(id ?? '').trim()).filter(Boolean),
  )];
  if (!ids.length) return [];

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

  let merged = perCustomer.flat();

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
  return enrichInvoiceDetailImages(mapAdminInvoiceDetail(invoiceId, snap.data()));
}
