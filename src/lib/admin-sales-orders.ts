import {
  collection,
  doc,
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
import type {
  DealerInvoiceLineItem,
  InvoiceCategory,
  InvoiceDocumentDownload,
  InvoiceSalesEntry,
  KpiPeriod,
} from '../types/invoices';

const functions = getFunctions(app, 'asia-south1');

export type AdminSalesOrderSort = 'syncedAt' | 'date';

export interface AdminFirestoreSalesOrder {
  id: string;
  salesOrderNumber: string;
  customerId: string;
  customerName: string | null;
  date: string | null;
  shipmentDate: string | null;
  status: string;
  total: number;
  balance: number;
  referenceNumber: string | null;
  syncedAt: string | null;
  itemQuantity: number | null;
  salesOrderCategory: InvoiceCategory | null;
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
  salesOrderCategory: InvoiceCategory | null;
  subtotal: number;
  taxTotal: number;
  notes: string | null;
  lineItems: DealerInvoiceLineItem[];
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
    date: data.date ? String(data.date) : null,
    shipmentDate: data.shipmentDate ? String(data.shipmentDate) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    syncedAt: timestampToIso(data.syncedAt),
    itemQuantity: lineItems.length ? sumInvoiceProductQuantity(lineItems) : null,
    salesOrderCategory: parseInvoiceCategory(data.salesOrderCategory),
  };
}

export function buildAdminSalesOrdersQuery(
  sort: AdminSalesOrderSort,
  pageSize: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
) {
  const field = sort === 'syncedAt' ? 'syncedAt' : 'date';
  const constraints: QueryConstraint[] = [];
  if (category && category !== 'all') {
    constraints.push(where('salesOrderCategory', '==', category));
  }
  constraints.push(orderBy(field, 'desc'), limit(pageSize));
  if (cursor) constraints.push(startAfter(cursor));
  return query(collection(db, 'salesOrders'), ...constraints);
}

export function subscribeAdminSalesOrders(
  sort: AdminSalesOrderSort,
  pageSize: number,
  onData: (rows: AdminFirestoreSalesOrder[]) => void,
  onError: (message: string) => void,
  category: InvoiceCategory | 'all' = 'all',
) {
  const q = buildAdminSalesOrdersQuery(sort, pageSize, null, category);
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
  sort: AdminSalesOrderSort,
  pageSize: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
): Promise<AdminFirestoreSalesOrder[]> {
  const snap = await getDocs(buildAdminSalesOrdersQuery(sort, pageSize, cursor, category));
  return snap.docs.map(mapAdminSalesOrderDoc);
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
    salesOrderCategory: parseInvoiceCategory(data.salesOrderCategory),
    subtotal: Number(data.subtotal ?? 0),
    taxTotal: Number(data.taxTotal ?? 0),
    notes: data.notes ? String(data.notes) : null,
    lineItems: Array.isArray(data.lineItems)
      ? data.lineItems.map(item => mapLineItem(item as Record<string, unknown>))
      : [],
  };
}

export async function fetchAdminSalesOrderDetail(
  salesOrderId: string,
): Promise<AdminSalesOrderDetail> {
  const snap = await getDoc(doc(db, 'salesOrders', salesOrderId));
  if (!snap.exists()) {
    throw new Error('Sales order not found.');
  }
  const detail = mapAdminSalesOrderDetail(salesOrderId, snap.data());
  const withImages = await enrichInvoiceDetailImages({
    ...detail,
    invoiceNumber: detail.salesOrderNumber,
    dueDate: detail.shipmentDate,
    lastPaymentDate: null,
    customerName: detail.customerName,
    invoiceUrl: null,
    salesOrderId: null,
    salesOrderNumber: null,
  });
  return {
    ...detail,
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
