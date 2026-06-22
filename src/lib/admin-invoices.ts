import {
  collectionGroup,
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
