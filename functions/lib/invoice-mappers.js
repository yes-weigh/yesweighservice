export function mapInvoice(raw) {
  return {
    id: String(raw.invoice_id ?? raw.id ?? ''),
    invoiceNumber: String(raw.invoice_number ?? raw.invoiceNumber ?? ''),
    date: raw.date ?? null,
    dueDate: raw.due_date ?? raw.dueDate ?? null,
    status: String(raw.status ?? 'draft'),
    total: Number(raw.total ?? 0),
    balance: Number(raw.balance ?? 0),
    referenceNumber: raw.reference_number ?? raw.referenceNumber
      ? String(raw.reference_number ?? raw.referenceNumber)
      : null,
    lastPaymentDate: raw.last_payment_date ?? raw.lastPaymentDate ?? null,
    currencyCode: raw.currency_code ?? raw.currencyCode
      ? String(raw.currency_code ?? raw.currencyCode)
      : 'INR',
    customerName: raw.customer_name ?? raw.customerName
      ? String(raw.customer_name ?? raw.customerName)
      : null,
    invoiceUrl: raw.invoice_url ?? raw.invoiceUrl
      ? String(raw.invoice_url ?? raw.invoiceUrl)
      : null,
  };
}

export function extractLineItemSerialNumbers(raw) {
  if (!raw || typeof raw !== 'object') return [];

  if (Array.isArray(raw.serialNumbers) && raw.serialNumbers.length) {
    return [...new Set(raw.serialNumbers.map(value => String(value).trim()).filter(Boolean))];
  }

  const serials = [];

  for (const candidate of [
    raw.serial_numbers,
    raw.serialNumbers,
    raw.item_serial_numbers,
    raw.itemSerialNumbers,
  ]) {
    if (!Array.isArray(candidate)) continue;
    for (const entry of candidate) {
      if (typeof entry === 'string' && entry.trim()) {
        serials.push(entry.trim());
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const value = entry.serial_number
        ?? entry.serialnumber
        ?? entry.serial_number_value
        ?? entry.serialNumber;
      if (value) serials.push(String(value).trim());
    }
  }

  for (const field of raw.item_custom_fields ?? raw.custom_fields ?? []) {
    const label = String(field.label ?? field.api_name ?? field.customfield_id ?? '').toLowerCase();
    if (!label.includes('serial') && !label.includes('mac')) continue;
    const value = field.value ?? field.value_formatted;
    if (value) serials.push(String(value).trim());
  }

  const description = raw.description ? String(raw.description) : '';
  if (description) {
    const pattern = /\b(?:serial(?:\s*number)?|s\/n|sn|mac(?:\s*id)?)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9._/-]{2,})/gi;
    let match = pattern.exec(description);
    while (match) {
      if (match[1]) serials.push(match[1].trim());
      match = pattern.exec(description);
    }
  }

  return [...new Set(serials.filter(Boolean))];
}

export function mapInvoiceLineItem(raw, imageUrl = null) {
  return {
    id: String(raw.line_item_id ?? raw.item_id ?? raw.id ?? ''),
    itemId: raw.item_id ?? raw.itemId ? String(raw.item_id ?? raw.itemId) : null,
    name: String(raw.name ?? raw.item_name ?? 'Item'),
    description: raw.description ? String(raw.description) : null,
    sku: raw.sku ? String(raw.sku) : null,
    quantity: Number(raw.quantity ?? 0),
    rate: Number(raw.rate ?? 0),
    total: Number(raw.item_total ?? raw.total ?? 0),
    imageUrl,
    serialNumbers: extractLineItemSerialNumbers(raw),
  };
}

export function buildInvoiceSearchBlob(invoiceRaw) {
  const parts = [
    invoiceRaw.invoice_number,
    invoiceRaw.reference_number,
    invoiceRaw.customer_name,
    invoiceRaw.notes,
  ];
  for (const item of invoiceRaw.line_items ?? invoiceRaw.lineItems ?? []) {
    parts.push(item.name, item.item_name, item.description, item.sku);
    parts.push(...extractLineItemSerialNumbers(item));
  }
  return parts
    .filter(Boolean)
    .map(value => String(value))
    .join(' ')
    .toLowerCase();
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

function normalizeSearchNeedle(value) {
  return String(value ?? '').trim().toLowerCase();
}

function invoiceHeaderMatches(invoice, needle) {
  if (!needle) return true;
  const fields = [
    invoice.invoiceNumber,
    invoice.referenceNumber,
    invoice.customerName,
    invoice.id,
  ];
  return fields.some(field => field && String(field).toLowerCase().includes(needle));
}

export function filterInvoicesBySearch(invoices, searchText, searchBlobById = new Map()) {
  const needle = normalizeSearchNeedle(searchText);
  if (!needle) return invoices;

  return invoices.filter(invoice => {
    if (invoiceHeaderMatches(invoice, needle)) return true;
    const blob = searchBlobById.get(invoice.id) ?? invoice.searchBlob ?? '';
    return String(blob).includes(needle);
  });
}

export function firestoreDocToListInvoice(data) {
  const invoiceCategory = data.invoiceCategory
    && ['product', 'spare', 'service', 'software_key'].includes(String(data.invoiceCategory))
    ? String(data.invoiceCategory)
    : null;
  return {
    id: String(data.id ?? ''),
    invoiceNumber: String(data.invoiceNumber ?? ''),
    date: data.date ?? null,
    dueDate: data.dueDate ?? null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ?? null,
    lastPaymentDate: data.lastPaymentDate ?? null,
    currencyCode: data.currencyCode ? String(data.currencyCode) : 'INR',
    customerName: data.customerName ?? null,
    invoiceUrl: data.invoiceUrl ?? null,
    invoiceCategory,
  };
}

export function firestoreDocToDetail(data) {
  return {
    ...firestoreDocToListInvoice(data),
    salesOrderId: data.salesOrderId ?? null,
    salesOrderNumber: data.salesOrderNumber ?? null,
    subtotal: Number(data.subtotal ?? 0),
    taxTotal: Number(data.taxTotal ?? 0),
    notes: data.notes ?? null,
    lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
  };
}
