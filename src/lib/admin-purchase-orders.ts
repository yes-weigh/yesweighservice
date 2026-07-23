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

export type AdminPurchaseOrderSort = 'syncedAt' | 'date';

export interface AdminFirestorePurchaseOrder {
  id: string;
  purchaseOrderNumber: string;
  vendorId: string;
  vendorName: string | null;
  date: string | null;
  deliveryDate: string | null;
  status: string;
  total: number;
  balance: number;
  currencyCode: string;
  referenceNumber: string | null;
  syncedAt: string | null;
  itemQuantity: number | null;
  purchaseOrderCategory: InvoiceCategory | null;
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
    deliveryDate: data.deliveryDate ? String(data.deliveryDate) : null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    currencyCode: data.currencyCode ? String(data.currencyCode).toUpperCase() : 'INR',
    referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
    syncedAt: timestampToIso(data.syncedAt),
    itemQuantity: lineItems.length ? sumInvoiceProductQuantity(lineItems) : null,
    purchaseOrderCategory: parseInvoiceCategory(data.purchaseOrderCategory),
  };
}

export function buildAdminPurchaseOrdersQuery(
  sort: AdminPurchaseOrderSort,
  pageSize: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
) {
  const field = sort === 'syncedAt' ? 'syncedAt' : 'date';
  const constraints: QueryConstraint[] = [];
  if (category && category !== 'all') {
    constraints.push(where('purchaseOrderCategory', '==', category));
  }
  constraints.push(orderBy(field, 'desc'), limit(pageSize));
  if (cursor) constraints.push(startAfter(cursor));
  return query(collection(db, 'purchaseOrders'), ...constraints);
}

export function subscribeAdminPurchaseOrders(
  sort: AdminPurchaseOrderSort,
  pageSize: number,
  onData: (rows: AdminFirestorePurchaseOrder[]) => void,
  onError: (message: string) => void,
  category: InvoiceCategory | 'all' = 'all',
) {
  const q = buildAdminPurchaseOrdersQuery(sort, pageSize, null, category);
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

export async function fetchAdminPurchaseOrdersPage(
  sort: AdminPurchaseOrderSort,
  pageSize: number,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
  category: InvoiceCategory | 'all' = 'all',
): Promise<AdminFirestorePurchaseOrder[]> {
  const snap = await getDocs(buildAdminPurchaseOrdersQuery(sort, pageSize, cursor, category));
  return snap.docs.map(mapAdminPurchaseOrderDoc);
}

export function filterAdminPurchaseOrders(
  rows: AdminFirestorePurchaseOrder[],
  searchText: string,
  category: InvoiceCategory | 'all' = 'all',
): AdminFirestorePurchaseOrder[] {
  let next = rows;
  if (category && category !== 'all') {
    next = next.filter(row => row.purchaseOrderCategory === category);
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
