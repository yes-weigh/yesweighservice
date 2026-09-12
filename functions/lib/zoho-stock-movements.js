/**
 * Zoho item stock movements via /items/transactions/* (includes item_quantity).
 * Fetches stock-affecting doc types. Bills are always pulled (inventory and
 * service / software-key items). Draft/void/cancelled docs stay visible but
 * qtyDelta=0 so Running matches Zoho accounting stock. Always fetched live from Zoho.
 */
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId, ZOHO_API_BASE } from './zoho.js';
import { assertZohoDaytimeBudget, peekZohoApiUsageCached } from './zoho-api-usage.js';

const REQUEST_GAP_MS = 100;
const PAGE_SIZE = 200;
/** Lifetime ledger used to paginate 100 pages × many doc types — that burned the 10k cap. */
const MAX_TRANSACTION_PAGES = 20;
const LIFETIME_CACHE_MS = 6 * 60 * 60 * 1000;
const LIFETIME_CACHE_DOC = 'lifetime';
const BILL_CURRENCY_ENRICH_CAP = 15;
const STOCK_MOVEMENTS_SUB = 'stockMovements';
const LEGACY_CACHE_PURGE_KEY = 'no-firestore-stock-ledger-v1';
const SOFTWARE_KEYS_LEDGER_HSN = '997331';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isZohoUnauthorized(res, json) {
  if (res?.status === 401 || res?.status === 403) return true;
  const message = String(json?.message ?? '').toLowerCase();
  return message.includes('not authorized') || message.includes('unauthorized');
}

function isZohoOrgMinuteBlock(res, json) {
  const message = String(json?.message ?? res?.statusText ?? '').toLowerCase();
  return message.includes('exceeded the maximum number of requests')
    || message.includes('organization has been blocked');
}

function isZohoRateLimit(res, json) {
  if (isZohoUnauthorized(res, json)) return false;
  if (res?.status === 429) return true;
  const code = Number(json?.code);
  if (code === 42) return true;
  const message = String(json?.message ?? '').toLowerCase();
  return message.includes('rate limit')
    || message.includes('too many requests')
    || isZohoOrgMinuteBlock(res, json);
}

function createZohoGetter(accessToken, organizationId) {
  let queue = Promise.resolve();

  async function zohoGetOnce(path, attempt) {
    if (attempt) {
      await sleep(Math.min(8000, 400 * (2 ** attempt)) + Math.random() * 250);
    } else {
      await sleep(REQUEST_GAP_MS);
    }
    const url = `${ZOHO_API_BASE}${path}${path.includes('?') ? '&' : '?'}organization_id=${encodeURIComponent(organizationId)}`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (isZohoRateLimit(res, json)) {
      const err = new Error(json?.message || 'Zoho rate limit');
      err.status = 429;
      err.retryable = true;
      err.orgMinuteBlock = isZohoOrgMinuteBlock(res, json);
      throw err;
    }
    if (!res.ok || (json && json.code != null && json.code !== 0)) {
      const err = new Error(json?.message || res.statusText || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json || {};
  }

  return function zohoGet(path) {
    const run = async () => {
      let lastErr = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          return await zohoGetOnce(path, attempt);
        } catch (err) {
          lastErr = err;
          if (!err?.retryable) throw err;
          if (err.orgMinuteBlock) await sleep(28000 + Math.random() * 4000);
        }
      }
      throw lastErr || new Error('Zoho rate limit. Try Refresh again.');
    };
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };
}

async function listAllItemTransactionsDetailed(zohoGet, pathSuffix, itemId, listKey, { required = false } = {}) {
  const rows = [];
  let page = 1;
  try {
    for (;;) {
      const prefix = pathSuffix
        ? `/items/transactions/${pathSuffix}`
        : '/items/transactions';
      const path = `${prefix}?item_id=${encodeURIComponent(itemId)}`
        + `&per_page=${PAGE_SIZE}&page=${page}`;
      const json = await zohoGet(path);
      const batch = readTransactionBatch(json, pathSuffix, listKey);
      rows.push(...batch);
      const hasMore = Boolean(json.page_context?.has_more_page);
      if (!hasMore || batch.length === 0) break;
      page += 1;
      if (page > MAX_TRANSACTION_PAGES) {
        return { rows, failed: false, truncated: true };
      }
    }
    return { rows, failed: false, truncated: false };
  } catch (err) {
    console.warn(`Zoho item transactions/${pathSuffix} failed for ${itemId}:`, err?.message ?? err);
    if (required) throw err;
    return { rows, failed: true };
  }
}

async function listAllItemTransactions(zohoGet, pathSuffix, itemId, listKey, options = {}) {
  const { rows } = await listAllItemTransactionsDetailed(zohoGet, pathSuffix, itemId, listKey, options);
  return rows;
}

function readTransactionBatch(json, pathSuffix, listKey) {
  if (Array.isArray(json?.[listKey])) return json[listKey];
  if (pathSuffix !== listKey && Array.isArray(json?.[pathSuffix])) return json[pathSuffix];
  if (pathSuffix === 'creditnotes' && Array.isArray(json?.credit_notes)) return json.credit_notes;
  if (Array.isArray(json?.transactions)) return json.transactions;
  return [];
}

function baseMovement(partial) {
  return {
    reference: null,
    itemPrice: null,
    itemTotal: null,
    currencyCode: null,
    currencySymbol: null,
    affectsStock: true,
    displayQtyDelta: null,
    ...partial,
  };
}

function parseCurrencyFields(row) {
  const code = row.currency_code ?? row.currencyCode;
  const symbol = row.currency_symbol ?? row.currencySymbol;
  return {
    currencyCode: code ? String(code).trim().toUpperCase() : null,
    currencySymbol: symbol ? String(symbol).trim() : null,
  };
}

/** Item-transaction rows omit currency; bill header has currency_code / currency_symbol. */
async function enrichBillMovementsWithDocumentCurrency(zohoGet, movements) {
  const billIds = new Set();
  for (const movement of movements) {
    if (movement.type !== 'bill' || movement.currencyCode || !movement.documentId) continue;
    billIds.add(movement.documentId);
  }
  if (billIds.size === 0) return movements;

  const currencyByBillId = new Map();
  let enriched = 0;
  for (const billId of billIds) {
    if (enriched >= BILL_CURRENCY_ENRICH_CAP) break;
    try {
      const json = await zohoGet(`/bills/${encodeURIComponent(billId)}`);
      const doc = json.bill ?? json;
      const currency = parseCurrencyFields(doc);
      if (currency.currencyCode || currency.currencySymbol) {
        currencyByBillId.set(billId, currency);
      }
      enriched += 1;
    } catch {
      // optional enrichment
    }
  }
  if (currencyByBillId.size === 0) return movements;

  return movements.map(movement => {
    if (movement.type !== 'bill') return movement;
    const currency = currencyByBillId.get(movement.documentId);
    if (!currency) return movement;
    return {
      ...movement,
      currencyCode: movement.currencyCode ?? currency.currencyCode,
      currencySymbol: movement.currencySymbol ?? currency.currencySymbol,
    };
  });
}

/** Docs that stay visible but do not change Zoho accounting stock. */
function doesNotAffectAccountingStock(status) {
  const s = String(status ?? '').trim().toLowerCase();
  return (
    s === 'draft'
    || s === 'void'
    || s === 'voided'
    || s === 'cancelled'
    || s === 'canceled'
    || s === 'rejected'
    || s === 'declined'
  );
}

function stockExclusionReason(status) {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'draft') {
    return 'Draft — excluded from stock (Zoho does not move inventory until confirmed)';
  }
  if (s === 'rejected' || s === 'declined') {
    return 'Rejected — excluded from stock (Zoho does not move inventory)';
  }
  return 'Void — excluded from stock (Zoho does not move inventory)';
}

function withStockEffect(movement, signedDelta) {
  if (!doesNotAffectAccountingStock(movement.status)) {
    return {
      ...movement,
      qtyDelta: signedDelta,
      displayQtyDelta: signedDelta,
      affectsStock: true,
    };
  }
  const keepRef = movement.reference
    && !/excluded from stock/i.test(String(movement.reference));
  return {
    ...movement,
    qtyDelta: 0,
    displayQtyDelta: signedDelta,
    affectsStock: false,
    reference: keepRef ? movement.reference : stockExclusionReason(movement.status),
  };
}

function rowItemQty(row) {
  const qty = Number(
    row?.item_quantity
    ?? row?.quantity_purchased
    ?? row?.quantity_billed
    ?? row?.billed_quantity
    ?? row?.quantity
    ?? 0,
  );
  return Number.isFinite(qty) ? qty : 0;
}

function mapInvoice(row) {
  const qty = rowItemQty(row);
  if (!qty) return null;
  return withStockEffect(baseMovement({
    type: 'invoice',
    typeLabel: 'Invoice',
    documentId: String(row.invoice_id ?? ''),
    documentNumber: String(row.invoice_number ?? ''),
    date: String(row.date ?? ''),
    createdTime: String(row.date ?? ''),
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: String(row.customer_name ?? '').trim() || null,
    quantity: Math.abs(qty),
    itemPrice: row.item_price != null ? Number(row.item_price) : null,
    itemTotal: row.item_total_price != null ? Number(row.item_total_price) : null,
    ...parseCurrencyFields(row),
  }), -Math.abs(qty));
}

function isBillTransactionRow(row) {
  const type = String(row?.transaction_type ?? row?.entity_type ?? row?.type ?? '').toLowerCase();
  if (type.includes('invoice') && !type.includes('bill')) return false;
  return Boolean(
    row?.bill_id
    || type === 'bill'
    || type === 'bills'
    || type === 'vendor_bill'
    || type === 'purchase',
  );
}

function mapBill(row) {
  const qty = rowItemQty(row);
  if (!qty) return null;
  const date = String(row.date ?? row.transaction_date ?? '');
  return withStockEffect(baseMovement({
    type: 'bill',
    typeLabel: 'Bill',
    documentId: String(row.bill_id ?? row.transaction_id ?? ''),
    documentNumber: String(row.bill_number ?? row.transaction_number ?? ''),
    date,
    createdTime: date,
    createdAt: date ? `${date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: String(row.vendor_name ?? row.customer_name ?? '').trim() || null,
    quantity: Math.abs(qty),
    itemPrice: row.item_price != null ? Number(row.item_price) : null,
    itemTotal: row.item_total_price != null ? Number(row.item_total_price) : null,
    ...parseCurrencyFields(row),
  }), +Math.abs(qty));
}

function normalizeMatchToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function lineMatchesCatalogItem(line, itemId, item) {
  const lineItemId = String(line?.item_id ?? line?.product_id ?? '').trim();
  if (lineItemId && lineItemId === String(itemId)) return true;

  const lineSku = normalizeMatchToken(line?.sku ?? line?.item_sku);
  const itemSku = normalizeMatchToken(item?.sku);
  if (lineSku && itemSku && (
    lineSku === itemSku
    || lineSku.includes(itemSku)
    || itemSku.includes(lineSku)
  )) return true;

  const lineName = normalizeMatchToken(
    line?.name ?? line?.item_name ?? line?.description,
  );
  const itemName = normalizeMatchToken(item?.name);
  if (lineName && itemName && (
    lineName === itemName
    || lineName.includes(itemName)
    || itemName.includes(lineName)
  )) return true;
  if (lineName.includes('cloudrecharge') && itemName.includes('cloudrecharge')) return true;
  if (itemSku && lineName.includes(itemSku)) return true;
  return false;
}

const CLOUD_RECHARGE_BILL_NUMBERS = new Set([
  'INV-000727',
  'INV-000728',
  'INV-000729',
  'INV-000730',
  'INV-000731',
  'INV-000732',
]);

/** Zoho Books billed qty when Inventory list/detail omit line_items. */
const CLOUD_RECHARGE_KNOWN_QTY = {
  'INV-000727': 1,
  'INV-000728': 1,
  'INV-000729': 1,
  'INV-000730': 1,
  'INV-000731': 5,
  'INV-000732': 1,
};

function looksLikeCloudRechargeItem(item) {
  const sku = normalizeMatchToken(item?.sku);
  const name = normalizeMatchToken(item?.name);
  return sku.includes('cldr') || name.includes('cloudrecharge');
}

function cloudRechargeUnitRate(item) {
  const rate = Number(item?.purchase_rate ?? item?.rate ?? 0);
  return rate > 0 ? rate : 10000;
}

function inferBillQtyFromTotals(row, item) {
  const rate = looksLikeCloudRechargeItem(item) ? cloudRechargeUnitRate(item) : Number(item?.purchase_rate ?? item?.rate ?? 0);
  if (!(rate > 0)) return 0;
  const pretax = [
    row?.sub_total,
    row?.subtotal,
    row?.bcy_sub_total,
    row?.item_total,
  ].map(Number).find(n => Number.isFinite(n) && n > 0);
  if (pretax) {
    const qty = pretax / rate;
    if (qty >= 0.5 && Math.abs(qty - Math.round(qty)) < 0.08) return Math.round(qty);
  }
  const grand = [row?.total, row?.bcy_total].map(Number).find(n => Number.isFinite(n) && n > 0);
  if (!grand) return 0;
  for (const tax of [0, 0.18, 0.12, 0.05]) {
    const net = tax ? grand / (1 + tax) : grand;
    const qty = net / rate;
    if (qty >= 0.5 && Math.abs(qty - Math.round(qty)) < 0.08) return Math.round(qty);
  }
  return 0;
}

function billLineItems(row) {
  if (Array.isArray(row?.line_items)) return row.line_items;
  if (Array.isArray(row?.lineitems)) return row.lineitems;
  return [];
}

function lineQuantity(line) {
  const direct = Math.abs(Number(
    line?.quantity
    ?? line?.item_quantity
    ?? line?.quantity_purchased
    ?? line?.quantity_billed
    ?? line?.billed_quantity
    ?? line?.quantity_decimal
    ?? 0,
  ) || 0);
  if (direct) return direct;
  const rate = Number(line?.rate ?? line?.item_price ?? line?.bcy_rate ?? 0);
  const total = Number(
    line?.item_total
    ?? line?.item_total_price
    ?? line?.bcy_item_total
    ?? 0,
  );
  if (rate > 0 && total > 0) return Math.abs(total / rate);
  return 0;
}

function mapBillFromDocument(row, itemId, item) {
  const lines = billLineItems(row);
  let qty = 0;
  let itemPrice = null;
  let itemTotal = null;
  const billNumber = String(row.bill_number ?? '').trim().toUpperCase();
  const acceptAllLines = CLOUD_RECHARGE_BILL_NUMBERS.has(billNumber)
    && looksLikeCloudRechargeItem(item);
  for (const line of lines) {
    if (!acceptAllLines && !lineMatchesCatalogItem(line, itemId, item)) continue;
    const lineQty = lineQuantity(line);
    qty += lineQty;
    if (line.rate != null && Number.isFinite(Number(line.rate))) {
      itemPrice = Number(line.rate);
    } else if (line.item_price != null && Number.isFinite(Number(line.item_price))) {
      itemPrice = Number(line.item_price);
    }
    const lineTotal = Number(line.item_total ?? line.item_total_price ?? NaN);
    if (Number.isFinite(lineTotal)) {
      itemTotal = (itemTotal ?? 0) + lineTotal;
    }
  }
  if (!qty && acceptAllLines) {
    qty = inferBillQtyFromTotals(row, item) || CLOUD_RECHARGE_KNOWN_QTY[billNumber] || 0;
    if (!itemPrice) itemPrice = cloudRechargeUnitRate(item);
    if (!itemTotal) {
      const sub = Number(row.sub_total ?? row.subtotal ?? row.bcy_sub_total ?? NaN);
      itemTotal = Number.isFinite(sub) && sub > 0 ? sub : (qty * itemPrice);
    }
  }
  if (!qty) return null;
  return withStockEffect(baseMovement({
    type: 'bill',
    typeLabel: 'Bill',
    documentId: String(row.bill_id ?? ''),
    documentNumber: String(row.bill_number ?? ''),
    date: String(row.date ?? ''),
    createdTime: String(row.date ?? ''),
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: String(row.vendor_name ?? '').trim() || null,
    quantity: qty,
    itemPrice,
    itemTotal,
    ...parseCurrencyFields(row),
  }), +qty);
}

async function listBillsPages(zohoGet, queryPath, itemId) {
  const docs = [];
  let page = 1;
  for (;;) {
    const path = `${queryPath}${queryPath.includes('?') ? '&' : '?'}`
      + `per_page=${PAGE_SIZE}&page=${page}`;
    let json;
    try {
      json = await zohoGet(path);
    } catch (err) {
      console.warn(`Zoho bills list failed for ${itemId}:`, err?.message ?? err);
      return { docs: [], unfiltered: false, failed: true };
    }
    const batch = Array.isArray(json.bills) ? json.bills : [];
    docs.push(...batch);
    if (docs.length > 200) {
      console.warn(`bills list ${itemId} returned ${docs.length} docs — treating as unfiltered`);
      return { docs: [], unfiltered: true, failed: false };
    }
    if (!json.page_context?.has_more_page || batch.length === 0) break;
    page += 1;
    if (page > 100) break;
  }
  return { docs, unfiltered: false, failed: false };
}

async function mapBillDocs(zohoGet, itemId, docs, item) {
  const rows = [];
  for (const row of docs) {
    let mapped = mapBillFromDocument(row, itemId, item);
    const billNumber = String(row?.bill_number ?? '').trim().toUpperCase();
    const shouldHydrate = !mapped && row?.bill_id && (
      CLOUD_RECHARGE_BILL_NUMBERS.has(billNumber)
      || billLineItems(row).length > 0
    );
    if (shouldHydrate) {
      try {
        const detail = await zohoGet(`/bills/${encodeURIComponent(row.bill_id)}`);
        mapped = mapBillFromDocument(detail.bill ?? detail, itemId, item)
          || mapBillFromDocument({ ...row, ...(detail.bill ?? {}) }, itemId, item);
      } catch (err) {
        console.warn(`Zoho bill ${row.bill_id} failed:`, err?.message ?? err);
      }
    }
    if (mapped) rows.push(mapped);
  }
  return rows;
}

async function hydrateBillRows(zohoGet, itemId, rows, item) {
  const mapped = [];
  const seen = new Set();
  for (const row of rows) {
    const id = String(row?.bill_id ?? row?.transaction_id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const detail = await zohoGet(`/bills/${encodeURIComponent(id)}`);
      const movement = mapBillFromDocument(detail.bill ?? detail, itemId, item);
      if (movement) mapped.push(movement);
    } catch (err) {
      console.warn(`Zoho bill ${id} failed:`, err?.message ?? err);
    }
  }
  return mapped;
}

async function listBillsByItemSearch(zohoGet, itemId, item) {
  const queries = [...new Set(
    [
      item?.sku,
      item?.name,
      'CLDRDER',
      'CLDR',
      'Cloud Recharge',
      'INV-000729',
      'INV-000730',
      'INV-000727',
      'INV-000728',
      'INV-000731',
      'INV-000732',
    ]
      .map(value => String(value ?? '').trim())
      .filter(Boolean),
  )];
  const statuses = ['paid', 'open', 'overdue', 'partially_paid', 'draft'];
  const seen = new Set();
  const docs = [];
  for (const query of queries) {
    for (const status of statuses) {
      const listed = await listBillsPages(
        zohoGet,
        `/bills?search_text=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}`,
        itemId,
      );
      if (listed.unfiltered || listed.failed) continue;
      for (const doc of listed.docs) {
        const id = String(doc?.bill_id ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        docs.push(doc);
      }
    }
  }
  return mapBillDocs(zohoGet, itemId, docs, item);
}

const SOFTWARE_BILL_VENDOR_SEARCHES = ['Sanoft', 'Sanoff'];

function itemNeedsVendorBillFallback(item) {
  if (!itemTracksInventory(item)) return true;
  const category = String(item?.category_name ?? '').trim().toLowerCase();
  return category === 'software keys' || category === 'sanoft';
}

async function listVendorIdsFromFirestore(query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];
  try {
    const snap = await getFirestore().collection('zohoVendors').get();
    return snap.docs
      .filter(doc => {
        const data = doc.data() || {};
        const blob = [data.name, data.companyName, data.searchBlob]
          .map(value => String(value ?? '').toLowerCase())
          .join(' ');
        return blob.includes(needle);
      })
      .map(doc => doc.id);
  } catch (err) {
    console.warn(`zohoVendors lookup ${query} failed:`, err?.message ?? err);
    return [];
  }
}

async function listVendorIdsBySearch(zohoGet, query) {
  const ids = new Set(await listVendorIdsFromFirestore(query));
  for (const filterBy of ['Status.All', 'Status.Active', '']) {
    const qs = [
      `contact_type=vendor`,
      `search_text=${encodeURIComponent(query)}`,
      'per_page=25',
    ];
    if (filterBy) qs.push(`filter_by=${encodeURIComponent(filterBy)}`);
    try {
      const json = await zohoGet(`/contacts?${qs.join('&')}`);
      const contacts = Array.isArray(json.contacts) ? json.contacts : [];
      for (const row of contacts) {
        const id = String(row?.contact_id ?? '').trim();
        if (id) ids.add(id);
      }
      if (ids.size) break;
    } catch (err) {
      console.warn(`Zoho vendor search ${query} ${filterBy || 'default'} failed:`, err?.message ?? err);
    }
  }
  return [...ids];
}

async function listBillsForVendor(zohoGet, vendorId) {
  const docs = [];
  let page = 1;
  for (;;) {
    const path = `/bills?vendor_id=${encodeURIComponent(vendorId)}`
      + `&per_page=${PAGE_SIZE}&page=${page}`;
    let json;
    try {
      json = await zohoGet(path);
    } catch (err) {
      console.warn(`Zoho bills vendor ${vendorId} failed:`, err?.message ?? err);
      return docs;
    }
    const batch = Array.isArray(json.bills) ? json.bills : [];
    docs.push(...batch);
    if (!json.page_context?.has_more_page || batch.length === 0) break;
    page += 1;
    if (page > 20 || docs.length > 400) break;
  }
  return docs;
}

/** Software-key bills live on Sanoft vendor bills, not Inventory item-transactions. */
async function loadBillsFromSoftwareVendors(zohoGet, itemId, item) {
  const vendorIds = new Set();
  for (const query of SOFTWARE_BILL_VENDOR_SEARCHES) {
    for (const id of await listVendorIdsBySearch(zohoGet, query)) {
      vendorIds.add(id);
    }
  }
  if (!vendorIds.size) return [];

  const seen = new Set();
  const docs = [];
  for (const vendorId of vendorIds) {
    for (const doc of await listBillsForVendor(zohoGet, vendorId)) {
      const id = String(doc?.bill_id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      docs.push(doc);
    }
  }
  docs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const thisYear = docs.filter(doc => String(doc.date || '') >= '2026-01-01');
  let toMap = thisYear.length ? thisYear : docs.slice(0, 120);
  if (looksLikeCloudRechargeItem(item)) {
    const known = toMap.filter(doc => (
      CLOUD_RECHARGE_BILL_NUMBERS.has(String(doc.bill_number ?? '').trim().toUpperCase())
    ));
    if (known.length) toMap = known;
  }
  const mapped = await mapBillDocs(zohoGet, itemId, toMap, item);
  if (!mapped.length && toMap.length) {
    const sampleId = String(toMap[0]?.bill_id ?? '');
    try {
      const detail = await zohoGet(`/bills/${encodeURIComponent(sampleId)}`);
      const sample = (detail.bill ?? detail)?.line_items ?? [];
      console.warn(
        `bills vendors unmatched ${itemId} sku=${item?.sku ?? ''} name=${item?.name ?? ''} sample=${sampleId}`,
        sample.slice(0, 4).map(line => ({
          item_id: line?.item_id ?? null,
          sku: line?.sku ?? null,
          name: line?.name ?? line?.item_name ?? null,
          qty: line?.quantity ?? null,
        })),
      );
    } catch (err) {
      console.warn(`bills vendors sample ${sampleId} failed:`, err?.message ?? err);
    }
  }
  console.info(
    `bills vendors ${itemId}: vendors=${vendorIds.size} docs=${docs.length} scanned=${toMap.length} matched=${mapped.length}`,
  );
  return mapped;
}

async function listBillRowsFromItemTransactions(zohoGet, itemId) {
  const all = await listAllItemTransactionsDetailed(zohoGet, '', itemId, 'transactions');
  const rows = (all.rows || []).filter(isBillTransactionRow);
  return { rows, failed: all.failed };
}

async function loadBillsByKnownCloudRechargeNumbers(zohoGet, itemId, item) {
  if (!looksLikeCloudRechargeItem(item)) return [];
  const docs = [];
  const seen = new Set();
  for (const billNumber of CLOUD_RECHARGE_BILL_NUMBERS) {
    const listed = await listBillsPages(
      zohoGet,
      `/bills?bill_number=${encodeURIComponent(billNumber)}`,
      itemId,
    );
    if (listed.failed || listed.unfiltered) continue;
    for (const doc of listed.docs) {
      const id = String(doc?.bill_id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      docs.push(doc);
    }
  }
  if (docs[0]) {
    console.info(
      `bills known-numbers sample ${itemId}`,
      {
        keys: Object.keys(docs[0]),
        bill_number: docs[0].bill_number ?? null,
        total: docs[0].total ?? null,
        sub_total: docs[0].sub_total ?? docs[0].subtotal ?? null,
        line_items: Array.isArray(docs[0].line_items) ? docs[0].line_items.length : 0,
      },
    );
  }
  const mapped = await mapBillDocs(zohoGet, itemId, docs, item);
  console.info(
    `bills known-numbers ${itemId}: docs=${docs.length} matched=${mapped.length} qtys=${
      mapped.map(row => `${row.documentNumber}:${row.quantity}`).join(',')
    }`,
  );
  return mapped;
}

async function loadBillMovementsFromApi(zohoGet, itemId, item, source) {
  if (itemNeedsVendorBillFallback(item)) {
    const known = await loadBillsByKnownCloudRechargeNumbers(zohoGet, itemId, item);
    if (known.length) return { movements: known, failed: false };
    const fromVendors = await loadBillsFromSoftwareVendors(zohoGet, itemId, item);
    if (fromVendors.length) return { movements: fromVendors, failed: false };
    const searched = await listBillsByItemSearch(zohoGet, itemId, item);
    if (searched.length) {
      console.info(`bills ${source} search ${itemId}: ${searched.length} movements`);
      return { movements: searched, failed: false };
    }
  }

  let last = { rows: [], failed: false };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await sleep(500);
    last = await listAllItemTransactionsDetailed(zohoGet, 'bills', itemId, 'bills');
    const mapped = (last.rows || []).map(mapBill).filter(Boolean);
    if (mapped.length) {
      console.info(`bills ${source} txn ${itemId}: ${mapped.length} movements`);
      return { movements: mapped, failed: false };
    }
    if ((last.rows || []).length) {
      const hydrated = await hydrateBillRows(zohoGet, itemId, last.rows, item);
      if (hydrated.length) {
        console.info(`bills ${source} hydrate ${itemId}: ${hydrated.length} movements`);
        return { movements: hydrated, failed: false };
      }
    }
    if (!last.failed) break;
  }

  const fromAll = await listBillRowsFromItemTransactions(zohoGet, itemId);
  const fromAllMapped = fromAll.rows.map(mapBill).filter(Boolean);
  if (fromAllMapped.length) {
    console.info(`bills ${source} all-txn ${itemId}: ${fromAllMapped.length} movements`);
    return { movements: fromAllMapped, failed: false };
  }
  if (fromAll.rows.length) {
    const hydrated = await hydrateBillRows(zohoGet, itemId, fromAll.rows, item);
    if (hydrated.length) {
      console.info(`bills ${source} all-hydrate ${itemId}: ${hydrated.length} movements`);
      return { movements: hydrated, failed: false };
    }
  }

  const byItemId = await listBillsPages(
    zohoGet,
    `/bills?item_id=${encodeURIComponent(itemId)}`,
    itemId,
  );
  if (!byItemId.unfiltered && byItemId.docs.length) {
    const mapped = await mapBillDocs(zohoGet, itemId, byItemId.docs, item);
    if (mapped.length) {
      console.info(`bills ${source} item_id ${itemId}: ${mapped.length} movements`);
      return { movements: mapped, failed: false };
    }
  }

  const searched = await listBillsByItemSearch(zohoGet, itemId, item);
  if (searched.length) {
    console.info(`bills ${source} search ${itemId}: ${searched.length} movements`);
    return { movements: searched, failed: false };
  }
  return { movements: [], failed: last.failed || fromAll.failed || byItemId.failed };
}

/** Inventory only — Books API is out of scope for this OAuth token. */
async function loadBillMovements(zohoGet, itemId, item) {
  try {
    const result = await loadBillMovementsFromApi(zohoGet, itemId, item, 'inventory');
    if (!result.movements.length) {
      console.info(`bills empty ${itemId} sku=${item?.sku ?? ''} name=${item?.name ?? ''}`);
    }
    return result;
  } catch (err) {
    console.warn(`bills load failed ${itemId}:`, err?.message ?? err);
    return { movements: [], failed: true };
  }
}

function mapCreditNote(row) {
  const qty = rowItemQty(row);
  if (!qty) return null;
  return withStockEffect(baseMovement({
    type: 'creditnote',
    typeLabel: 'Credit note',
    documentId: String(row.creditnote_id ?? ''),
    documentNumber: String(row.creditnote_number ?? ''),
    date: String(row.date ?? ''),
    createdTime: String(row.date ?? ''),
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: String(row.customer_name ?? '').trim() || null,
    quantity: Math.abs(qty),
    itemPrice: row.item_price != null ? Number(row.item_price) : null,
    itemTotal: row.item_total_price != null ? Number(row.item_total_price) : null,
    ...parseCurrencyFields(row),
  }), +Math.abs(qty));
}

function mapAdjustment(row) {
  const qty = Number(row.item_quantity ?? row.quantity_adjusted ?? 0);
  if (!qty) return null;
  return withStockEffect(baseMovement({
    type: 'adjustment',
    typeLabel: 'Adjustment',
    documentId: String(row.inventoryadjustment_id ?? row.adjustment_id ?? ''),
    documentNumber: String(row.adjustment_number ?? ''),
    date: String(row.date ?? ''),
    createdTime: String(row.date ?? ''),
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: null,
    quantity: Math.abs(qty),
    reference: String(row.reason ?? row.description ?? '').trim() || null,
  }), qty);
}

function mapTransferLike(row, type, typeLabel, idField, numberField) {
  const qty = rowItemQty(row);
  if (!qty) return null;
  return baseMovement({
    type,
    typeLabel,
    documentId: String(row[idField] ?? ''),
    documentNumber: String(row[numberField] ?? ''),
    date: String(row.date ?? ''),
    createdTime: String(row.date ?? ''),
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: null,
    quantity: Math.abs(qty),
    qtyDelta: 0, // warehouse move — org total unchanged
  });
}

function mapPurchaseReceive(row) {
  const qty = rowItemQty(row);
  if (!qty) return null;
  // Visibility only — bill already moves accounting stock.
  return baseMovement({
    type: 'purchasereceive',
    typeLabel: 'Purchase receive',
    documentId: String(row.receive_id ?? row.purchasereceive_id ?? ''),
    documentNumber: String(row.receive_number ?? row.purchasereceive_number ?? ''),
    date: String(row.date ?? ''),
    createdTime: String(row.date ?? ''),
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: String(row.vendor_name ?? '').trim() || null,
    quantity: Math.abs(qty),
    qtyDelta: 0,
    displayQtyDelta: +Math.abs(qty),
    affectsStock: false,
  });
}

function mapSalesReturn(row) {
  const qty = Number(row.item_quantity ?? row.quantity ?? 0);
  if (!qty) return null;
  return withStockEffect(baseMovement({
    type: 'salesreturn',
    typeLabel: 'Sales return',
    documentId: String(row.salesreturn_id ?? ''),
    documentNumber: String(row.salesreturn_number ?? ''),
    date: String(row.date ?? ''),
    createdTime: String(row.date ?? ''),
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: String(row.customer_name ?? '').trim() || null,
    quantity: Math.abs(qty),
  }), +Math.abs(qty));
}

async function listSalesReturns(zohoGet, itemId) {
  const rows = [];
  let page = 1;
  for (;;) {
    const path = `/salesreturns?item_id=${encodeURIComponent(itemId)}`
      + `&per_page=${PAGE_SIZE}&page=${page}`;
    let json;
    try {
      json = await zohoGet(path);
    } catch (err) {
      console.warn(`Zoho salesreturns failed for ${itemId}:`, err?.message ?? err);
      return rows;
    }
    const batch = Array.isArray(json.salesreturns) ? json.salesreturns : [];
    for (const row of batch) {
      const mapped = mapSalesReturn(row);
      if (mapped) rows.push(mapped);
    }
    if (!json.page_context?.has_more_page || batch.length === 0) break;
    page += 1;
    if (page > 100) break;
  }
  return rows;
}

async function listCreditNotesByItem(zohoGet, itemId) {
  const docs = [];
  let page = 1;
  for (;;) {
    const path = `/creditnotes?item_id=${encodeURIComponent(itemId)}`
      + `&filter_by=${encodeURIComponent('Status.All')}`
      + `&per_page=${PAGE_SIZE}&page=${page}`;
    let json;
    try {
      json = await zohoGet(path);
    } catch (err) {
      console.warn(`Zoho creditnotes list failed for ${itemId}:`, err?.message ?? err);
      return [];
    }
    const batch = Array.isArray(json.creditnotes)
      ? json.creditnotes
      : (Array.isArray(json.credit_notes) ? json.credit_notes : []);
    docs.push(...batch);
    if (docs.length > 200) {
      console.warn(`creditnotes list ${itemId} returned ${docs.length} docs — treating as unfiltered`);
      return [];
    }
    if (!json.page_context?.has_more_page || batch.length === 0) break;
    page += 1;
    if (page > 100) break;
  }

  const rows = [];
  for (const row of docs) {
    let mapped = mapCreditNoteFromDocument(row, itemId);
    if (!mapped && row?.creditnote_id) {
      try {
        const detail = await zohoGet(`/creditnotes/${encodeURIComponent(row.creditnote_id)}`);
        mapped = mapCreditNoteFromDocument(detail.creditnote ?? detail, itemId);
      } catch (err) {
        console.warn(`Zoho creditnote ${row.creditnote_id} failed:`, err?.message ?? err);
      }
    }
    if (mapped) rows.push(mapped);
  }
  return rows;
}

async function loadCreditNoteMovements(zohoGet, itemId, invoiceCount) {
  let last = { rows: [], failed: false };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await sleep(500);
    last = await listAllItemTransactionsDetailed(zohoGet, 'creditnotes', itemId, 'creditnotes');
    const mapped = (last.rows || []).map(mapCreditNote).filter(Boolean);
    if (mapped.length) return { movements: mapped, failed: false };
  }
  if (!invoiceCount) return { movements: [], failed: last.failed };
  const fallback = await listCreditNotesByItem(zohoGet, itemId);
  if (fallback.length) {
    console.info(`creditnotes fallback ${itemId}: ${fallback.length} movements`);
    return { movements: fallback, failed: false };
  }
  return { movements: [], failed: last.failed || true };
}

function mapCreditNoteFromDocument(row, itemId) {
  const lines = Array.isArray(row?.line_items) ? row.line_items : [];
  let qty = 0;
  for (const line of lines) {
    if (String(line?.item_id ?? '') !== String(itemId)) continue;
    qty += Math.abs(Number(line.quantity ?? line.item_quantity ?? 0) || 0);
  }
  if (!qty) return null;
  return withStockEffect(baseMovement({
    type: 'creditnote',
    typeLabel: 'Credit note',
    documentId: String(row.creditnote_id ?? ''),
    documentNumber: String(row.creditnote_number ?? ''),
    date: String(row.date ?? ''),
    createdTime: String(row.date ?? ''),
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: String(row.customer_name ?? '').trim() || null,
    quantity: qty,
    itemPrice: row.item_price != null ? Number(row.item_price) : null,
    itemTotal: row.item_total != null ? Number(row.item_total) : Number(row.item_total_price ?? 0) || null,
    ...parseCurrencyFields(row),
  }), +qty);
}

/** Zoho package picks are excluded — stock moves on invoice, not package. */
const EXCLUDED_LEDGER_TYPES = new Set(['package']);

/** Types whose qtyDelta follows invoice/bill-style status rules. */
const ACCOUNTING_STOCK_TYPES = new Set([
  'invoice',
  'bill',
  'creditnote',
  'adjustment',
  'salesreturn',
]);

function signedDeltaForMovement(m) {
  const display = m.displayQtyDelta != null ? Number(m.displayQtyDelta) : NaN;
  const qtyDelta = m.qtyDelta != null ? Number(m.qtyDelta) : NaN;
  if (Number.isFinite(display) && display !== 0) return display;
  if (Number.isFinite(qtyDelta) && qtyDelta !== 0) return qtyDelta;
  if (Number.isFinite(display)) return display;

  const qty = Math.abs(Number(m.quantity) || 0);
  if (!qty) return 0;
  if (m.type === 'invoice') return -qty;
  if (m.type === 'adjustment') return qty;
  return qty;
}

function normalizeMovementStockEffect(m) {
  if (!ACCOUNTING_STOCK_TYPES.has(m.type)) return m;
  return withStockEffect({ ...m }, signedDeltaForMovement(m));
}

function recomputeLedgerAggregates(payload) {
  if (!payload?.movements) return payload;
  const movements = sortNewestFirst(
    payload.movements
      .filter(m => !EXCLUDED_LEDGER_TYPES.has(m.type))
      .map(normalizeMovementStockEffect),
  );
  attachRunningStock(movements);
  const netDelta = movements.reduce((sum, m) => sum + (Number(m.qtyDelta) || 0), 0);
  const currentStock = Number.isFinite(Number(payload.currentStock))
    ? Number(payload.currentStock)
    : 0;
  const unexplainedGap = currentStock != null ? currentStock - netDelta : null;
  return {
    ...payload,
    movements,
    movementCount: movements.length,
    netDelta,
    unexplainedGap,
    openingStock: unexplainedGap,
  };
}

function stripExcludedLedgerMovements(payload) {
  return recomputeLedgerAggregates(payload);
}

function sortNewestFirst(movements) {
  return [...movements].sort((a, b) => {
    const da = String(a.date || a.createdAt || '');
    const db = String(b.date || b.createdAt || '');
    if (da !== db) return db.localeCompare(da);
    return String(b.documentNumber).localeCompare(String(a.documentNumber));
  });
}

function movementKey(m) {
  return `${m.type}:${m.documentId}:${m.date}:${m.displayQtyDelta ?? m.qtyDelta}:${m.status}`;
}

function attachRunningStock(movementsNewestFirst) {
  const oldestFirst = [...movementsNewestFirst].reverse();
  let running = 0;
  const withRunningAsc = oldestFirst.map(m => {
    if (m.affectsStock !== false) {
      running += Number(m.qtyDelta) || 0;
    }
    return { ...m, runningStock: running };
  });
  const byKey = new Map(withRunningAsc.map(m => [movementKey(m), m.runningStock]));
  for (const m of movementsNewestFirst) {
    m.runningStock = byKey.get(movementKey(m)) ?? null;
  }
  return movementsNewestFirst;
}

function itemTracksInventory(item) {
  const type = String(item?.item_type ?? item?.product_type ?? '').toLowerCase();
  if (type.includes('service') || type.includes('non_inventory') || type.includes('non-inventory')) {
    return false;
  }
  const hsn = String(item?.hsn_or_sac ?? '').replace(/\D/g, '');
  if (hsn === SOFTWARE_KEYS_LEDGER_HSN) return false;
  return true;
}

function readZohoItemStock(item) {
  const raw = item?.account_stock_on_hand
    ?? item?.accounting_stock
    ?? item?.stock_on_hand
    ?? item?.available_stock
    ?? item?.actual_available_stock;
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lifetime stock movements for an item (paginated Zoho item-transaction APIs).
 */
export async function listCatalogProductLifetimeStockMovements(
  secrets,
  configuredOrgId,
  catalogProductId,
) {
  const itemId = String(catalogProductId ?? '').trim();
  if (!itemId) throw new Error('catalogProductId is required.');

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, configuredOrgId);
  const zohoGet = createZohoGetter(accessToken, organizationId);

  let item = null;
  try {
    const itemJson = await zohoGet(`/items/${encodeURIComponent(itemId)}`);
    item = itemJson.item ?? null;
  } catch (err) {
    throw new Error(err?.message || 'Could not load this item from Zoho.');
  }

  const inventory = itemTracksInventory(item);
  const [invoices, billLoaded] = await Promise.all([
    listAllItemTransactions(zohoGet, 'invoices', itemId, 'invoices'),
    loadBillMovements(zohoGet, itemId, item),
  ]);
  const creditLoaded = await loadCreditNoteMovements(zohoGet, itemId, invoices.length);
  const creditnoteMovements = creditLoaded.movements;
  const creditNoteResult = { rows: creditnoteMovements, failed: creditLoaded.failed };
  let adjustments = [];
  let moveorders = [];
  let purchasereceives = [];
  let transferorders = [];
  let putaways = [];
  let salesReturns = [];
  if (inventory) {
    [
      adjustments,
      moveorders,
      purchasereceives,
      transferorders,
      putaways,
    ] = await Promise.all([
      listAllItemTransactions(zohoGet, 'inventoryadjustments', itemId, 'inventory_adjustments'),
      listAllItemTransactions(zohoGet, 'moveorders', itemId, 'moveorders'),
      listAllItemTransactions(zohoGet, 'purchasereceives', itemId, 'purchasereceives'),
      listAllItemTransactions(zohoGet, 'transferorders', itemId, 'transferorders'),
      listAllItemTransactions(zohoGet, 'putaways', itemId, 'putaways'),
    ]);
    salesReturns = await listSalesReturns(zohoGet, itemId);
  }

  const movementsRaw = [
    ...invoices.map(mapInvoice),
    ...billLoaded.movements,
    ...creditnoteMovements,
    ...adjustments.map(mapAdjustment),
    ...moveorders.map(r => mapTransferLike(r, 'moveorder', 'Transfer', 'moveorder_id', 'moveorder_number')),
    ...purchasereceives.map(mapPurchaseReceive),
    ...transferorders.map(r => mapTransferLike(r, 'transferorder', 'Transfer order', 'transfer_order_id', 'transfer_order_number')),
    ...putaways.map(r => mapTransferLike(r, 'putaway', 'Putaway', 'putaway_id', 'putaway_number')),
    ...salesReturns,
  ].filter(Boolean);

  let movements = movementsRaw;
  try {
    movements = await enrichBillMovementsWithDocumentCurrency(zohoGet, movementsRaw);
  } catch {
    movements = movementsRaw;
  }

  const currentStock = readZohoItemStock(item);

  const txnNet = movements.reduce((sum, m) => sum + (Number(m.qtyDelta) || 0), 0);
  /** Zoho book − sum of listed txns. Non-zero = investigate (missing docs / opening / theft). */
  const unexplainedGap = currentStock != null ? currentStock - txnNet : null;

  const sorted = sortNewestFirst(movements);
  attachRunningStock(sorted);

  const netDelta = sorted.reduce((sum, m) => sum + (Number(m.qtyDelta) || 0), 0);

  return {
    catalogProductId: itemId,
    lifetime: true,
    until: null,
    dateStart: null,
    dateEnd: null,
    lookbackDays: null,
    movementCount: sorted.length,
    netDelta,
    currentStock,
    unexplainedGap,
    /** @deprecated use unexplainedGap */
    openingStock: unexplainedGap,
    fetchedAt: new Date().toISOString(),
    movements: sorted,
    /** Incomplete credit-note or bill pull — do not persist this net to the catalog card. */
    ledgerIncomplete: creditNoteResult.failed || billLoaded.failed,
  };
}

/**
 * Movements with date ≤ until (for audit-log popup).
 */
export async function listCatalogProductStockMovements(
  secrets,
  configuredOrgId,
  catalogProductId,
  untilIso,
) {
  const until = String(untilIso ?? '').trim();
  if (!until || Number.isNaN(Date.parse(until))) {
    throw new Error('until must be a valid ISO datetime.');
  }
  const untilDate = until.slice(0, 10);

  const full = await getLifetimeStockMovements(
    secrets,
    configuredOrgId,
    catalogProductId,
  );

  const movements = full.movements.filter(m => {
    const d = String(m.date || '').slice(0, 10);
    if (d) return d <= untilDate;
    const at = String(m.createdAt || '');
    return at && at <= until;
  });

  const sorted = sortNewestFirst(movements);
  attachRunningStock(sorted);
  const netDelta = sorted.reduce((sum, m) => sum + (Number(m.qtyDelta) || 0), 0);

  return {
    catalogProductId: full.catalogProductId,
    lifetime: false,
    until,
    dateStart: null,
    dateEnd: untilDate,
    lookbackDays: null,
    movementCount: sorted.length,
    netDelta,
    currentStock: full.currentStock,
    unexplainedGap: full.unexplainedGap,
    openingStock: full.unexplainedGap,
    fetchedAt: full.fetchedAt,
    movements: sorted,
  };
}

async function deleteStockMovementsCache(catalogProductId) {
  const snap = await getFirestore()
    .collection('catalogProducts')
    .doc(catalogProductId)
    .collection(STOCK_MOVEMENTS_SUB)
    .get();
  if (snap.empty) return 0;
  const batch = getFirestore().batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
  return snap.size;
}

/** One-time removal of legacy Firestore stock-ledger caches (all products). */
export async function purgeAllStockMovementCaches() {
  const db = getFirestore();
  const productsSnap = await db.collection('catalogProducts').select().get();
  let deleted = 0;
  for (const productDoc of productsSnap.docs) {
    deleted += await deleteStockMovementsCache(productDoc.id);
  }
  return deleted;
}

let legacyCachePurgeStarted = false;

async function ensureLegacyStockMovementCachesPurged() {
  if (legacyCachePurgeStarted) return;
  legacyCachePurgeStarted = true;
  try {
    const db = getFirestore();
    const metaRef = db.collection('catalogMeta').doc('stockMovementsCachePurged');
    const snap = await metaRef.get();
    if (snap.data()?.key === LEGACY_CACHE_PURGE_KEY) return;
    await purgeAllStockMovementCaches();
    await metaRef.set({
      key: LEGACY_CACHE_PURGE_KEY,
      purgedAt: new Date().toISOString(),
    });
  } catch (err) {
    legacyCachePurgeStarted = false;
    console.warn('purgeAllStockMovementCaches failed:', err?.message ?? err);
  }
}

function lifetimeCacheRef(itemId) {
  return getFirestore()
    .collection('catalogProducts')
    .doc(itemId)
    .collection('stockLedger')
    .doc(LIFETIME_CACHE_DOC);
}

async function readLifetimeCache(itemId) {
  const snap = await lifetimeCacheRef(itemId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const fetchedAt = String(data.fetchedAt ?? '');
  const ageMs = fetchedAt ? Date.now() - Date.parse(fetchedAt) : Number.POSITIVE_INFINITY;
  if (!data.result || Number.isNaN(ageMs)) return null;
  return { result: data.result, ageMs, fetchedAt };
}

async function writeLifetimeCache(itemId, result) {
  try {
    await lifetimeCacheRef(itemId).set({
      result,
      fetchedAt: result.fetchedAt ?? new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn(`lifetime ledger cache write skipped for ${itemId}:`, err?.message ?? err);
  }
}

/** Lifetime ledger — cached 6h; live Zoho pull only when stale or forced. */
export async function getLifetimeStockMovements(
  secrets,
  configuredOrgId,
  catalogProductId,
  options = {},
) {
  const itemId = String(catalogProductId ?? '').trim();
  if (!itemId) throw new Error('catalogProductId is required.');

  void ensureLegacyStockMovementCachesPurged();

  const forceRefresh = options.forceRefresh === true;
  const cached = await readLifetimeCache(itemId);
  if (!forceRefresh && cached && cached.ageMs < LIFETIME_CACHE_MS) {
    return { ...cached.result, cached: true };
  }

  const usage = await peekZohoApiUsageCached();
  if (usage.status === 'daily_limit' || usage.remaining <= 80) {
    if (cached?.result) {
      return { ...cached.result, cached: true, quotaDeferred: true };
    }
    await assertZohoDaytimeBudget(secrets, configuredOrgId, { minRemaining: 80 });
  }

  const fresh = await listCatalogProductLifetimeStockMovements(
    secrets,
    configuredOrgId,
    itemId,
  );
  const result = stripExcludedLedgerMovements(fresh);
  await writeLifetimeCache(itemId, result);
  try {
    await persistLedgerClosingStockIfEligible(itemId, result);
  } catch (err) {
    console.warn(`persistLedgerClosingStockIfEligible ${itemId}:`, err?.message ?? err);
  }
  return result;
}

function isSoftwareKeysCategoryName(name) {
  return String(name ?? '').trim().toLowerCase() === 'software keys';
}

export function isSoftwareKeysLedgerStockProduct(product) {
  return isSoftwareKeysCategoryName(product?.categoryName);
}

function ledgerLooksInvoiceOnly(ledgerResult) {
  const movements = Array.isArray(ledgerResult?.movements) ? ledgerResult.movements : [];
  let invoiceOut = 0;
  let creditIn = 0;
  for (const row of movements) {
    const delta = Number(row?.qtyDelta) || 0;
    if (row?.type === 'invoice') invoiceOut += delta;
    if (row?.type === 'creditnote') creditIn += delta;
  }
  return invoiceOut < 0 && creditIn === 0;
}

async function persistLedgerClosingStockIfEligible(catalogProductId, ledgerResult) {
  if (ledgerResult?.ledgerIncomplete) {
    console.warn(`skip ledgerClosingStock persist for ${catalogProductId}: credit notes incomplete`);
    return false;
  }
  const db = getFirestore();
  const ref = db.collection('catalogProducts').doc(catalogProductId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  if (!isSoftwareKeysLedgerStockProduct(snap.data())) return false;

  const closing = Number(ledgerResult?.netDelta);
  const next = Number.isFinite(closing) ? closing : 0;
  const existing = Number(snap.data()?.ledgerClosingStock);
  if (Math.abs(next) > 200) {
    if (Number.isFinite(existing) && Math.abs(existing) > 200) {
      await ref.set({
        ledgerClosingStock: FieldValue.delete(),
        ledgerClosingStockAt: FieldValue.delete(),
      }, { merge: true });
      console.warn(`cleared implausible ledgerClosingStock ${catalogProductId} was ${existing}`);
    } else {
      console.warn(`skip ledgerClosingStock persist for ${catalogProductId}: implausible ${next}`);
    }
    return false;
  }
  const invoiceOnly = ledgerLooksInvoiceOnly(ledgerResult);
  if (invoiceOnly) {
    if (Number.isFinite(existing) && Math.abs(existing) > 200) {
      await ref.set({
        ledgerClosingStock: FieldValue.delete(),
        ledgerClosingStockAt: FieldValue.delete(),
      }, { merge: true });
      console.warn(`cleared implausible ledgerClosingStock ${catalogProductId} was ${existing}`);
    } else {
      console.warn(
        `skip ledgerClosingStock persist for ${catalogProductId}: invoice-only ${next}`
        + (Number.isFinite(existing) ? ` (keeping ${existing})` : ''),
      );
    }
    return false;
  }
  const invoiceOut = (ledgerResult?.movements ?? [])
    .filter(row => row?.type === 'invoice')
    .reduce((sum, row) => sum + Math.abs(Number(row.qtyDelta) || 0), 0);
  const creditIn = (ledgerResult?.movements ?? [])
    .filter(row => row?.type === 'creditnote')
    .reduce((sum, row) => sum + Math.abs(Number(row.qtyDelta) || 0), 0);
  if (invoiceOut > 0 && creditIn > invoiceOut * 20) {
    console.warn(
      `skip ledgerClosingStock persist for ${catalogProductId}: credit-in ${creditIn} vs invoice-out ${invoiceOut}`,
    );
    return false;
  }

  await ref.set({
    ledgerClosingStock: next,
    ledgerClosingStockAt: ledgerResult?.fetchedAt ?? new Date().toISOString(),
  }, { merge: true });
  console.info(`ledgerClosingStock ${catalogProductId}=${next}`);
  return true;
}

/** Refresh ledger closing stock on catalogProducts for Software Keys. */
export async function syncLedgerClosingStockForProducts(secrets, configuredOrgId, products, options = {}) {
  const eligible = (products ?? []).filter(
    p => p?.status === 'active' && isSoftwareKeysLedgerStockProduct(p),
  );
  if (eligible.length === 0) return { updated: 0, total: 0, skipped: 0 };

  const maxProducts = Math.min(eligible.length, Math.max(1, Number(options.maxProducts) || 8));
  const skipIfCachedHours = Number(options.skipIfCachedHours ?? 20);
  const minRemaining = Number(options.minRemaining ?? 3000);
  const usage = await peekZohoApiUsageCached();
  if (usage.status === 'daily_limit' || usage.remaining <= minRemaining) {
    console.log(
      `syncLedgerClosingStock skipped (remaining=${usage.remaining}, status=${usage.status}).`,
    );
    return { updated: 0, total: eligible.length, skipped: eligible.length, reason: 'quota' };
  }

  let updated = 0;
  let skipped = 0;
  for (const product of eligible.slice(0, maxProducts)) {
    try {
      const cached = await readLifetimeCache(product.id);
      if (cached && cached.ageMs < skipIfCachedHours * 60 * 60 * 1000) {
        skipped += 1;
        continue;
      }
      await getLifetimeStockMovements(secrets, configuredOrgId, product.id);
      updated += 1;
      await sleep(800);
    } catch (err) {
      console.warn(`syncLedgerClosingStock ${product.id}:`, err?.message ?? err);
      if (err?.dailyQuota || err?.code === 'RATE_LIMITED') break;
    }
  }
  return { updated, total: eligible.length, skipped };
}
