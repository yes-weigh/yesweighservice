import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { enrichInvoiceDetailImages } from './invoiceLineItemImages';
import {
  getInvoicePeriodBounds,
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

export type AdminInvoiceSort = 'syncedAt' | 'date';

export interface AdminFirestoreInvoice {
  id: string;
  customerId: string;
  invoiceNumber: string;
  customerName: string | null;
  date: string | null;
  status: string;
  total: number;
  balance: number;
  referenceNumber: string | null;
  syncedAt: string | null;
  itemQuantity: number | null;
  invoiceCategory: InvoiceCategory | null;
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
    date: data.date ? String(data.date) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    syncedAt: timestampToIso(data.syncedAt),
    itemQuantity: lineItems.length ? sumInvoiceProductQuantity(lineItems) : null,
    invoiceCategory: parseInvoiceCategory(data.invoiceCategory),
  };
}

export function buildAdminInvoicesQuery(
  sort: AdminInvoiceSort,
  pageSize: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
) {
  const field = sort === 'syncedAt' ? 'syncedAt' : 'date';
  const constraints: QueryConstraint[] = [orderBy(field, 'desc'), limit(pageSize)];
  if (cursor) constraints.push(startAfter(cursor));
  return query(collectionGroup(db, 'invoices'), ...constraints);
}

export function subscribeAdminInvoices(
  sort: AdminInvoiceSort,
  pageSize: number,
  onData: (rows: AdminFirestoreInvoice[]) => void,
  onError: (message: string) => void,
) {
  const q = buildAdminInvoicesQuery(sort, pageSize);
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
): Promise<AdminFirestoreInvoice[]> {
  const snap = await getDocs(buildAdminInvoicesQuery(sort, pageSize, cursor));
  return snap.docs.map(mapAdminInvoiceDoc);
}

export function filterAdminInvoices(
  rows: AdminFirestoreInvoice[],
  searchText: string,
): AdminFirestoreInvoice[] {
  const needle = searchText.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(row => {
    const haystack = [
      row.invoiceNumber,
      row.customerName,
      row.customerId,
      row.referenceNumber,
      row.id,
      row.status,
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
    .map(row => ({ date: row.date!, total: row.total }));
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
        dayTotal += row.total;
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
