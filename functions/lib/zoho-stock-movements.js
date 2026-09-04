/**
 * Zoho item stock movements via /items/transactions/* (includes item_quantity).
 * Fetches stock-affecting doc types. Draft/void/cancelled docs stay visible but
 * qtyDelta=0 so Running matches Zoho accounting stock. Always fetched live from Zoho.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId, ZOHO_API_BASE } from './zoho.js';

const REQUEST_GAP_MS = 100;
const PAGE_SIZE = 200;
const STOCK_MOVEMENTS_SUB = 'stockMovements';
const LEGACY_CACHE_PURGE_KEY = 'no-firestore-stock-ledger-v1';
const SOFTWARE_KEYS_LEDGER_HSN = '997331';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isZohoRateLimit(res, json) {
  if (res?.status === 429) return true;
  const code = Number(json?.code);
  if (code === 57 || code === 42) return true;
  const message = String(json?.message ?? '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many requests');
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
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          return await zohoGetOnce(path, attempt);
        } catch (err) {
          lastErr = err;
          if (!err?.retryable) throw err;
        }
      }
      throw lastErr || new Error('Zoho rate limit. Try Refresh again.');
    };
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };
}

async function listAllItemTransactions(zohoGet, pathSuffix, itemId, listKey, { required = false } = {}) {
  const rows = [];
  let page = 1;
  try {
    for (;;) {
      const path = `/items/transactions/${pathSuffix}?item_id=${encodeURIComponent(itemId)}`
        + `&per_page=${PAGE_SIZE}&page=${page}`;
      const json = await zohoGet(path);
      const batch = Array.isArray(json[listKey])
        ? json[listKey]
        : (Array.isArray(json[pathSuffix]) ? json[pathSuffix] : []);
      rows.push(...batch);
      const hasMore = Boolean(json.page_context?.has_more_page);
      if (!hasMore || batch.length === 0) break;
      page += 1;
      if (page > 100) break;
    }
  } catch (err) {
    console.warn(`Zoho item transactions/${pathSuffix} failed for ${itemId}:`, err?.message ?? err);
    if (required && !rows.length) throw err;
  }
  return rows;
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
  for (const billId of billIds) {
    try {
      const json = await zohoGet(`/bills/${encodeURIComponent(billId)}`);
      const doc = json.bill ?? json;
      const currency = parseCurrencyFields(doc);
      if (currency.currencyCode || currency.currencySymbol) {
        currencyByBillId.set(billId, currency);
      }
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
  const qty = Number(row?.item_quantity ?? row?.quantity ?? 0);
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

function mapBill(row) {
  const qty = rowItemQty(row);
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
    quantity: Math.abs(qty),
    itemPrice: row.item_price != null ? Number(row.item_price) : null,
    itemTotal: row.item_total_price != null ? Number(row.item_total_price) : null,
    ...parseCurrencyFields(row),
  }), +Math.abs(qty));
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
  const currentStock = payload.currentStock != null && Number.isFinite(Number(payload.currentStock))
    ? Number(payload.currentStock)
    : null;
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
  const invoices = await listAllItemTransactions(zohoGet, 'invoices', itemId, 'invoices', { required: true });
  const creditnotes = await listAllItemTransactions(zohoGet, 'creditnotes', itemId, 'creditnotes');
  let bills = [];
  let adjustments = [];
  let moveorders = [];
  let purchasereceives = [];
  let transferorders = [];
  let putaways = [];
  let salesReturns = [];
  if (inventory) {
    [
      bills,
      adjustments,
      moveorders,
      purchasereceives,
      transferorders,
      putaways,
    ] = await Promise.all([
      listAllItemTransactions(zohoGet, 'bills', itemId, 'bills'),
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
    ...bills.map(mapBill),
    ...creditnotes.map(mapCreditNote),
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

/** Lifetime ledger — always fetched live from Zoho. */
export async function getLifetimeStockMovements(
  secrets,
  configuredOrgId,
  catalogProductId,
) {
  const itemId = String(catalogProductId ?? '').trim();
  if (!itemId) throw new Error('catalogProductId is required.');

  void ensureLegacyStockMovementCachesPurged();
  void deleteStockMovementsCache(itemId).catch(() => {});

  const fresh = await listCatalogProductLifetimeStockMovements(
    secrets,
    configuredOrgId,
    itemId,
  );
  const result = stripExcludedLedgerMovements(fresh);
  void persistLedgerClosingStockIfEligible(itemId, result).catch(err => {
    console.warn(`persistLedgerClosingStockIfEligible ${itemId}:`, err?.message ?? err);
  });
  return result;
}

function isSoftwareKeysCategoryName(name) {
  return String(name ?? '').trim().toLowerCase() === 'software keys';
}

export function isSoftwareKeysLedgerStockProduct(product) {
  const hsn = String(product?.hsn ?? '').replace(/\s+/g, '').trim();
  if (hsn !== SOFTWARE_KEYS_LEDGER_HSN) return false;
  return isSoftwareKeysCategoryName(product?.categoryName);
}

async function persistLedgerClosingStockIfEligible(catalogProductId, ledgerResult) {
  const db = getFirestore();
  const ref = db.collection('catalogProducts').doc(catalogProductId);
  const snap = await ref.get();
  if (!snap.exists) return;
  if (!isSoftwareKeysLedgerStockProduct(snap.data())) return;

  const closing = Number(ledgerResult?.netDelta);
  await ref.set({
    ledgerClosingStock: Number.isFinite(closing) ? closing : 0,
    ledgerClosingStockAt: ledgerResult?.fetchedAt ?? new Date().toISOString(),
  }, { merge: true });
}

/** Refresh ledger closing stock on catalogProducts for Software Keys + HSN 997331. */
export async function syncLedgerClosingStockForProducts(secrets, configuredOrgId, products) {
  const eligible = (products ?? []).filter(
    p => p?.status === 'active' && isSoftwareKeysLedgerStockProduct(p),
  );
  if (eligible.length === 0) return { updated: 0, total: 0 };

  let updated = 0;
  for (const product of eligible) {
    try {
      await getLifetimeStockMovements(secrets, configuredOrgId, product.id);
      updated += 1;
    } catch (err) {
      console.warn(`syncLedgerClosingStock ${product.id}:`, err?.message ?? err);
    }
  }
  return { updated, total: eligible.length };
}
