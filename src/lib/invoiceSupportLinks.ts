import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { mapSupportRequest } from './dealerSupport';
import { isSupportDraft } from './supportStatus';

const SUPPORT_LINK_LIMIT = 500;

export type SupportLinkedInvoiceRefs = {
  invoiceIds: Set<string>;
  invoiceNumbers: Set<string>;
};

function addToken(set: Set<string>, value: unknown) {
  const token = String(value ?? '').trim();
  if (token) set.add(token);
}

function addInvoiceIdsFromLogistics(data: Record<string, unknown>, ids: Set<string>, numbers: Set<string>) {
  addToken(ids, data.invoiceId);
  addToken(numbers, data.invoiceNumber);
  if (Array.isArray(data.invoiceIds)) {
    for (const id of data.invoiceIds) addToken(ids, id);
  }
}

/** Invoice ids/numbers on support tickets, plus invoices on logistics bookings that have a ticket. */
export async function fetchSupportLinkedInvoiceRefs(): Promise<SupportLinkedInvoiceRefs> {
  const invoiceIds = new Set<string>();
  const invoiceNumbers = new Set<string>();

  const [byInvoiceId, byInvoiceNumber, logisticsWithSupport] = await Promise.all([
    getDocs(query(
      collection(db, 'dealerSupportRequests'),
      where('invoiceId', '>', ''),
      limit(SUPPORT_LINK_LIMIT),
    )),
    getDocs(query(
      collection(db, 'dealerSupportRequests'),
      where('invoiceNumber', '>', ''),
      limit(SUPPORT_LINK_LIMIT),
    )),
    getDocs(query(
      collection(db, 'logisticsBookings'),
      where('supportRequestId', '>', ''),
      limit(SUPPORT_LINK_LIMIT),
    )),
  ]);

  for (const snap of [byInvoiceId, byInvoiceNumber]) {
    for (const docSnap of snap.docs) {
      const request = mapSupportRequest(docSnap.id, docSnap.data());
      if (isSupportDraft(request)) continue;
      addToken(invoiceIds, request.invoiceId);
      addToken(invoiceNumbers, request.invoiceNumber);
    }
  }

  for (const docSnap of logisticsWithSupport.docs) {
    addInvoiceIdsFromLogistics(
      docSnap.data() as Record<string, unknown>,
      invoiceIds,
      invoiceNumbers,
    );
  }

  return { invoiceIds, invoiceNumbers };
}

export function invoiceMatchesSupportLinks(
  invoice: { id: string; invoiceNumber?: string | null },
  refs: SupportLinkedInvoiceRefs | null,
): boolean {
  if (!refs) return false;
  if (refs.invoiceIds.has(invoice.id)) return true;
  const number = String(invoice.invoiceNumber ?? '').trim();
  return Boolean(number && refs.invoiceNumbers.has(number));
}
