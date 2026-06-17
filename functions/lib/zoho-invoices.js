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
