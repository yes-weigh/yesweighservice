import { getFirestore } from 'firebase-admin/firestore';
import {
  filterInvoices,
  sortInvoices,
  paginateInvoices,
  filterInvoicesBySearch,
  computeInvoiceDashboardSummary,
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

  const { invoices, searchBlobById, lastSyncedAt } = await readCustomerInvoicesFromFirestore(customerId);

  let filtered = filterInvoices(invoices, { status, category });

  if (searchText) {
    filtered = filterInvoicesBySearch(filtered, searchText, searchBlobById);
  }

  filtered = sortInvoices(filtered, sortField, sortDir);
  const paged = paginateInvoices(filtered, page, limit);

  return {
    ...paged,
    customerId,
    lastSyncedAt,
  };
}
