import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

type SupportInvoiceTicketRef = {
  invoiceId: string;
  invoiceNumber?: string | null;
  zohoCustomerId?: string | null;
  dealerId?: string | null;
};

const customerIdCache = new Map<string, string | null>();
const invoiceDateCache = new Map<string, string | null>();

function cacheKey(invoiceId: string, customerId: string | null): string {
  return `${customerId ?? ''}::${invoiceId}`;
}

function dateFromDoc(data: Record<string, unknown> | undefined): string | null {
  const date = data?.date;
  return date ? String(date) : null;
}

async function readInvoiceDateUnderCustomer(
  customerId: string,
  invoiceId: string,
): Promise<string | null> {
  for (const sub of ['invoices', 'invoiceSummaries'] as const) {
    const snap = await getDoc(doc(db, 'zohoCustomers', customerId, sub, invoiceId));
    if (snap.exists()) {
      const date = dateFromDoc(snap.data() as Record<string, unknown>);
      if (date) return date;
    }
  }
  return null;
}

/** Portal UID / legacy ids → Zoho customer doc id. */
export async function resolveZohoCustomerIdForSupportTicket(
  zohoCustomerId: string | null | undefined,
  dealerId: string | null | undefined,
): Promise<string | null> {
  const direct = zohoCustomerId?.trim();
  if (direct) {
    if (customerIdCache.has(`zoho:${direct}`)) {
      return customerIdCache.get(`zoho:${direct}`) ?? null;
    }
    const snap = await getDoc(doc(db, 'zohoCustomers', direct));
    const resolved = snap.exists() ? direct : null;
    customerIdCache.set(`zoho:${direct}`, resolved);
    if (resolved) return resolved;
  }

  const portalUid = dealerId?.trim();
  if (!portalUid) return null;
  if (customerIdCache.has(`portal:${portalUid}`)) {
    return customerIdCache.get(`portal:${portalUid}`) ?? null;
  }

  let resolved: string | null = null;

  try {
    const userSnap = await getDoc(doc(db, 'users', portalUid));
    const fromUser = userSnap.data()?.zohoCustomerId;
    if (fromUser) {
      resolved = String(fromUser).trim() || null;
    }
  } catch {
    // Ops-only read — ignore and fall through.
  }

  if (!resolved) {
    try {
      const linked = await getDocs(
        query(collection(db, 'zohoCustomers'), where('portalUserId', '==', portalUid), limit(1)),
      );
      if (!linked.empty) resolved = linked.docs[0].id;
    } catch {
      // Missing index or permission — fall through.
    }
  }

  if (!resolved) {
    try {
      const legacySnap = await getDoc(doc(db, 'zohoCustomers', portalUid));
      if (legacySnap.exists()) resolved = portalUid;
    } catch {
      // ignore
    }
  }

  customerIdCache.set(`portal:${portalUid}`, resolved);
  return resolved;
}

async function fetchInvoiceDateByCollectionGroup(
  invoiceId: string,
  invoiceNumber?: string | null,
  preferredCustomerId?: string | null,
): Promise<string | null> {
  for (const sub of ['invoices', 'invoiceSummaries'] as const) {
    try {
      const snaps = await getDocs(
        query(collectionGroup(db, sub), where('id', '==', invoiceId), limit(5)),
      );
      const preferred = preferredCustomerId
        ? snaps.docs.find(docSnap => docSnap.ref.parent.parent?.id === preferredCustomerId)
        : null;
      const match = preferred ?? (snaps.size === 1 ? snaps.docs[0] : null);
      if (match) {
        const date = dateFromDoc(match.data() as Record<string, unknown>);
        if (date) return date;
      }
    } catch {
      // Index not ready for summaries — skip.
    }
  }

  const needle = invoiceNumber?.trim();
  if (!needle) return null;

  try {
    const snaps = await getDocs(
      query(collectionGroup(db, 'invoices'), where('invoiceNumber', '==', needle), limit(8)),
    );
    const idMatch = snaps.docs.find(docSnap => (
      docSnap.id === invoiceId
      || String((docSnap.data() as Record<string, unknown>).id ?? '') === invoiceId
    ));
    const customerMatch = preferredCustomerId
      ? snaps.docs.find(docSnap => docSnap.ref.parent.parent?.id === preferredCustomerId)
      : null;
    const match = idMatch ?? customerMatch ?? (snaps.size === 1 ? snaps.docs[0] : null);
    if (match) {
      return dateFromDoc(match.data() as Record<string, unknown>);
    }
  } catch {
    // ignore
  }

  return null;
}

export async function fetchSupportInvoiceDate(
  ticket: SupportInvoiceTicketRef,
): Promise<string | null> {
  const invoiceId = ticket.invoiceId?.trim();
  if (!invoiceId) return null;

  const customerId = await resolveZohoCustomerIdForSupportTicket(
    ticket.zohoCustomerId,
    ticket.dealerId,
  );
  const key = cacheKey(invoiceId, customerId);
  if (invoiceDateCache.has(key)) {
    return invoiceDateCache.get(key) ?? null;
  }

  let date: string | null = null;
  if (customerId) {
    date = await readInvoiceDateUnderCustomer(customerId, invoiceId);
  }
  if (!date) {
    date = await fetchInvoiceDateByCollectionGroup(
      invoiceId,
      ticket.invoiceNumber,
      customerId,
    );
  }

  invoiceDateCache.set(key, date);
  return date;
}

/** Batch-resolve invoice dates for support list cards (dealer + admin). */
export async function fetchSupportInvoiceDatesForTickets(
  tickets: SupportInvoiceTicketRef[],
): Promise<Map<string, string>> {
  const unique = new Map<string, SupportInvoiceTicketRef>();
  for (const ticket of tickets) {
    const invoiceId = ticket.invoiceId?.trim();
    if (!invoiceId || unique.has(invoiceId)) continue;
    unique.set(invoiceId, ticket);
  }

  const map = new Map<string, string>();
  await Promise.all(
    [...unique.values()].map(async ticket => {
      const date = await fetchSupportInvoiceDate(ticket);
      if (date) map.set(ticket.invoiceId.trim(), date);
    }),
  );
  return map;
}

export function clearSupportInvoiceDateCaches(): void {
  customerIdCache.clear();
  invoiceDateCache.clear();
}
