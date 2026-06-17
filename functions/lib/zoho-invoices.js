import { getFirestore } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';

const STATUS_FILTER_MAP = {
  sent: 'Status.Sent',
  draft: 'Status.Draft',
  overdue: 'Status.OverDue',
  paid: 'Status.Paid',
  void: 'Status.Void',
  unpaid: 'Status.Unpaid',
  partially_paid: 'Status.PartiallyPaid',
  viewed: 'Status.Viewed',
};

const SORT_COLUMN_MAP = {
  invoiceNumber: 'invoice_number',
  date: 'date',
  dueDate: 'due_date',
  total: 'total',
  balance: 'balance',
  status: 'created_time',
};

export function mapInvoice(raw) {
  return {
    id: String(raw.invoice_id ?? ''),
    invoiceNumber: String(raw.invoice_number ?? ''),
    date: raw.date ?? null,
    dueDate: raw.due_date ?? null,
    status: String(raw.status ?? 'draft'),
    total: Number(raw.total ?? 0),
    balance: Number(raw.balance ?? 0),
    referenceNumber: raw.reference_number ? String(raw.reference_number) : null,
    lastPaymentDate: raw.last_payment_date ?? null,
    currencyCode: raw.currency_code ? String(raw.currency_code) : 'INR',
    customerName: raw.customer_name ? String(raw.customer_name) : null,
    invoiceUrl: raw.invoice_url ? String(raw.invoice_url) : null,
  };
}

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

  throw new Error('Your portal account is not linked to a Zoho customer yet. Contact YesWeigh support.');
}

async function fetchCustomerInvoicesPage(accessToken, orgId, customerId, page, options = {}) {
  const url = new URL(`${ZOHO_API_BASE}/invoices`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('customer_id', customerId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '200');
  if (options.filterBy) url.searchParams.set('filter_by', options.filterBy);
  if (options.searchText) url.searchParams.set('search_text', options.searchText);
  if (options.sortColumn) url.searchParams.set('sort_column', options.sortColumn);

  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    throw new Error(payload?.message || `Zoho invoices API error (${res.status}).`);
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload.message || 'Zoho invoices API error.');
  }

  return {
    invoices: (payload?.invoices ?? []).map(mapInvoice),
    hasMore: Boolean(payload?.page_context?.has_more_page),
  };
}

export async function fetchAllCustomerInvoices(accessToken, orgId, customerId, options = {}) {
  const invoices = [];
  let page = 1;
  const maxPages = 25;

  while (page <= maxPages) {
    const batch = await fetchCustomerInvoicesPage(accessToken, orgId, customerId, page, options);
    invoices.push(...batch.invoices);
    if (!batch.hasMore) break;
    page += 1;
  }

  return invoices;
}

export function filterInvoices(invoices, { status } = {}) {
  if (!status || status === 'all') return invoices;
  const normalized = String(status).toLowerCase();
  return invoices.filter(inv => String(inv.status).toLowerCase() === normalized);
}

export function sortInvoices(invoices, sortField = 'date', sortDir = 'desc') {
  const dir = sortDir === 'asc' ? 1 : -1;
  const key = sortField || 'date';

  return [...invoices].sort((a, b) => {
    if (key === 'total' || key === 'balance') {
      return (Number(a[key] ?? 0) - Number(b[key] ?? 0)) * dir;
    }
    if (key === 'date' || key === 'dueDate') {
      const av = a[key] ? Date.parse(a[key]) : 0;
      const bv = b[key] ? Date.parse(b[key]) : 0;
      return (av - bv) * dir;
    }
    const av = a[key === 'invoiceNumber' ? 'invoiceNumber' : key] ?? '';
    const bv = b[key === 'invoiceNumber' ? 'invoiceNumber' : key] ?? '';
    return String(av).localeCompare(String(bv)) * dir;
  });
}

export function paginateInvoices(invoices, page = 1, limit = 25) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const skip = (safePage - 1) * safeLimit;
  return {
    data: invoices.slice(skip, skip + safeLimit),
    pagination: {
      total: invoices.length,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(invoices.length / safeLimit) || 1,
    },
  };
}

function invoiceTimestamp(inv) {
  const raw = inv.date ? String(inv.date).trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  }
  const d = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(d) ? 0 : d;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function buildSalesEntries(invoices) {
  return invoices
    .filter(inv => inv.date)
    .map(inv => ({
      date: inv.date,
      total: Number(inv.total ?? 0),
    }));
}

export function computeDailySales(invoices, dayCount = 30) {
  const now = new Date();
  const dailySales = [];

  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - i);
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);

    let dayTotal = 0;
    for (const inv of invoices) {
      const ts = invoiceTimestamp(inv);
      if (ts >= dayStart.getTime() && ts <= dayEnd.getTime()) {
        dayTotal += Number(inv.total ?? 0);
      }
    }

    dailySales.push({
      label: day.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      total: dayTotal,
    });
  }

  return dailySales;
}

export function computeSalesForPeriod(invoices, periodDays = 30) {
  const now = new Date();
  const periodEnd = endOfDay(now);

  if (periodDays === null || periodDays === 'lifetime') {
    let totalSales = 0;
    for (const inv of invoices) {
      totalSales += Number(inv.total ?? 0);
    }
    return {
      periodStart: null,
      periodEnd: periodEnd.toISOString(),
      totalSales,
      previousSales: 0,
      salesTrendPct: null,
    };
  }

  const days = Number(periodDays) || 30;
  const periodStart = startOfDay(now);
  periodStart.setDate(periodStart.getDate() - (days - 1));

  const prevPeriodEnd = new Date(periodStart);
  prevPeriodEnd.setDate(prevPeriodEnd.getDate() - 1);
  prevPeriodEnd.setHours(23, 59, 59, 999);
  const prevPeriodStart = startOfDay(prevPeriodEnd);
  prevPeriodStart.setDate(prevPeriodStart.getDate() - (days - 1));

  let totalSales = 0;
  let previousSales = 0;

  for (const inv of invoices) {
    const ts = invoiceTimestamp(inv);
    const amount = Number(inv.total ?? 0);
    if (ts >= periodStart.getTime() && ts <= periodEnd.getTime()) {
      totalSales += amount;
    } else if (ts >= prevPeriodStart.getTime() && ts <= prevPeriodEnd.getTime()) {
      previousSales += amount;
    }
  }

  let salesTrendPct = null;
  if (previousSales > 0) {
    salesTrendPct = ((totalSales - previousSales) / previousSales) * 100;
  } else if (totalSales > 0) {
    salesTrendPct = 100;
  }

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    totalSales,
    previousSales,
    salesTrendPct,
  };
}

export function computeInvoiceDashboardSummary(invoices) {
  const salesPeriod = computeSalesForPeriod(invoices, 30);
  const dailySales = computeDailySales(invoices, 30);

  let outstandingBalance = 0;
  let unpaidCount = 0;
  let overdueCount = 0;
  let paidCount = 0;

  for (const inv of invoices) {
    const status = String(inv.status ?? '').toLowerCase();

    outstandingBalance += Number(inv.balance ?? 0);
    if (status === 'paid') paidCount += 1;
    if (status === 'unpaid' || status === 'partially_paid') unpaidCount += 1;
    if (status === 'overdue') overdueCount += 1;
  }

  const recentInvoices = sortInvoices(invoices, 'date', 'desc').slice(0, 5);

  return {
    periodStart: salesPeriod.periodStart,
    periodEnd: salesPeriod.periodEnd,
    totalSales: salesPeriod.totalSales,
    previousSales: salesPeriod.previousSales,
    salesTrendPct: salesPeriod.salesTrendPct,
    outstandingBalance,
    unpaidCount,
    overdueCount,
    paidCount,
    totalInvoiceCount: invoices.length,
    dailySales,
    salesEntries: buildSalesEntries(invoices),
    recentInvoices,
  };
}

export async function getDealerInvoiceDashboard(secrets, orgId, uid, role) {
  const customerId = await resolveZohoCustomerIdForUser(uid, role);
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const invoices = await fetchAllCustomerInvoices(accessToken, organizationId, customerId, {
    sortColumn: 'date',
  });
  return {
    ...computeInvoiceDashboardSummary(invoices),
    customerId,
  };
}

export function mapInvoiceLineItem(raw, imageUrl = null) {
  return {
    id: String(raw.line_item_id ?? raw.item_id ?? ''),
    itemId: raw.item_id ? String(raw.item_id) : null,
    name: String(raw.name ?? raw.item_name ?? 'Item'),
    description: raw.description ? String(raw.description) : null,
    sku: raw.sku ? String(raw.sku) : null,
    quantity: Number(raw.quantity ?? 0),
    rate: Number(raw.rate ?? 0),
    total: Number(raw.item_total ?? raw.total ?? 0),
    imageUrl,
  };
}

async function zohoJsonRequest(accessToken, orgId, path, options = {}) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  url.searchParams.set('organization_id', orgId);
  const res = await fetch(url.toString(), {
    headers: {
      ...authHeaders(accessToken, orgId),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok) {
    throw new Error(payload?.message || `Zoho API error (${res.status}).`);
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload.message || 'Zoho API error.');
  }
  return payload;
}

async function fetchInvoiceRaw(accessToken, orgId, invoiceId) {
  const payload = await zohoJsonRequest(accessToken, orgId, `/invoices/${invoiceId}`);
  return payload?.invoice ?? null;
}

async function getCatalogImagesForItems(itemIds) {
  const unique = [...new Set(itemIds.filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;

  const db = getFirestore();
  const refs = unique.map(id => db.collection('catalogProducts').doc(id));
  const snaps = await db.getAll(...refs);
  for (const snap of snaps) {
    if (snap.exists) {
      map.set(snap.id, snap.data()?.imageUrl ?? null);
    }
  }
  return map;
}

async function resolveSalesOrder(accessToken, orgId, customerId, invoiceRaw) {
  const salesOrderId = invoiceRaw.salesorder_id ? String(invoiceRaw.salesorder_id) : null;
  const referenceNumber = invoiceRaw.reference_number ? String(invoiceRaw.reference_number) : null;

  if (salesOrderId) {
    try {
      const payload = await zohoJsonRequest(accessToken, orgId, `/salesorders/${salesOrderId}`);
      const so = payload?.salesorder;
      if (so && String(so.customer_id) === customerId) {
        return {
          id: String(so.salesorder_id),
          number: so.salesorder_number ? String(so.salesorder_number) : referenceNumber,
        };
      }
    } catch {
      // Fall back to search by reference number.
    }
  }

  if (!referenceNumber) return null;

  const url = new URL(`${ZOHO_API_BASE}/salesorders`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('customer_id', customerId);
  url.searchParams.set('search_text', referenceNumber);
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok || payload?.code !== 0) return null;

  const orders = payload?.salesorders ?? [];
  const match =
    orders.find(so => String(so.salesorder_number) === referenceNumber)
    ?? orders.find(so => String(so.reference_number) === referenceNumber)
    ?? orders[0];

  if (!match) return null;
  return {
    id: String(match.salesorder_id),
    number: match.salesorder_number ? String(match.salesorder_number) : referenceNumber,
  };
}

export async function getDealerInvoiceDetail(secrets, orgId, uid, role, invoiceId) {
  const customerId = await resolveZohoCustomerIdForUser(uid, role);
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  const invoiceRaw = await fetchInvoiceRaw(accessToken, organizationId, invoiceId);
  if (!invoiceRaw) {
    throw new Error('Invoice not found.');
  }
  if (String(invoiceRaw.customer_id) !== customerId) {
    throw new Error('Invoice not found.');
  }

  const lineItemsRaw = invoiceRaw.line_items ?? [];
  const itemIds = lineItemsRaw.map(item => item.item_id ? String(item.item_id) : null);
  const imageMap = await getCatalogImagesForItems(itemIds);
  const lineItems = lineItemsRaw.map(item =>
    mapInvoiceLineItem(item, item.item_id ? imageMap.get(String(item.item_id)) ?? null : null),
  );

  const salesOrder = await resolveSalesOrder(accessToken, organizationId, customerId, invoiceRaw);

  return {
    ...mapInvoice(invoiceRaw),
    salesOrderId: salesOrder?.id ?? null,
    salesOrderNumber: salesOrder?.number ?? (invoiceRaw.reference_number ? String(invoiceRaw.reference_number) : null),
    subtotal: Number(invoiceRaw.sub_total ?? 0),
    taxTotal: Number(invoiceRaw.tax_total ?? 0),
    notes: invoiceRaw.notes ? String(invoiceRaw.notes) : null,
    lineItems,
  };
}

async function fetchZohoPdf(accessToken, orgId, resource, id) {
  const url = new URL(`${ZOHO_API_BASE}/${resource}/${id}`);
  url.searchParams.set('organization_id', orgId);
  const res = await fetch(url.toString(), {
    headers: {
      ...authHeaders(accessToken, orgId),
      Accept: 'application/pdf',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `Could not download ${resource} PDF (${res.status}).`;
    try {
      const payload = JSON.parse(text);
      if (payload?.message) message = payload.message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('PDF file is empty.');
  return buffer;
}

export async function downloadDealerInvoiceDocument(secrets, orgId, uid, role, invoiceId, documentType) {
  const customerId = await resolveZohoCustomerIdForUser(uid, role);
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  const invoiceRaw = await fetchInvoiceRaw(accessToken, organizationId, invoiceId);
  if (!invoiceRaw || String(invoiceRaw.customer_id) !== customerId) {
    throw new Error('Invoice not found.');
  }

  if (documentType === 'invoice') {
    const buffer = await fetchZohoPdf(accessToken, organizationId, 'invoices', invoiceId);
    const number = invoiceRaw.invoice_number ? String(invoiceRaw.invoice_number) : invoiceId;
    return {
      contentBase64: buffer.toString('base64'),
      filename: `${number.replace(/[^\w.-]+/g, '_')}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  if (documentType === 'salesorder') {
    const salesOrder = await resolveSalesOrder(accessToken, organizationId, customerId, invoiceRaw);
    if (!salesOrder?.id) {
      throw new Error('Sales order not found for this invoice.');
    }
    const buffer = await fetchZohoPdf(accessToken, organizationId, 'salesorders', salesOrder.id);
    const number = salesOrder.number ? String(salesOrder.number) : salesOrder.id;
    return {
      contentBase64: buffer.toString('base64'),
      filename: `${number.replace(/[^\w.-]+/g, '_')}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  throw new Error('Unsupported document type.');
}

export async function listDealerInvoices(secrets, orgId, uid, role, query = {}) {
  const customerId = await resolveZohoCustomerIdForUser(uid, role);
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  const status = String(query.status ?? 'all').trim().toLowerCase();
  const searchText = String(query.q ?? '').trim();
  const sortField = String(query.sortField ?? 'date').trim();
  const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 25);

  const filterBy = status !== 'all' ? (STATUS_FILTER_MAP[status] ?? 'Status.All') : 'Status.All';
  const sortColumn = SORT_COLUMN_MAP[sortField] ?? 'date';

  let invoices = await fetchAllCustomerInvoices(accessToken, organizationId, customerId, {
    filterBy: status !== 'all' ? filterBy : undefined,
    searchText: searchText || undefined,
    sortColumn,
  });

  invoices = filterInvoices(invoices, { status });
  invoices = sortInvoices(invoices, sortField, sortDir);
  const paged = paginateInvoices(invoices, page, limit);

  return {
    ...paged,
    customerId,
  };
}
