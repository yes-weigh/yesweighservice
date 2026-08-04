import { getFirestore } from 'firebase-admin/firestore';
import {
  filterInvoices,
  sortInvoices,
  paginateInvoices,
  filterInvoicesBySearch,
  computeInvoiceDashboardSummary,
  countInvoicesByCategory,
} from './invoice-mappers.js';
import {
  readCustomerInvoicesFromFirestore,
  readInvoiceDetailFromFirestore,
  ensureInvoiceDocumentPdf,
} from './invoice-sync.js';

export {
  mapInvoice,
  mapInvoiceLineItem,
  buildSalesEntries,
  computeDailySales,
  computeSalesForPeriod,
  computeInvoiceDashboardSummary,
  filterInvoices,
  sortInvoices,
  paginateInvoices,
  countInvoicesByCategory,
} from './invoice-mappers.js';

export async function resolveZohoCustomerIdForUser(uid, role) {
  const db = getFirestore();
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new Error('User profile not found.');
  }

  const userData = userSnap.data() ?? {};

  if (userData.zohoCustomerId) {
    return String(userData.zohoCustomerId);
  }

  if (role === 'dealer_staff') {
    const dealerUid = userData.dealerId ?? userData.directorId;
    if (dealerUid) {
      const dealerSnap = await db.doc(`users/${dealerUid}`).get();
      const dealerCustomerId = dealerSnap.data()?.zohoCustomerId;
      if (dealerCustomerId) return String(dealerCustomerId);

      const linked = await db
        .collection('zohoCustomers')
        .where('portalUserId', '==', dealerUid)
        .limit(1)
        .get();
      if (!linked.empty) return linked.docs[0].id;
    }
  }

  const linkedSelf = await db
    .collection('zohoCustomers')
    .where('portalUserId', '==', uid)
    .limit(1)
    .get();
  if (!linkedSelf.empty) return linkedSelf.docs[0].id;

  throw new Error('Your portal account is not linked to a Zoho customer yet. Contact YesOne support.');
}

export async function getDealerInvoiceDashboard(_secrets, _orgId, uid, role) {
  const customerId = await resolveZohoCustomerIdForUser(uid, role);
  const { invoices } = await readCustomerInvoicesFromFirestore(customerId);
  return {
    ...computeInvoiceDashboardSummary(invoices),
    customerId,
  };
}

export async function getDealerInvoiceDetail(_secrets, _orgId, uid, role, invoiceId, query = {}) {
  const requestedCustomerId = String(query.customerId ?? '').trim();
  let customerId;
  if (requestedCustomerId && (role === 'super_admin' || role === 'staff')) {
    customerId = requestedCustomerId;
  } else {
    customerId = await resolveZohoCustomerIdForUser(uid, role);
  }
  const detail = await readInvoiceDetailFromFirestore(customerId, invoiceId);
  if (!detail) {
    throw new Error('Invoice not found.');
  }
  return detail;
}

export async function downloadDealerInvoiceDocument(secrets, orgId, uid, role, invoiceId, documentType) {
  const customerId = await resolveZohoCustomerIdForUser(uid, role);
  return ensureInvoiceDocumentPdf(secrets, orgId, customerId, invoiceId, documentType);
}

export async function downloadAdminInvoiceDocument(secrets, orgId, customerId, invoiceId, documentType) {
  const safeCustomerId = String(customerId ?? '').trim();
  const safeInvoiceId = String(invoiceId ?? '').trim();
  if (!safeCustomerId || !safeInvoiceId) {
    throw new Error('Customer id and invoice id are required.');
  }
  return ensureInvoiceDocumentPdf(secrets, orgId, safeCustomerId, safeInvoiceId, documentType);
}

/**
 * Portal-stamped invoice ids + fee totals for a Zoho customer (GATC Billwise membership).
 */
async function loadPortalStampingForCustomer(customerId) {
  const db = getFirestore();
  const cid = String(customerId ?? '').trim();
  if (!cid) {
    return { invoiceIds: new Set(), feeByInvoiceId: new Map(), feeTotal: 0 };
  }

  let snap;
  try {
    snap = await db.collection('gatcReports')
      .where('customerId', '==', cid)
      .where('hasStamping', '==', true)
      .get();
  } catch {
    // Composite index may be missing — fall back to customer-only query.
    snap = await db.collection('gatcReports')
      .where('customerId', '==', cid)
      .get();
  }

  const invoiceIds = new Set();
  const feeByInvoiceId = new Map();
  let feeTotal = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data() ?? {};
    if (data.hasStamping === false) continue;
    const invoiceId = String(data.invoiceId ?? docSnap.id).trim();
    if (!invoiceId || invoiceIds.has(invoiceId)) continue;
    invoiceIds.add(invoiceId);
    const fee = Number(data.totals?.gatcFeeTotal) || 0;
    feeByInvoiceId.set(invoiceId, fee);
    feeTotal += fee;
  }
  return { invoiceIds, feeByInvoiceId, feeTotal };
}

export async function listDealerInvoices(_secrets, _orgId, uid, role, query = {}) {
  const requestedCustomerId = String(query.customerId ?? '').trim();
  let customerId;
  if (requestedCustomerId && (role === 'super_admin' || role === 'staff')) {
    customerId = requestedCustomerId;
  } else {
    customerId = await resolveZohoCustomerIdForUser(uid, role);
  }

  const status = String(query.status ?? 'all').trim().toLowerCase();
  const category = String(query.category ?? 'all').trim().toLowerCase();
  const searchText = String(query.q ?? '').trim();
  const sortField = String(query.sortField ?? 'date').trim();
  const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 25);

  const { invoices, searchBlobById, lastSyncedAt } = await readCustomerInvoicesFromFirestore(
    customerId,
    { includeSearchBlob: Boolean(searchText) },
  );

  const portalStamping = await loadPortalStampingForCustomer(customerId);

  let filtered = filterInvoices(invoices, { status, category: 'all' });

  if (searchText) {
    filtered = filterInvoicesBySearch(filtered, searchText, searchBlobById);
  }

  const categoryCounts = countInvoicesByCategory(filtered);
  // Stamping tab count = portal gatcReports membership (not Zoho GATC-HSN).
  categoryCounts.gatc = portalStamping.invoiceIds.size;

  let categorized;
  if (category === 'gatc') {
    categorized = filtered
      .filter(inv => portalStamping.invoiceIds.has(String(inv.id)))
      .map(inv => {
        const fee = portalStamping.feeByInvoiceId.get(String(inv.id)) ?? 0;
        const categories = Array.isArray(inv.categories) ? [...inv.categories] : [];
        if (!categories.includes('gatc')) categories.push('gatc');
        return {
          ...inv,
          categories,
          categoryAmounts: {
            ...(inv.categoryAmounts && typeof inv.categoryAmounts === 'object'
              ? inv.categoryAmounts
              : {}),
            gatc: fee,
          },
        };
      });
  } else {
    categorized = filterInvoices(filtered, { category });
  }

  const sorted = sortInvoices(categorized, sortField, sortDir);
  const paged = paginateInvoices(sorted, page, limit);

  return {
    ...paged,
    categoryCounts,
    customerId,
    lastSyncedAt,
    portalStampingFeeTotal: portalStamping.feeTotal,
    portalStampingInvoiceIds: [...portalStamping.invoiceIds],
  };
}
