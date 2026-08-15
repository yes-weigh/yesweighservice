import {
  collection,
  collectionGroup,
  doc,
  endAt,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  startAt,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../firebase';
import { toSalesOrderDateKey } from './admin-sales-orders';
import {
  listGatcReportsInDateRange,
  summarizeGatcReports,
  type GatcReportDoc,
} from './gatcReports';
import { enrichInvoiceDetailImages } from './invoiceLineItemImages';
import {
  getInvoicePeriodBounds,
  invoiceCategoryAmount,
  invoiceHasCategory,
  invoiceAmountExclGst,
  isGatcFeeOnlyInvoice,
  normalizeInvoiceCategories,
  normalizeInvoiceCategoryAmounts,
  parseInvoiceCategory,
  sumInvoiceProductQuantity,
  firstDateTimeValue,
  freightSkuFromInvoiceLines,
} from './invoices';
import {
  appendSalespersonIdConstraint,
  filterRowsBySalespersonScope,
  normalizeSalespersonIdFilter,
} from './salespersonScope';
import { resolveZohoCustomerDisplayContact } from './zohoCustomerContact';
import { invoiceAllowsLogisticsFulfillment } from './invoiceListStatus';
import { salesOrderDataIsCustomerPickup } from './orderFreight';
import type {
  DealerInvoiceDetail,
  DealerInvoiceLineItem,
  InvoiceCategory,
  InvoiceChartPoint,
  InvoiceCustomerPickup,
  InvoiceManualDelivery,
  InvoiceSalesEntry,
  KpiPeriod,
} from '../types/invoices';
import type { LogisticsBooking } from '../types/logistics-dispatch';

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
  /** Zoho created_time / last_modified when present. */
  createdTime?: string | null;
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
  categories: InvoiceCategory[];
  categoryAmounts: Partial<Record<InvoiceCategory, number>>;
  /** Courier freight SKU when the invoice includes a delivery-partner line. */
  freightSku?: string | null;
  /** Set when Aggregate mode clubs invoices into one row per dealer. */
  aggregateInvoiceCount?: number;
  customerPickup?: InvoiceCustomerPickup | null;
  customerPickupMarkedAt?: string | null;
  manualDelivery?: InvoiceManualDelivery | null;
  manualDeliveredAt?: string | null;
  ewayBill?: {
    required?: boolean;
    requiredBecause?: 'invoice_total' | 'clubbed_lr' | null;
    status?: string | null;
    ewaybillNumber?: string | null;
  } | null;
  /** Denormalized from zohoCustomers for the list location line. */
  district?: string | null;
  billingState?: string | null;
  /** Denormalized from logisticsBookings for status chips / partner tiles. */
  logistics?: {
    bookingId?: string | null;
    status?: string | null;
    wizardStep?: string | null;
    consignmentNo?: string | null;
    trackingNo?: string | null;
    partnerId?: string | null;
  } | null;
}

function pickupMarkedAt(value: unknown): string | null {
  const iso = timestampToIso(value);
  if (!iso) return null;
  const trimmed = iso.trim();
  return trimmed && trimmed !== '[object Object]' ? trimmed : null;
}

function mapInvoiceCustomerPickup(raw: unknown): InvoiceCustomerPickup | null {
  if (raw && typeof raw === 'object') {
    const data = raw as Record<string, unknown>;
    const markedAt = pickupMarkedAt(data.markedAt);
    if (markedAt) {
      return {
        markedAt,
        markedByUid: data.markedByUid ? String(data.markedByUid) : null,
        markedByName: data.markedByName ? String(data.markedByName) : null,
        shipFromSite: data.shipFromSite ? String(data.shipFromSite) : null,
        shipFromLabel: data.shipFromLabel ? String(data.shipFromLabel) : null,
        vehicleNumber: data.vehicleNumber ? String(data.vehicleNumber) : null,
      };
    }
  }
  return null;
}

function mapInvoiceManualDelivery(
  raw: unknown,
  markedAtScalar: unknown,
): InvoiceManualDelivery | null {
  if (raw && typeof raw === 'object') {
    const data = raw as Record<string, unknown>;
    const markedAt = pickupMarkedAt(data.markedAt);
    if (markedAt) {
      return {
        markedAt,
        markedByUid: data.markedByUid ? String(data.markedByUid) : null,
        markedByName: data.markedByName ? String(data.markedByName) : null,
      };
    }
  }
  const markedAt = pickupMarkedAt(markedAtScalar);
  if (!markedAt) return null;
  return { markedAt, markedByUid: null, markedByName: null };
}

function mapInvoiceCustomerPickupField(
  raw: unknown,
  markedAtScalar: unknown,
): InvoiceCustomerPickup | null {
  const nested = mapInvoiceCustomerPickup(raw);
  if (nested) return nested;
  const markedAt = pickupMarkedAt(markedAtScalar);
  if (!markedAt) return null;
  return {
    markedAt,
    markedByUid: null,
    markedByName: null,
    shipFromSite: null,
    shipFromLabel: null,
    vehicleNumber: null,
  };
}

function mapInvoiceListEwayBill(raw: unknown): AdminFirestoreInvoice['ewayBill'] {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const requiredBecause = data.requiredBecause === 'clubbed_lr' || data.requiredBecause === 'invoice_total'
    ? data.requiredBecause
    : null;
  const ewaybillNumber = data.ewaybillNumber ? String(data.ewaybillNumber).trim() : '';
  const status = data.status ? String(data.status).trim() : '';
  if (!ewaybillNumber && !status && data.required !== true && !requiredBecause) return null;
  return {
    required: data.required === true,
    requiredBecause,
    status: status || null,
    ewaybillNumber: ewaybillNumber || null,
  };
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
    createdTime: firstDateTimeValue(
      timestampToIso(data.createdTime),
      timestampToIso(data.zohoCreatedTime),
      timestampToIso(data.zohoLastModified),
    ),
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    subtotal: data.subtotal != null ? Number(data.subtotal) : null,
    taxTotal: data.taxTotal != null ? Number(data.taxTotal) : null,
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    syncedAt: timestampToIso(data.syncedAt),
    itemQuantity,
    invoiceCategory: parseInvoiceCategory(data.invoiceCategory),
    categories: normalizeInvoiceCategories(data.categories),
    categoryAmounts: normalizeInvoiceCategoryAmounts(data.categoryAmounts),
    freightSku: String(data.freightSku ?? '').trim().toUpperCase()
      || freightSkuFromInvoiceLines(
        Array.isArray(data.lineItems) ? data.lineItems : null,
      )
      || null,
    customerPickup: mapInvoiceCustomerPickupField(data.customerPickup, data.customerPickupMarkedAt),
    customerPickupMarkedAt: pickupMarkedAt(data.customerPickupMarkedAt),
    manualDelivery: mapInvoiceManualDelivery(data.manualDelivery, data.manualDeliveredAt),
    manualDeliveredAt: pickupMarkedAt(data.manualDeliveredAt),
    ewayBill: mapInvoiceListEwayBill(data.ewayBill),
    district: data.district ? String(data.district) : null,
    billingState: data.billingState ? String(data.billingState) : null,
    logistics: mapInvoiceListLogistics(data.logistics),
  };
}

function mapInvoiceListLogistics(raw: unknown): AdminFirestoreInvoice['logistics'] {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const status = String(data.status ?? '').trim().toLowerCase();
  if (!status || status === 'cancelled') return null;
  return {
    bookingId: data.bookingId ? String(data.bookingId) : null,
    status,
    wizardStep: data.wizardStep ? String(data.wizardStep) : null,
    consignmentNo: data.consignmentNo ? String(data.consignmentNo) : null,
    trackingNo: data.trackingNo ? String(data.trackingNo) : null,
    partnerId: data.partnerId ? String(data.partnerId) : null,
  };
}

/** Build the slim booking the list status / e-way / partner tiles already consume. */
export function adminInvoiceLogisticsBooking(
  invoice: Pick<AdminFirestoreInvoice, 'id' | 'logistics'>,
): LogisticsBooking | null {
  const logistics = invoice.logistics;
  if (!logistics?.status) return null;
  return {
    id: logistics.bookingId || `summary-${invoice.id}`,
    status: logistics.status,
    wizardStep: logistics.wizardStep ?? null,
    consignmentNo: logistics.consignmentNo ?? '',
    trackingNo: logistics.trackingNo ?? '',
    partnerId: logistics.partnerId ?? 'delhivery',
  } as LogisticsBooking;
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
let cachedSummariesIncludeCustomerPickup = false;

/** Prefer slim invoiceSummaries after backfill sets invoiceStats/config.listSource. */
export async function resolveAdminInvoiceListCollection(): Promise<AdminInvoiceListCollection> {
  if (cachedListCollection) return cachedListCollection;
  try {
    const snap = await getDoc(doc(db, 'invoiceStats', 'config'));
    const source = snap.exists() ? String(snap.data()?.listSource ?? '') : '';
    cachedListCollection = source === 'summaries' ? 'invoiceSummaries' : 'invoices';
    cachedSummariesIncludeCustomerPickup = snap.exists()
      && snap.data()?.summariesIncludeCustomerPickup === true;
  } catch {
    cachedListCollection = 'invoices';
    cachedSummariesIncludeCustomerPickup = false;
  }
  return cachedListCollection;
}

export function clearAdminInvoiceListCollectionCache(): void {
  cachedListCollection = null;
  cachedSummariesIncludeCustomerPickup = false;
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
    constraints.push(where('categories', 'array-contains', category));
  }

  // Date inequalities must share orderBy('date'); client re-sorts by syncedAt if needed.
  if (dateStart || dateEnd) {
    if (dateStart) constraints.push(where('date', '>=', dateStart));
    if (dateEnd) constraints.push(where('date', '<=', dateEnd));
    constraints.push(orderBy('date', 'desc'));
    constraints.push(orderBy('invoiceNumber', 'desc'));
  } else {
    const field = sort === 'syncedAt' ? 'syncedAt' : 'date';
    constraints.push(orderBy(field, 'desc'));
    constraints.push(orderBy('invoiceNumber', 'desc'));
  }

  if (options.cursor) constraints.push(startAfter(options.cursor));
  constraints.push(limit(pageSize));
  return query(collectionGroup(db, listCollection), ...constraints);
}

function isFirestoreIndexError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /requires an index|COLLECTION_GROUP|COLLECTION_DESC|COLLECTION_ASC/i.test(msg);
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
  return overlayFreightSkuFromInvoiceDocs(snap.docs.map(mapAdminInvoiceDoc));
}

/**
 * Hydrate invoice list rows for portal-stamped invoices (GATC Billwise membership).
 * Marks rows with `categories` including `gatc` and `categoryAmounts.gatc` = fee total
 * so existing Stamping tab amount helpers keep working.
 */
export async function fetchAdminPortalStampingInvoices(options: {
  dateStart?: string | null;
  dateEnd?: string | null;
  salespersonIds?: string[] | null;
  customerIds?: string[] | null;
  sort?: AdminInvoiceSort;
}): Promise<{
  rows: AdminFirestoreInvoice[];
  reports: GatcReportDoc[];
  gatcFeeTotal: number;
}> {
  if (
    options.salespersonIds != null
    && appendSalespersonIdConstraint([], options.salespersonIds) === 'empty'
  ) {
    return { rows: [], reports: [], gatcFeeTotal: 0 };
  }

  const sort = options.sort ?? 'date';
  const customerFilter = options.customerIds?.length
    ? new Set(options.customerIds.map(id => String(id ?? '').trim()).filter(Boolean))
    : null;

  let reports = await listGatcReportsInDateRange({
    dateStart: options.dateStart,
    dateEnd: options.dateEnd,
  });

  if (customerFilter) {
    reports = reports.filter(report => {
      const customerId = String(report.customerId ?? '').trim();
      return Boolean(customerId && customerFilter.has(customerId));
    });
  }

  const scopedIds = normalizeSalespersonIdFilter(options.salespersonIds);
  if (scopedIds) {
    const allowed = new Set(scopedIds);
    reports = reports.filter(report => {
      const id = String(report.salespersonId ?? '').trim();
      return Boolean(id && allowed.has(id));
    });
  }

  const summary = summarizeGatcReports(reports);
  const reportByInvoiceId = new Map<string, GatcReportDoc>();
  for (const report of reports) {
    const invoiceId = report.invoiceId || report.id;
    if (invoiceId && !reportByInvoiceId.has(invoiceId)) {
      reportByInvoiceId.set(invoiceId, report);
    }
  }

  const hydrated = await Promise.all(
    [...reportByInvoiceId.entries()].map(async ([invoiceId, report]): Promise<AdminFirestoreInvoice | null> => {
      const customerId = String(report.customerId ?? '').trim();
      if (!customerId) return null;
      try {
        const snap = await getDoc(doc(db, 'zohoCustomers', customerId, 'invoices', invoiceId));
        if (!snap.exists()) {
          // Fallback slim shape from the report when the invoice doc is missing.
          return {
            id: invoiceId,
            customerId,
            invoiceNumber: report.invoiceNumber || invoiceId,
            customerName: report.customerName,
            salespersonId: report.salespersonId,
            salespersonName: report.salespersonName,
            date: report.invoiceDate,
            status: 'paid',
            total: report.totals.gatcFeeTotal,
            subtotal: report.totals.gatcFeeTotal,
            taxTotal: 0,
            balance: 0,
            referenceNumber: report.referenceNumber,
            syncedAt: report.createdAt || null,
            itemQuantity: report.totals.stampedQty,
            invoiceCategory: 'gatc',
            categories: ['gatc'],
            categoryAmounts: { gatc: report.totals.gatcFeeTotal },
          };
        }
        const row = mapAdminInvoiceDoc(snap as QueryDocumentSnapshot<DocumentData>);
        return applyPortalGatcFee(row, report.totals.gatcFeeTotal, report.totals.stampedQty);
      } catch {
        return null;
      }
    }),
  );

  const rows = hydrated.flatMap(row => (row ? [row] : []));
  rows.sort((a, b) => compareInvoiceSortKey(a, b, sort));

  return {
    rows,
    reports: [...reportByInvoiceId.values()],
    gatcFeeTotal: summary.gatcFeeTotal,
  };
}

function applyPortalGatcFee(
  row: AdminFirestoreInvoice,
  gatcFeeTotal: number,
  stampedQty?: number,
): AdminFirestoreInvoice {
  const categories = row.categories.includes('gatc')
    ? row.categories
    : ([...row.categories, 'gatc'] as InvoiceCategory[]);
  return {
    ...row,
    invoiceCategory: row.invoiceCategory ?? 'gatc',
    categories,
    categoryAmounts: {
      ...row.categoryAmounts,
      gatc: gatcFeeTotal,
    },
    itemQuantity: row.itemQuantity ?? stampedQty ?? null,
  };
}

/**
 * Align invoice-list membership and amounts with GATC Billwise:
 * overlay `gatcFeeTotal` onto matching invoices, omit standalone GATC-fee
 * Zoho invoices that have no Billwise report, and append Billwise invoices
 * missing from the dump.
 */
export function overlayPortalStampingOnInvoices(
  rows: AdminFirestoreInvoice[],
  portalRows: AdminFirestoreInvoice[],
  sort: AdminInvoiceSort = 'date',
): AdminFirestoreInvoice[] {
  const portalById = new Map<string, AdminFirestoreInvoice>();
  for (const row of portalRows) {
    if (row.id) portalById.set(row.id, row);
  }

  const seen = new Set<string>();
  const next: AdminFirestoreInvoice[] = [];
  for (const row of rows) {
    seen.add(row.id);
    const portal = portalById.get(row.id);
    if (portal) {
      const fee = Number(portal.categoryAmounts?.gatc ?? 0);
      next.push(applyPortalGatcFee(row, fee, portal.itemQuantity ?? undefined));
      continue;
    }
    const hasHsnGatc = row.categories.includes('gatc') || row.invoiceCategory === 'gatc';
    if (!hasHsnGatc) {
      next.push(row);
      continue;
    }
    const categories = row.categories.filter(category => category !== 'gatc');
    const amounts = { ...row.categoryAmounts };
    delete amounts.gatc;
    // Fee-only Zoho invoices with no Billwise report are not commerce invoices.
    if (!categories.length) continue;
    next.push({
      ...row,
      categories,
      invoiceCategory: row.invoiceCategory === 'gatc'
        ? (categories[0] ?? null)
        : row.invoiceCategory,
      categoryAmounts: amounts,
    });
  }

  let appended = false;
  for (const portal of portalRows) {
    if (!portal.id || seen.has(portal.id)) continue;
    next.push(portal);
    seen.add(portal.id);
    appended = true;
  }
  if (appended) next.sort((a, b) => compareInvoiceSortKey(a, b, sort));
  return next;
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

  // Stamping tab = portal GATC Billwise membership (not Zoho GATC-HSN category).
  if (options.category === 'gatc') {
    const { rows: allRows } = await fetchAdminPortalStampingInvoices({
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
      salespersonIds: options.salespersonIds,
      sort: options.sort,
    });
    const pageSize = options.pageSize ?? ADMIN_LIST_PAGE_SIZE;
    // Offset paging via synthetic cursor index encoded in page flows that pass null cursor
    // for page 1; AdminInvoicesPage uses client paging for gatc (loads full set).
    return {
      rows: allRows.slice(0, pageSize),
      lastDoc: null,
      hasMore: allRows.length > pageSize,
    };
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
  const rows = snap.docs.map(mapAdminInvoiceDoc);
  return {
    rows: await overlayFreightSkuFromInvoiceDocs(rows),
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
  if (category === 'gatc') {
    const { rows } = await fetchAdminPortalStampingInvoices({
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
      salespersonIds: options.salespersonIds,
      sort,
    });
    return { rows, truncated: false };
  }

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

  rows.sort((a, b) => compareInvoiceSortKey(a, b, sort));

  const sliced = truncated ? rows.slice(0, maxRows) : rows;
  if (listCollection === 'invoiceSummaries') {
    return { rows: await overlayFreightSkuFromInvoiceDocs(sliced), truncated };
  }
  const withPickup = !cachedSummariesIncludeCustomerPickup
    ? await overlayCustomerPickupFromInvoiceDocs(sliced)
    : sliced;
  const withEway = await overlayEwayBillFromInvoiceDocs(withPickup);
  const withFreight = await overlayFreightSkuFromInvoiceDocs(withEway);

  return { rows: withFreight, truncated };
}

async function overlayCustomerPickupFromInvoiceDocs(
  rows: AdminFirestoreInvoice[],
): Promise<AdminFirestoreInvoice[]> {
  if (!rows.length) return rows;
  const pickupById = new Map<string, InvoiceCustomerPickup>();
  const deliveredById = new Map<string, InvoiceManualDelivery>();
  const customerIds = [...new Set(rows.map(row => row.customerId).filter(Boolean))];

  const takeFulfillment = (data: DocumentData, invoiceId: string) => {
    const pickup = mapInvoiceCustomerPickupField(data.customerPickup, data.customerPickupMarkedAt);
    if (pickup) pickupById.set(invoiceId, pickup);
    const delivered = mapInvoiceManualDelivery(data.manualDelivery, data.manualDeliveredAt);
    if (delivered) deliveredById.set(invoiceId, delivered);
  };

  const loadForCustomer = async (customerId: string) => {
    try {
      const [pickupSnap, deliveredSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'zohoCustomers', customerId, 'invoices'),
          where('customerPickup.markedAt', '>=', '2'),
        )),
        getDocs(query(
          collection(db, 'zohoCustomers', customerId, 'invoices'),
          where('manualDeliveredAt', '>=', '2'),
        )),
      ]);
      for (const docSnap of [...pickupSnap.docs, ...deliveredSnap.docs]) {
        takeFulfillment(docSnap.data(), docSnap.id);
      }
    } catch {
      const customerRows = rows.filter(row => row.customerId === customerId);
      const snaps = await Promise.all(
        customerRows.map(row => getDoc(doc(db, 'zohoCustomers', row.customerId, 'invoices', row.id))),
      );
      snaps.forEach((snap, index) => {
        if (!snap.exists()) return;
        takeFulfillment(snap.data() ?? {}, customerRows[index].id);
      });
    }
  };

  for (let i = 0; i < customerIds.length; i += 8) {
    await Promise.all(customerIds.slice(i, i + 8).map(loadForCustomer));
  }

  if (!pickupById.size && !deliveredById.size) return rows;

  requestInvoiceSummaryCustomerPickupBackfill();

  return rows.map(row => {
    const pickup = pickupById.get(row.id);
    const delivered = deliveredById.get(row.id);
    if (!pickup && !delivered) return row;
    return {
      ...row,
      customerPickup: row.customerPickup?.markedAt ? row.customerPickup : (pickup ?? row.customerPickup),
      customerPickupMarkedAt: row.customerPickupMarkedAt || pickup?.markedAt || null,
      manualDelivery: row.manualDelivery?.markedAt ? row.manualDelivery : (delivered ?? row.manualDelivery),
      manualDeliveredAt: row.manualDeliveredAt || delivered?.markedAt || null,
    };
  });
}

function invoiceListRowNeedsEwayOverlay(row: AdminFirestoreInvoice): boolean {
  if (row.ewayBill?.ewaybillNumber || String(row.ewayBill?.status || '').toLowerCase().includes('generated')) {
    return false;
  }
  if (row.customerPickup?.markedAt || row.customerPickupMarkedAt) return true;
  return Boolean(
    row.ewayBill?.required
    || row.ewayBill?.requiredBecause
    || row.ewayBill?.status === 'missing',
  );
}

/** Summaries omit freightSku until dual-write; pull it from the hot invoice for partner tiles. */
const FREIGHT_SKU_OVERLAY_MAX = 300;

async function overlayFreightSkuFromInvoiceDocs(
  rows: AdminFirestoreInvoice[],
): Promise<AdminFirestoreInvoice[]> {
  const targets = rows.filter(row => (
    invoiceAllowsLogisticsFulfillment(row)
    && !String(row.freightSku ?? '').trim()
    && Boolean(row.customerId)
  )).slice(0, FREIGHT_SKU_OVERLAY_MAX);
  if (!targets.length) return rows;

  const skuById = new Map<string, string>();
  for (let i = 0; i < targets.length; i += 8) {
    const batch = targets.slice(i, i + 8);
    const snaps = await Promise.all(
      batch.map(row => getDoc(doc(db, 'zohoCustomers', row.customerId, 'invoices', row.id))),
    );
    snaps.forEach((snap, index) => {
      if (!snap.exists()) return;
      const data = snap.data() ?? {};
      const sku = String(data.freightSku ?? '').trim().toUpperCase()
        || freightSkuFromInvoiceLines(
          Array.isArray(data.lineItems) ? data.lineItems : null,
        );
      if (sku) skuById.set(batch[index].id, sku);
    });
  }

  if (!skuById.size) return rows;
  return rows.map(row => {
    const freightSku = skuById.get(row.id);
    if (!freightSku) return row;
    return { ...row, freightSku };
  });
}

/** Summaries omit ewayBill until dual-write; pull it from the hot invoice for list chips. */
async function overlayEwayBillFromInvoiceDocs(
  rows: AdminFirestoreInvoice[],
): Promise<AdminFirestoreInvoice[]> {
  const targets = rows.filter(invoiceListRowNeedsEwayOverlay);
  if (!targets.length) return rows;

  const ewayById = new Map<string, AdminFirestoreInvoice['ewayBill']>();
  for (let i = 0; i < targets.length; i += 8) {
    const batch = targets.slice(i, i + 8);
    const snaps = await Promise.all(
      batch.map(row => getDoc(doc(db, 'zohoCustomers', row.customerId, 'invoices', row.id))),
    );
    snaps.forEach((snap, index) => {
      if (!snap.exists()) return;
      const mapped = mapInvoiceListEwayBill(snap.data()?.ewayBill);
      if (mapped) ewayById.set(batch[index].id, mapped);
    });
  }

  if (!ewayById.size) return rows;
  return rows.map(row => {
    const ewayBill = ewayById.get(row.id);
    if (!ewayBill) return row;
    return { ...row, ewayBill };
  });
}

let listFieldsBackfillRequested = false;

export function requestInvoiceSummaryListFieldsBackfill() {
  if (listFieldsBackfillRequested) return;
  listFieldsBackfillRequested = true;
  try {
    if (sessionStorage.getItem('yesone.invoiceSummaryListFieldsBackfill') === '1') return;
    sessionStorage.setItem('yesone.invoiceSummaryListFieldsBackfill', '1');
  } catch {
    // continue
  }
  void runInvoiceSummaryListFieldsBackfill().catch(() => {
    // Callable not deployed yet — list still falls back to booking / customer reads.
  });
}

let pickupSummaryBackfillRequested = false;

function requestInvoiceSummaryCustomerPickupBackfill() {
  if (pickupSummaryBackfillRequested) return;
  pickupSummaryBackfillRequested = true;
  try {
    if (sessionStorage.getItem('yesone.invoicePickupSummaryBackfill') === '1') return;
    sessionStorage.setItem('yesone.invoicePickupSummaryBackfill', '1');
  } catch {
    // continue
  }
  void runInvoiceCustomerPickupSummaryBackfill().catch(() => {
    // Callable not deployed yet — list overlay already applied pickup.
  });
}

export function filterAdminInvoices(
  rows: AdminFirestoreInvoice[],
  searchText: string,
  category: InvoiceCategory | 'all' = 'all',
): AdminFirestoreInvoice[] {
  let next = rows;
  if (category && category !== 'all') {
    next = next.filter(row => invoiceHasCategory(row, category));
  } else {
    next = next.filter(row => !isGatcFeeOnlyInvoice(row));
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

const ADMIN_INVOICE_SEARCH_LIMIT = 12;

/** YES/YY-YY/ prefixes for current and recent financial years (Apr–Mar). */
function yesweighInvoiceFyPrefixes(now = new Date()): string[] {
  const month = now.getMonth();
  const year = now.getFullYear();
  const fyStartYear = month >= 3 ? year : year - 1;
  const label = (startYear: number) => {
    const a = String(startYear).slice(-2);
    const b = String(startYear + 1).slice(-2);
    return `YES/${a}-${b}/`;
  };
  return [label(fyStartYear), label(fyStartYear - 1), label(fyStartYear - 2)];
}

function uniquePrefixes(values: string[], max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const prefix = value.trim();
    if (!prefix || seen.has(prefix)) continue;
    seen.add(prefix);
    out.push(prefix);
    if (out.length >= max) break;
  }
  return out;
}

/** Invoice-number prefixes for Firestore startAt/endAt (no full collection scan). */
export function adminInvoiceNumberSearchPrefixes(raw: string): string[] {
  const q = raw.trim();
  if (!q) return [];
  const prefixes: string[] = [q, q.toUpperCase()];
  const compact = q.replace(/\s+/g, '');
  const digits = compact.replace(/\D/g, '');
  const looksLikeSeq = Boolean(digits) && (
    /^\d{1,6}$/.test(compact)
    || /^\/?\d{1,6}$/.test(compact)
    || digits.length >= 2 && digits.length === compact.replace(/^YES\/?/i, '').replace(/\D/g, '').length
  );
  if (looksLikeSeq && digits) {
    for (const fy of yesweighInvoiceFyPrefixes()) {
      prefixes.push(`${fy}${digits}`);
    }
  }
  if (/^yes\b/i.test(q) || q.includes('/')) {
    let normalized = q.toUpperCase().replace(/\s+/g, '');
    if (!normalized.startsWith('YES')) {
      normalized = `YES/${normalized.replace(/^\/+/, '')}`;
    }
    prefixes.push(normalized);
  }
  return uniquePrefixes(prefixes);
}

function adminCustomerNameSearchPrefixes(raw: string): string[] {
  const q = raw.trim();
  if (!q || q.length < 2) return [];
  const title = q.replace(/\w\S*/g, word => (
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ));
  return uniquePrefixes([q, q.toUpperCase(), q.toLowerCase(), title], 4);
}

async function prefixQueryAdminInvoices(
  listCollection: AdminInvoiceListCollection,
  field: 'invoiceNumber' | 'customerName',
  prefix: string,
  rowLimit: number,
): Promise<AdminFirestoreInvoice[]> {
  const snap = await getDocs(
    query(
      collectionGroup(db, listCollection),
      orderBy(field),
      startAt(prefix),
      endAt(`${prefix}\uf8ff`),
      limit(rowLimit),
    ),
  );
  return overlayFreightSkuFromInvoiceDocs(snap.docs.map(mapAdminInvoiceDoc));
}

/**
 * Org-wide invoice autocomplete via limited prefix queries (invoice # / customer).
 * Does not load the full invoice corpus.
 */
export async function searchAdminInvoicesAutocomplete(
  searchText: string,
  options?: {
    limitCount?: number;
    salespersonIds?: string[] | null;
  },
): Promise<AdminFirestoreInvoice[]> {
  const raw = searchText.trim();
  if (!raw) return [];

  const limitCount = Math.min(
    Math.max(options?.limitCount ?? ADMIN_INVOICE_SEARCH_LIMIT, 1),
    25,
  );
  const listCollection = await resolveAdminInvoiceListCollection();
  const numberPrefixes = adminInvoiceNumberSearchPrefixes(raw);
  const namePrefixes = adminCustomerNameSearchPrefixes(raw);

  const tasks: Array<Promise<AdminFirestoreInvoice[]>> = [
    ...numberPrefixes.map(prefix => (
      prefixQueryAdminInvoices(listCollection, 'invoiceNumber', prefix, limitCount)
    )),
    ...namePrefixes.map(prefix => (
      prefixQueryAdminInvoices(listCollection, 'customerName', prefix, limitCount)
    )),
  ];

  const settled = await Promise.allSettled(tasks);
  const byKey = new Map<string, AdminFirestoreInvoice>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const row of result.value) {
      if (!row.customerId || !row.id) continue;
      byKey.set(`${row.customerId}:${row.id}`, row);
    }
  }

  let rows = [...byKey.values()];
  rows = filterRowsBySalespersonScope(rows, options?.salespersonIds);

  const needle = raw.toLowerCase();
  const needleDigits = raw.replace(/\D/g, '');
  rows.sort((a, b) => {
    const aNum = (a.invoiceNumber || '').toLowerCase();
    const bNum = (b.invoiceNumber || '').toLowerCase();
    const aName = (a.customerName || '').toLowerCase();
    const bName = (b.customerName || '').toLowerCase();
    const score = (num: string, name: string) => {
      if (num === needle || num === raw.toUpperCase()) return 0;
      if (needleDigits && num.endsWith(needleDigits)) return 1;
      if (num.startsWith(needle) || num.includes(needle)) return 2;
      if (name.startsWith(needle)) return 3;
      if (name.includes(needle)) return 4;
      return 5;
    };
    const diff = score(aNum, aName) - score(bNum, bName);
    if (diff !== 0) return diff;
    const aDate = a.date ? Date.parse(a.date) : 0;
    const bDate = b.date ? Date.parse(b.date) : 0;
    return bDate - aDate;
  });

  return rows.slice(0, limitCount);
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

/** Trailing numeric segment of YES/26-27/1763 style invoice numbers. */
export function invoiceNumberSortKey(value: string | null | undefined): number {
  const text = String(value ?? '').trim();
  const match = /\/(\d+)\s*$/.exec(text) || /^(\d+)\s*$/.exec(text);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : 0;
}

function compareInvoiceNumberDesc(
  a: Pick<AdminFirestoreInvoice, 'invoiceNumber' | 'id'>,
  b: Pick<AdminFirestoreInvoice, 'invoiceNumber' | 'id'>,
): number {
  const aKey = invoiceNumberSortKey(a.invoiceNumber || a.id);
  const bKey = invoiceNumberSortKey(b.invoiceNumber || b.id);
  if (aKey !== bKey) return bKey - aKey;
  return String(b.invoiceNumber ?? b.id ?? '').localeCompare(
    String(a.invoiceNumber ?? a.id ?? ''),
  );
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
    const diff = bTs - aTs;
    if (diff !== 0) return diff;
    return compareInvoiceNumberDesc(a, b);
  }
  const aTs = a.date ? parseInvoiceDay(a.date) : NaN;
  const bTs = b.date ? parseInvoiceDay(b.date) : NaN;
  const aSafe = Number.isNaN(aTs) ? 0 : aTs;
  const bSafe = Number.isNaN(bTs) ? 0 : bTs;
  const diff = bSafe - aSafe;
  if (diff !== 0) return diff;
  return compareInvoiceNumberDesc(a, b);
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
      for (const category of inv.categories ?? []) categories.add(category);
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
      categories: [...categories],
      categoryAmounts: {},
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
  if (category === 'gatc') {
    const { rows } = await fetchAdminPortalStampingInvoices({
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
      salespersonIds: options.salespersonIds,
    });
    return rows.length;
  }

  const dateStart = options.dateStart?.trim() || null;
  const dateEnd = options.dateEnd?.trim() || null;
  const listCollection = await resolveAdminInvoiceListCollection();

  const buildConstraints = (categoryFilter: QueryConstraint | null): QueryConstraint[] => {
    const next: QueryConstraint[] = [];
    if (appendSalespersonIdConstraint(next, options.salespersonIds) === 'empty') {
      return next;
    }
    if (categoryFilter) next.push(categoryFilter);
    if (dateStart || dateEnd) {
      if (dateStart) next.push(where('date', '>=', dateStart));
      if (dateEnd) next.push(where('date', '<=', dateEnd));
      next.push(orderBy('date', 'desc'));
    } else {
      next.push(orderBy('date', 'desc'));
    }
    return next;
  };

  const countForConstraints = async (queryConstraints: QueryConstraint[]) => {
    if (
      options.salespersonIds != null
      && appendSalespersonIdConstraint([], options.salespersonIds) === 'empty'
    ) {
      return 0;
    }
    const countQuery = query(collectionGroup(db, listCollection), ...queryConstraints);
    try {
      const snap = await getCountFromServer(countQuery);
      return snap.data().count;
    } catch (err) {
      if (listCollection === 'invoiceSummaries' && isFirestoreIndexError(err)) {
        const fallback = query(collectionGroup(db, 'invoices'), ...queryConstraints);
        const snap = await getCountFromServer(fallback);
        return snap.data().count;
      }
      throw err;
    }
  };

  try {
    const primaryFilter = category !== 'all'
      ? where('categories', 'array-contains', category)
      : null;
    const primary = await countForConstraints(buildConstraints(primaryFilter));
    if (category === 'all' || primary > 0) return primary;
    // Legacy invoices may only have invoiceCategory (no categories array).
    return countForConstraints(buildConstraints(where('invoiceCategory', '==', category)));
  } catch (err) {
    if (listCollection === 'invoiceSummaries' && isFirestoreIndexError(err)) {
      const fallbackFilter = category !== 'all'
        ? where('categories', 'array-contains', category)
        : null;
      const snap = await getCountFromServer(
        query(collectionGroup(db, 'invoices'), ...buildConstraints(fallbackFilter)),
      );
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

/** One-time seed of invoiceStats / invoiceMonthStats / invoiceSummaries / invoiceDealerStats. */
export async function runInvoiceStatsBackfill(): Promise<{
  invoiceCount: number;
  summaryCount: number;
  monthDocs: number;
  dealerDocs?: number;
}> {
  const functions = getFunctions(app, 'asia-south1');
  const callable = httpsCallable<
    Record<string, never>,
    { invoiceCount: number; summaryCount: number; monthDocs: number; dealerDocs?: number }
  >(functions, 'backfillInvoiceStatsAndSummariesFn', { timeout: 540_000 });
  const result = await callable({});
  clearAdminInvoiceListCollectionCache();
  return result.data;
}

/** Copy dealer location + logistics onto invoiceSummaries (list source). */
export async function runInvoiceSummaryListFieldsBackfill(): Promise<{
  locationPatched: number;
  logisticsPatched: number;
}> {
  const functions = getFunctions(app, 'asia-south1');
  const callable = httpsCallable<
    Record<string, never>,
    { locationPatched: number; logisticsPatched: number }
  >(
    functions,
    'backfillInvoiceSummaryListFieldsFn',
    { timeout: 540_000 },
  );
  const result = await callable({});
  clearAdminInvoiceListCollectionCache();
  return result.data;
}

/** Copy customerPickup from invoice docs onto invoiceSummaries (list source). */
export async function runInvoiceCustomerPickupSummaryBackfill(): Promise<{
  scanned: number;
  patched: number;
}> {
  const functions = getFunctions(app, 'asia-south1');
  const callable = httpsCallable<Record<string, never>, { scanned: number; patched: number }>(
    functions,
    'backfillInvoiceSummaryCustomerPickupsFn',
    { timeout: 300_000 },
  );
  const result = await callable({});
  clearAdminInvoiceListCollectionCache();
  return result.data;
}

/** Map precomputed dealer lifetime rollups into Aggregate list rows. */
export function mapAdminDealerStatsDoc(
  docSnap: QueryDocumentSnapshot<DocumentData>,
): AdminFirestoreInvoice {
  const data = docSnap.data();
  const customerId = String(data.customerId ?? docSnap.id);
  const count = Number(data.count ?? 0);
  const byCategory = (data.byCategory ?? {}) as Record<string, number>;
  const amountByCategory = normalizeInvoiceCategoryAmounts(data.amountByCategory);
  const categories = (['product', 'spare', 'software_key', 'service', 'gatc'] as const)
    .filter(key => Number(byCategory[key] ?? 0) > 0);
  const amount = Number(data.amount ?? 0);
  return {
    id: count === 1 ? customerId : `agg-${customerId}`,
    customerId,
    invoiceNumber: count === 1 ? (String(data.latestInvoiceNumber ?? '') || `${count} invoices`) : `${count} invoices`,
    customerName: data.customerName ? String(data.customerName) : null,
    date: data.latestDate ? String(data.latestDate) : null,
    status: count === 1 ? String(data.latestStatus ?? 'aggregated') : 'aggregated',
    total: Number(data.total ?? amount),
    subtotal: Number.isFinite(amount) ? amount : null,
    taxTotal: null,
    balance: Number(data.balance ?? 0),
    referenceNumber: null,
    syncedAt: timestampToIso(data.latestSyncedAt),
    itemQuantity: data.itemQuantity != null ? Number(data.itemQuantity) : null,
    invoiceCategory: categories.length === 1 ? categories[0]! : null,
    categories,
    categoryAmounts: amountByCategory,
    aggregateInvoiceCount: count,
  };
}

/**
 * Lifetime Aggregate: one slim read per dealer from invoiceDealerStats (no invoice scan).
 * Org-wide only — not salesperson-partitioned.
 */
export async function fetchAdminDealerLifetimeAggregates(): Promise<AdminFirestoreInvoice[]> {
  const snap = await getDocs(
    query(collection(db, 'invoiceDealerStats'), orderBy('amount', 'desc')),
  );
  return snap.docs
    .map(mapAdminDealerStatsDoc)
    .filter(row => (row.aggregateInvoiceCount ?? 0) > 0);
}

export type AdminInvoiceStatsKpi = {
  invoiceCount: number;
  categoryAmount: number;
  documentAmount: number;
  /** Legacy alias for existing callers; matches documentAmount. */
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

/**
 * Rollup docs sometimes have total count but missing/zero byCategory — repair via live counts.
 * Exclude gatc: it is overlaid from portal gatcReports and must not mask empty product/spare/etc.
 */
function rollupCategoryCountsNeedRepair(counts: AdminInvoiceCategoryCounts): boolean {
  if (counts.all <= 0) return false;
  const segmented = counts.product + counts.spare + counts.software_key + counts.service;
  return segmented === 0;
}

async function repairRollupCategoryCounts(
  rollup: AdminInvoiceStatsKpi,
  options: {
    dateStart?: string | null;
    dateEnd?: string | null;
    salespersonIds?: string[] | null;
    category: InvoiceCategory | 'all';
    /** Portal Billwise stamping count — kept after live repair. */
    portalGatcCount?: number;
  },
): Promise<AdminInvoiceStatsKpi> {
  if (!rollupCategoryCountsNeedRepair(rollup.categoryCounts)) {
    if (typeof options.portalGatcCount === 'number') {
      return {
        ...rollup,
        categoryCounts: {
          ...rollup.categoryCounts,
          gatc: options.portalGatcCount,
        },
      };
    }
    return rollup;
  }
  const categoryCounts = await countAdminInvoicesByCategory({
    dateStart: options.dateStart,
    dateEnd: options.dateEnd,
    salespersonIds: options.salespersonIds,
  });
  if (typeof options.portalGatcCount === 'number') {
    categoryCounts.gatc = options.portalGatcCount;
  }
  return {
    ...rollup,
    categoryCounts,
    invoiceCount: options.category === 'all'
      ? categoryCounts.all
      : categoryCounts[options.category],
    source: 'query',
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
async function loadPortalStampingKpiOverride(options: {
  dateStart?: string | null;
  dateEnd?: string | null;
  salespersonIds?: string[] | null;
}): Promise<{ count: number; feeTotal: number }> {
  const { rows, gatcFeeTotal } = await fetchAdminPortalStampingInvoices({
    dateStart: options.dateStart,
    dateEnd: options.dateEnd,
    salespersonIds: options.salespersonIds,
  });
  return { count: rows.length, feeTotal: gatcFeeTotal };
}

/** Line-level category amounts are often missing; document totals still exist on the rollup. */
function pickCategoryKpiAmount(categoryAmount: number, documentAmount: number): number {
  const line = Number(categoryAmount) || 0;
  if (line > 0) return line;
  return Number(documentAmount) || 0;
}

async function sumLiveInvoiceKpiAmounts(options: {
  category: InvoiceCategory | 'all';
  dateStart?: string | null;
  dateEnd?: string | null;
  salespersonIds?: string[] | null;
}): Promise<{ categoryAmount: number; documentAmount: number }> {
  const { rows } = await fetchAllAdminInvoicesInRange({
    category: options.category,
    dateStart: options.dateStart,
    dateEnd: options.dateEnd,
    salespersonIds: options.salespersonIds,
  });
  let categoryAmount = 0;
  let documentAmount = 0;
  for (const row of rows) {
    const docAmt = invoiceAmountExclGst(row);
    documentAmount += docAmt;
    if (options.category === 'all') {
      categoryAmount += docAmt;
    } else {
      categoryAmount += invoiceCategoryAmount(row, options.category);
    }
  }
  return { categoryAmount, documentAmount };
}

async function finalizeAdminInvoiceKpi(
  rollup: AdminInvoiceStatsKpi,
  options: {
    dateStart?: string | null;
    dateEnd?: string | null;
    salespersonIds?: string[] | null;
    category: InvoiceCategory | 'all';
    portalGatcCount?: number;
  },
): Promise<AdminInvoiceStatsKpi> {
  const repaired = await repairRollupCategoryCounts(rollup, options);
  let categoryAmount = pickCategoryKpiAmount(repaired.categoryAmount, repaired.documentAmount);
  let documentAmount = Number(repaired.documentAmount) || 0;
  if (documentAmount <= 0 && categoryAmount > 0) documentAmount = categoryAmount;

  if (categoryAmount <= 0 && repaired.invoiceCount > 0 && options.category !== 'gatc') {
    const live = await sumLiveInvoiceKpiAmounts({
      category: options.category,
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
      salespersonIds: options.salespersonIds,
    });
    categoryAmount = pickCategoryKpiAmount(live.categoryAmount, live.documentAmount);
    documentAmount = Number(live.documentAmount) || categoryAmount;
    return {
      ...repaired,
      categoryAmount,
      documentAmount,
      totalAmount: documentAmount,
      source: 'query',
    };
  }

  return {
    ...repaired,
    categoryAmount,
    documentAmount,
    totalAmount: documentAmount,
  };
}

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

  // Stamping KPIs come from portal gatcReports (Billwise). Skip that join
  // unless the Stamping tab is active — it hydrates every report invoice.
  const portalStamping = category === 'gatc'
    ? await loadPortalStampingKpiOverride({
      dateStart,
      dateEnd,
      salespersonIds: options.salespersonIds,
    })
    : { count: 0, feeTotal: 0 };

  if (category === 'gatc') {
    return {
      invoiceCount: portalStamping.count,
      categoryAmount: portalStamping.feeTotal,
      documentAmount: portalStamping.feeTotal,
      totalAmount: portalStamping.feeTotal,
      categoryCounts: {
        ...emptyCategoryCounts(),
        gatc: portalStamping.count,
        all: portalStamping.count,
      },
      source: 'query',
    };
  }

  if (!scoped) {
    try {
      if (!dateStart && !dateEnd) {
        const org = await getDoc(doc(db, 'invoiceStats', 'org'));
        if (org.exists()) {
          const data = org.data() ?? {};
          const byCategory = (data.byCategory ?? {}) as Record<string, number>;
          const amountByCategory = (data.amountByCategory ?? {}) as Record<string, number>;
          const documentAmountByCategory = (data.documentAmountByCategory ?? {}) as Record<string, number>;
          const categoryCounts: AdminInvoiceCategoryCounts = {
            all: Number(data.count ?? 0),
            product: Number(byCategory.product ?? 0),
            spare: Number(byCategory.spare ?? 0),
            software_key: Number(byCategory.software_key ?? 0),
            service: Number(byCategory.service ?? 0),
            gatc: portalStamping.count,
          };
          const categoryAmount = category === 'all'
            ? Number(data.amount ?? 0)
            : Number(amountByCategory[category] ?? 0);
          const documentAmount = category === 'all'
            ? Number(data.amount ?? 0)
            : Number(documentAmountByCategory[category] ?? 0);
          const invoiceCount = category === 'all'
            ? categoryCounts.all
            : categoryCounts[category];
          return finalizeAdminInvoiceKpi({
            invoiceCount,
            categoryAmount,
            documentAmount,
            totalAmount: documentAmount,
            categoryCounts,
            source: 'rollup',
          }, {
            dateStart,
            dateEnd,
            salespersonIds: options.salespersonIds,
            category,
            portalGatcCount: portalStamping.count,
          });
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
          const documentAmountByCategory: Record<string, number> = {
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
            const documentAmounts = (data.documentAmountByCategory ?? {}) as Record<string, number>;
            for (const key of ['product', 'spare', 'software_key', 'service', 'gatc'] as const) {
              categoryCounts[key] += Number(byCategory[key] ?? 0);
              amountByCategory[key] += Number(amounts[key] ?? 0);
              documentAmountByCategory[key] += Number(documentAmounts[key] ?? 0);
            }
          }
          if (any) {
            categoryCounts.gatc = portalStamping.count;
            amountByCategory.gatc = portalStamping.feeTotal;
            documentAmountByCategory.gatc = portalStamping.feeTotal;
            const categoryAmount = category === 'all' ? totalAmountAll : amountByCategory[category];
            const documentAmount = category === 'all'
              ? totalAmountAll
              : documentAmountByCategory[category];
            return finalizeAdminInvoiceKpi({
              invoiceCount: category === 'all' ? categoryCounts.all : categoryCounts[category],
              categoryAmount,
              documentAmount,
              totalAmount: documentAmount,
              categoryCounts,
              source: 'rollup',
            }, {
              dateStart,
              dateEnd,
              salespersonIds: options.salespersonIds,
              category,
              portalGatcCount: portalStamping.count,
            });
          }
        }
      }
    } catch {
      // fall through to live queries
    }
  }

  // Counts from live queries; amounts from a bounded invoice scan when rollups are missing.
  const categoryCounts = await countAdminInvoicesByCategory({
    dateStart,
    dateEnd,
    salespersonIds: options.salespersonIds,
  });
  categoryCounts.gatc = portalStamping.count;

  return finalizeAdminInvoiceKpi({
    invoiceCount: category === 'all' ? categoryCounts.all : categoryCounts[category],
    categoryAmount: 0,
    documentAmount: 0,
    totalAmount: 0,
    categoryCounts,
    source: 'query',
  }, {
    dateStart,
    dateEnd,
    salespersonIds: options.salespersonIds,
    category,
    portalGatcCount: portalStamping.count,
  });
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
    all: 0,
    product: 0,
    spare: 0,
    software_key: 0,
    service: 0,
    gatc: 0,
  };
  for (const row of rows) {
    const gatcOnly = isGatcFeeOnlyInvoice(row);
    if (!gatcOnly) counts.all += 1;
    const categories = row.categories.length ? row.categories : (row.invoiceCategory ? [row.invoiceCategory] : []);
    for (const key of categories) {
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
  const listCollection = await resolveAdminInvoiceListCollection();

  const perCustomer = await Promise.all(ids.map(async customerId => {
    const rows: AdminFirestoreInvoice[] = [];
    let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

    const buildConstraints = (ordered: boolean, pageCursor: QueryDocumentSnapshot<DocumentData> | null) => {
      const constraints: QueryConstraint[] = [];
      if (appendSalespersonIdConstraint(constraints, options.salespersonIds) === 'empty') {
        return 'empty' as const;
      }
      if (dateStart) constraints.push(where('date', '>=', dateStart));
      if (dateEnd) constraints.push(where('date', '<=', dateEnd));
      if (ordered) {
        if (dateStart || dateEnd || sort !== 'syncedAt') {
          constraints.push(orderBy('date', 'desc'));
        } else {
          constraints.push(orderBy('syncedAt', 'desc'));
        }
        constraints.push(orderBy('invoiceNumber', 'desc'));
        if (pageCursor) constraints.push(startAfter(pageCursor));
        constraints.push(limit(pageSize));
      }
      // Unordered fallback: no orderBy/startAfter (pagination needs a COLLECTION index).
      return constraints;
    };

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const constraints = buildConstraints(true, cursor);
        if (constraints === 'empty') return [];
        const snap = await getDocs(
          query(collection(db, 'zohoCustomers', customerId, listCollection), ...constraints),
        );
        if (snap.empty) break;
        rows.push(...snap.docs.map(mapAdminInvoiceDoc));
        cursor = snap.docs[snap.docs.length - 1];
        if (snap.size < pageSize) break;
      }
    } catch (err) {
      // Field overrides for collection-group date/syncedAt can omit COLLECTION indexes.
      // Fall back to unordered fetch + client sort so dealer drill-down still works.
      if (!isFirestoreIndexError(err)) throw err;
      rows.length = 0;
      const constraints = buildConstraints(false, null);
      if (constraints === 'empty') return [];
      const snap = await getDocs(
        query(collection(db, 'zohoCustomers', customerId, listCollection), ...constraints),
      );
      rows.push(...snap.docs.map(mapAdminInvoiceDoc));
      rows.sort((a, b) => compareInvoiceSortKey(a, b, sort));
    }
    return rows;
  }));

  let merged = filterRowsBySalespersonScope(perCustomer.flat(), options.salespersonIds);

  const selectedCategory = options.category && options.category !== 'all'
    ? options.category
    : null;
  if (selectedCategory === 'gatc') {
    const { rows: portalRows } = await fetchAdminPortalStampingInvoices({
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
      salespersonIds: options.salespersonIds,
      customerIds: ids,
      sort: options.sort,
    });
    merged = portalRows;
  } else if (selectedCategory) {
    merged = merged.filter(row => invoiceHasCategory(row, selectedCategory));
  }

  merged.sort((a, b) => compareInvoiceSortKey(a, b, sort));

  return overlayFreightSkuFromInvoiceDocs(merged);
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

function mapAdminInvoiceSerialNumbers(raw: Record<string, unknown>): string[] {
  if (Array.isArray(raw.serialNumbers) && raw.serialNumbers.length) {
    return [...new Set(
      raw.serialNumbers.map(value => String(value).trim()).filter(Boolean),
    )];
  }
  const serials: string[] = [];
  for (const candidate of [raw.serial_numbers, raw.item_serial_numbers, raw.itemSerialNumbers]) {
    if (!Array.isArray(candidate)) continue;
    for (const entry of candidate) {
      if (typeof entry === 'string' && entry.trim()) {
        serials.push(entry.trim());
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      const value = row.serial_number ?? row.serialnumber ?? row.serialNumber;
      if (value) serials.push(String(value).trim());
    }
  }
  return [...new Set(serials.filter(Boolean))];
}

function mapAdminInvoiceLineItem(raw: Record<string, unknown>): DealerInvoiceLineItem {
  const serialNumbers = mapAdminInvoiceSerialNumbers(raw);
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
    ...(serialNumbers.length ? { serialNumbers } : {}),
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
    categories: normalizeInvoiceCategories(data.categories),
    categoryAmounts: normalizeInvoiceCategoryAmounts(data.categoryAmounts),
    freightSku: String(data.freightSku ?? '').trim().toUpperCase()
      || freightSkuFromInvoiceLines(
        Array.isArray(data.lineItems) ? data.lineItems : null,
      )
      || null,
    salesOrderId: data.salesOrderId ? String(data.salesOrderId) : null,
    salesOrderNumber: data.salesOrderNumber ? String(data.salesOrderNumber) : null,
    subtotal: Number(data.subtotal ?? 0),
    taxTotal: Number(data.taxTotal ?? 0),
    notes: data.notes ? String(data.notes) : null,
    shippingAddress: data.shippingAddress ? String(data.shippingAddress) : null,
    billingAddress: data.billingAddress ? String(data.billingAddress) : null,
    lineItems: Array.isArray(data.lineItems)
      ? data.lineItems.map(item => mapAdminInvoiceLineItem(item as Record<string, unknown>))
      : [],
    customerPickup: mapInvoiceCustomerPickupField(data.customerPickup, data.customerPickupMarkedAt),
    manualDelivery: mapInvoiceManualDelivery(data.manualDelivery, data.manualDeliveredAt),
    zohoWarehouseId: data.zohoWarehouseId ? String(data.zohoWarehouseId) : null,
    zohoWarehouseName: data.zohoWarehouseName ? String(data.zohoWarehouseName) : null,
    ewayBill: data.ewayBill && typeof data.ewayBill === 'object'
      ? (data.ewayBill as DealerInvoiceDetail['ewayBill'])
      : null,
  };
}

/** Lightweight invoice date lookup for support cards / ticket info (ops). */
export async function fetchAdminInvoiceDate(
  customerId: string,
  invoiceId: string,
): Promise<string | null> {
  const snap = await getDoc(doc(db, 'zohoCustomers', customerId, 'invoices', invoiceId));
  if (!snap.exists()) return null;
  const date = snap.data()?.date;
  return date ? String(date) : null;
}

/** Batch-fetch invoice dates keyed by invoiceId for ops support queues. */
export async function fetchAdminInvoiceDatesForPairs(
  pairs: Array<{ customerId: string; invoiceId: string; fallbackCustomerId?: string }>,
): Promise<Map<string, string>> {
  const unique = new Map<string, { customerId: string; invoiceId: string; fallbackCustomerId?: string }>();
  for (const pair of pairs) {
    const customerId = pair.customerId?.trim();
    const invoiceId = pair.invoiceId?.trim();
    const fallbackCustomerId = pair.fallbackCustomerId?.trim();
    if (!customerId || !invoiceId || unique.has(invoiceId)) continue;
    unique.set(invoiceId, { customerId, invoiceId, fallbackCustomerId });
  }

  const map = new Map<string, string>();
  await Promise.all(
    [...unique.values()].map(async ({ customerId, invoiceId, fallbackCustomerId }) => {
      try {
        let date = await fetchAdminInvoiceDate(customerId, invoiceId);
        if (!date && fallbackCustomerId && fallbackCustomerId !== customerId) {
          date = await fetchAdminInvoiceDate(fallbackCustomerId, invoiceId);
        }
        if (date) map.set(invoiceId, date);
      } catch {
        // Skip unreadable invoices; card still shows number without date.
      }
    }),
  );
  return map;
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
  const preferredAddressId = data.shippingAddressId
    ? String(data.shippingAddressId).trim()
    : null;
  // Linked SO: pickup courier map, and ship-to when the invoice mirror has none.
  let soAddress: string | null = null;
  let soAddressId: string | null = null;
  let sourceSalesOrderIsPickup = false;
  const salesOrderId = data.salesOrderId ? String(data.salesOrderId).trim() : '';
  const salesOrderNumber = data.salesOrderNumber
    ? String(data.salesOrderNumber).trim()
    : (data.invoiceNumber ? String(data.invoiceNumber).trim() : '');
  let linkedSoFound = false;
  if (salesOrderId) {
    try {
      const soSnap = await getDoc(doc(db, 'salesOrders', salesOrderId));
      if (soSnap.exists()) {
        linkedSoFound = true;
        const so = soSnap.data();
        sourceSalesOrderIsPickup = salesOrderDataIsCustomerPickup(so);
        if (!preferredAddress) {
          soAddress = so?.shippingAddress ? String(so.shippingAddress).trim() || null : null;
          soAddressId = so?.shippingAddressId ? String(so.shippingAddressId).trim() || null : null;
        }
      }
    } catch {
      // ignore — fall back to customer contact
    }
  }
  if (!linkedSoFound && salesOrderNumber) {
    try {
      const byNumber = await getDocs(query(
        collection(db, 'salesOrders'),
        where('salesOrderNumber', '==', salesOrderNumber),
        limit(1),
      ));
      const so = byNumber.docs[0]?.data();
      if (so) {
        sourceSalesOrderIsPickup = salesOrderDataIsCustomerPickup(so);
      }
    } catch {
      // optional — Book Courier stays available if SO lookup fails
    }
  }
  const [withImages, contact] = await Promise.all([
    enrichInvoiceDetailImages(detail),
    resolveZohoCustomerDisplayContact(customerId, {
      preferredAddress: preferredAddress || soAddress,
      preferredAddressId: preferredAddressId || soAddressId,
    }),
  ]);
  const billingFromInvoice = String(data.billingAddress ?? '').trim() || null;
  return {
    ...withImages,
    shippingAddress: contact.address,
    billingAddress: billingFromInvoice || contact.billingAddress || contact.address,
    customerGstin: contact.gstin,
    customerPhone: contact.phone,
    customerTelHref: contact.telHref,
    customerWhatsappHref: contact.whatsappHref,
    customerPickup: mapInvoiceCustomerPickupField(data.customerPickup, data.customerPickupMarkedAt),
    sourceSalesOrderIsPickup,
    manualDelivery: mapInvoiceManualDelivery(data.manualDelivery, data.manualDeliveredAt),
    zohoWarehouseId: data.zohoWarehouseId ? String(data.zohoWarehouseId) : null,
    zohoWarehouseName: data.zohoWarehouseName ? String(data.zohoWarehouseName) : null,
    ewayBill: data.ewayBill && typeof data.ewayBill === 'object'
      ? (data.ewayBill as DealerInvoiceDetail['ewayBill'])
      : null,
  };
}
