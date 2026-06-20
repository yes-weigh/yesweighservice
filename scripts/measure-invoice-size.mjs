/**
 * Sample Zoho invoice details and estimate Firestore payload sizes.
 *
 * PowerShell:
 *   $env:ZOHO_CLIENT_ID="YOUR_CLIENT_ID"
 *   $env:ZOHO_CLIENT_SECRET="YOUR_CLIENT_SECRET"
 *   $env:ZOHO_REFRESH_TOKEN="YOUR_REFRESH_TOKEN"
 *   $env:ZOHO_ORGANIZATION_ID="YOUR_ORG_ID"
 *   node scripts/measure-invoice-size.mjs
 *
 * Optional:
 *   $env:INVOICE_SAMPLE_COUNT="200"
 *   $env:INVOICE_DATE_FROM="2025-04-01"
 *   $env:INVOICE_DATE_TO="2026-12-31"
 */

const clientId = process.env.ZOHO_CLIENT_ID?.trim();
const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
const refreshToken = process.env.ZOHO_REFRESH_TOKEN?.trim();
let orgId = process.env.ZOHO_ORGANIZATION_ID?.trim() || '';
const accountsUrl = process.env.ZOHO_ACCOUNTS_URL?.trim() || 'https://accounts.zoho.in';
const apiBase = process.env.ZOHO_API_BASE?.trim() || 'https://www.zohoapis.in/inventory/v1';
const sampleCount = Math.max(1, Math.min(500, Number(process.env.INVOICE_SAMPLE_COUNT ?? 200) || 200));
const dateFrom = process.env.INVOICE_DATE_FROM?.trim() || '';
const dateTo = process.env.INVOICE_DATE_TO?.trim() || '';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function utf8Bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function mapInvoice(raw) {
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

function mapLineItem(raw) {
  return {
    id: String(raw.line_item_id ?? raw.item_id ?? ''),
    itemId: raw.item_id ? String(raw.item_id) : null,
    name: String(raw.name ?? raw.item_name ?? 'Item'),
    description: raw.description ? String(raw.description) : null,
    sku: raw.sku ? String(raw.sku) : null,
    quantity: Number(raw.quantity ?? 0),
    rate: Number(raw.rate ?? 0),
    total: Number(raw.item_total ?? raw.total ?? 0),
    imageUrl: null,
  };
}

function buildSearchBlob(invoiceRaw) {
  const parts = [
    invoiceRaw.invoice_number,
    invoiceRaw.reference_number,
    invoiceRaw.customer_name,
    invoiceRaw.notes,
  ];
  for (const item of invoiceRaw.line_items ?? []) {
    parts.push(item.name, item.item_name, item.description, item.sku);
  }
  return parts.filter(Boolean).map(String).join(' ').toLowerCase();
}

function contentFingerprint(invoiceRaw) {
  return [
    invoiceRaw.last_modified_time,
    invoiceRaw.status,
    invoiceRaw.total,
    invoiceRaw.balance,
    invoiceRaw.invoice_number,
    (invoiceRaw.line_items ?? []).length,
  ].join('|');
}

/** Same fields we store under zohoCustomers/{customerId}/invoices/{invoiceId}. */
function buildFirestoreInvoiceDoc(invoiceRaw) {
  const customerId = String(invoiceRaw.customer_id);
  const lineItems = (invoiceRaw.line_items ?? []).map(mapLineItem);
  return {
    ...mapInvoice(invoiceRaw),
    customerId,
    searchBlob: buildSearchBlob(invoiceRaw),
    salesOrderId: null,
    salesOrderNumber: invoiceRaw.reference_number ? String(invoiceRaw.reference_number) : null,
    subtotal: Number(invoiceRaw.sub_total ?? 0),
    taxTotal: Number(invoiceRaw.tax_total ?? 0),
    notes: invoiceRaw.notes ? String(invoiceRaw.notes) : null,
    lineItems,
    zohoLastModified: invoiceRaw.last_modified_time ? String(invoiceRaw.last_modified_time) : null,
    contentFingerprint: contentFingerprint(invoiceRaw),
    syncedAt: new Date().toISOString(),
  };
}

function buildListHeaderOnly(invoiceRaw) {
  return {
    ...mapInvoice(invoiceRaw),
    customerId: String(invoiceRaw.customer_id),
  };
}

function inDateRange(invoiceRaw) {
  const date = String(invoiceRaw.date ?? '').slice(0, 10);
  if (!date) return true;
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

function stats(values) {
  if (!values.length) return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, total: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, n) => sum + n, 0);
  const pick = p => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: total / sorted.length,
    p50: pick(0.5),
    p95: pick(0.95),
    total,
  };
}

function batchDoc(customerId, invoices, invoicesPerDoc) {
  const chunks = [];
  for (let i = 0; i < invoices.length; i += invoicesPerDoc) {
    chunks.push(invoices.slice(i, i + invoicesPerDoc));
  }
  return chunks.map((chunk, index) => ({
    customerId,
    batchIndex: index,
    invoiceCount: chunk.length,
    invoices: chunk,
    syncedAt: new Date().toISOString(),
  }));
}

async function getAccessToken() {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await res.json();
  if (!res.ok || payload.error) {
    fail(`Token refresh failed: ${payload.error || payload.message || res.statusText}`);
  }
  return payload.access_token;
}

async function resolveOrgId(accessToken) {
  if (orgId) return orgId;
  const res = await fetch(`${apiBase}/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const payload = await res.json();
  if (!res.ok || (payload.code !== undefined && payload.code !== 0)) {
    fail(`Could not list organizations: ${payload.message || res.statusText}`);
  }
  const orgs = payload.organizations ?? [];
  if (!orgs.length) fail('No organizations found.');
  orgId = String(orgs[0].organization_id);
  return orgId;
}

async function listInvoiceSummaries(accessToken, organizationId) {
  const summaries = [];
  let page = 1;
  while (summaries.length < sampleCount && page <= 200) {
    const url = new URL(`${apiBase}/invoices`);
    url.searchParams.set('organization_id', organizationId);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '200');
    url.searchParams.set('sort_column', 'date');
    url.searchParams.set('sort_order', 'D');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const payload = await res.json();
    if (!res.ok || (payload.code !== undefined && payload.code !== 0)) {
      fail(`List invoices failed: ${payload.message || res.statusText}`);
    }

    for (const row of payload.invoices ?? []) {
      if (!inDateRange(row)) continue;
      summaries.push(row);
      if (summaries.length >= sampleCount) break;
    }

    if (!payload.page_context?.has_more_page) break;
    page += 1;
    await sleep(300);
  }
  return summaries;
}

async function fetchInvoiceDetail(accessToken, organizationId, invoiceId) {
  const url = new URL(`${apiBase}/invoices/${invoiceId}`);
  url.searchParams.set('organization_id', organizationId);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const payload = await res.json();
  if (!res.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new Error(payload.message || `HTTP ${res.status}`);
  }
  return payload.invoice ?? null;
}

if (!clientId || !clientSecret || !refreshToken) {
  fail('Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN.');
}

console.log(`Sampling up to ${sampleCount} invoice detail payloads…`);
if (dateFrom || dateTo) {
  console.log(`Date filter: ${dateFrom || '…'} → ${dateTo || '…'}`);
}

const accessToken = await getAccessToken();
const organizationId = await resolveOrgId(accessToken);
console.log(`Org ID: ${organizationId}\n`);

const summaries = await listInvoiceSummaries(accessToken, organizationId);
if (!summaries.length) fail('No invoices matched the list/date filter.');

console.log(`Listed ${summaries.length} invoice(s). Fetching details…\n`);

const detailDocs = [];
const headerDocs = [];
const lineItemCounts = [];
let apiCalls = 1;
let failed = 0;

for (let i = 0; i < summaries.length; i += 1) {
  const summary = summaries[i];
  const invoiceId = String(summary.invoice_id);
  try {
    const raw = await fetchInvoiceDetail(accessToken, organizationId, invoiceId);
    apiCalls += 1;
    if (!raw) continue;
    detailDocs.push(buildFirestoreInvoiceDoc(raw));
    headerDocs.push(buildListHeaderOnly(raw));
    lineItemCounts.push((raw.line_items ?? []).length);
  } catch (err) {
    failed += 1;
    console.warn(`  skip ${invoiceId}: ${err.message}`);
  }
  if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${summaries.length}`);
  await sleep(350);
}

if (!detailDocs.length) fail('No invoice details fetched.');

const detailBytes = detailDocs.map(utf8Bytes);
const headerBytes = headerDocs.map(utf8Bytes);
const detailStat = stats(detailBytes);
const headerStat = stats(headerBytes);
const lineStat = stats(lineItemCounts);

console.log('\n=== Per-invoice Firestore doc (current 1 doc / invoice) ===');
console.log(`Samples     : ${detailDocs.length} (${failed} failed)`);
console.log(`Line items  : min ${lineStat.min}, avg ${lineStat.avg.toFixed(1)}, max ${lineStat.max}, p95 ${lineStat.p95}`);
console.log(`JSON size   : min ${formatBytes(detailStat.min)}, avg ${formatBytes(detailStat.avg)}, max ${formatBytes(detailStat.max)}, p95 ${formatBytes(detailStat.p95)}`);
console.log(`Total sample: ${formatBytes(detailStat.total)}`);
console.log(`Zoho calls  : ~${apiCalls} (1 token + 1 list page(s) + ${detailDocs.length} detail)`);

console.log('\n=== List header only (no line items) ===');
console.log(`JSON size   : avg ${formatBytes(headerStat.avg)}, max ${formatBytes(headerStat.max)}`);

const FIRESTORE_DOC_LIMIT = 1024 * 1024;
const batchSizes = [5, 10, 20, 50];
console.log('\n=== Batched storage simulation (invoices[] in one doc) ===');
console.log(`Firestore hard limit per doc: ${formatBytes(FIRESTORE_DOC_LIMIT)}\n`);

for (const perDoc of batchSizes) {
  const byCustomer = new Map();
  for (const doc of detailDocs) {
    const list = byCustomer.get(doc.customerId) ?? [];
    list.push(doc);
    byCustomer.set(doc.customerId, list);
  }

  const batchBytes = [];
  for (const [, invoices] of byCustomer) {
    for (const batch of batchDoc(invoices[0].customerId, invoices, perDoc)) {
      batchBytes.push(utf8Bytes(batch));
    }
  }
  const batchStat = stats(batchBytes);
  const docsFor20k = Math.ceil(20118 / perDoc);
  const estStorage = (detailStat.avg * 20118) / (1024 * 1024);
  const estDocs = docsFor20k;
  console.log(
    `${String(perDoc).padStart(2)} / doc → batch avg ${formatBytes(batchStat.avg)}, max ${formatBytes(batchStat.max)}, p95 ${formatBytes(batchStat.p95)} | ~${estDocs.toLocaleString()} docs for 20,118 invoices | ~${estStorage.toFixed(0)} MB total (1/doc model)`,
  );
}

const orgTotal = 20118;
console.log('\n=== Rough projections @ 20,118 invoices (from this sample avg) ===');
console.log(`1 invoice/doc : ~${orgTotal.toLocaleString()} documents, ~${((detailStat.avg * orgTotal) / (1024 * 1024)).toFixed(1)} MB JSON`);
console.log(`10 / doc      : ~${Math.ceil(orgTotal / 10).toLocaleString()} documents, ~${((detailStat.avg * orgTotal) / (1024 * 1024)).toFixed(1)} MB JSON (same data, fewer docs)`);
console.log(`Daily API @8000: ~${Math.max(0, 8000 - 101).toLocaleString()} detail calls/day → ~${Math.ceil(orgTotal / Math.max(1, 8000 - 101))} days first backfill`);

console.log('\nDone. Sizes are UTF-8 JSON; Firestore stores ~similar order of magnitude.');
