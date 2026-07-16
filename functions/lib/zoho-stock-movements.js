/**
 * Zoho item stock movements via /items/transactions/* (includes item_quantity).
 * Fetches all stock-affecting doc types. Void/cancelled docs stay visible but
 * qtyDelta=0 so Running matches Zoho accounting stock. Lifetime results are
 * cached under catalogProducts/{id}/stockMovements/lifetime.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId, ZOHO_API_BASE } from './zoho.js';

const REQUEST_GAP_MS = 100;
const PAGE_SIZE = 200;
const STOCK_MOVEMENTS_SUB = 'stockMovements';
const LIFETIME_CACHE_DOC = 'lifetime';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createZohoGetter(accessToken, organizationId) {
  let lastCall = 0;

  return async function zohoGet(path) {
    const elapsed = Date.now() - lastCall;
    if (elapsed < REQUEST_GAP_MS) await sleep(REQUEST_GAP_MS - elapsed);
    lastCall = Date.now();

    const url = `${ZOHO_API_BASE}${path}${path.includes('?') ? '&' : '?'}organization_id=${encodeURIComponent(organizationId)}`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    const json = await res.json();
    if (!res.ok || (json.code != null && json.code !== 0)) {
      const err = new Error(json.message || res.statusText || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  };
}

async function listAllItemTransactions(zohoGet, pathSuffix, itemId, listKey) {
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
  } catch {
    return rows;
  }
  return rows;
}

function baseMovement(partial) {
  return {
    reference: null,
    itemPrice: null,
    itemTotal: null,
    affectsStock: true,
    displayQtyDelta: null,
    ...partial,
  };
}

/** Void/cancelled docs stay visible but do not change Zoho accounting stock. */
function isVoidStatus(status) {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'void' || s === 'voided' || s === 'cancelled' || s === 'canceled';
}

function withStockEffect(movement, signedDelta) {
  const voided = isVoidStatus(movement.status);
  if (!voided) {
    return { ...movement, qtyDelta: signedDelta, displayQtyDelta: signedDelta, affectsStock: true };
  }
  return {
    ...movement,
    qtyDelta: 0,
    displayQtyDelta: signedDelta,
    affectsStock: false,
    reference: movement.reference
      || 'Void — excluded from stock (Zoho does not move inventory)',
  };
}

function mapInvoice(row) {
  const qty = Number(row.item_quantity ?? 0);
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
  }), -Math.abs(qty));
}

function mapBill(row) {
  const qty = Number(row.item_quantity ?? 0);
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
  }), +Math.abs(qty));
}

function mapCreditNote(row) {
  const qty = Number(row.item_quantity ?? 0);
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
  const qty = Number(row.item_quantity ?? 0);
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
  const qty = Number(row.item_quantity ?? 0);
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

function mapPackage(row) {
  const qty = Number(row.item_quantity ?? 0);
  if (!qty) return null;
  // Packages usually confirm pick against an SO; stock is typically reduced on invoice.
  // Include for visibility with net-zero so we don't double-count vs invoices.
  return baseMovement({
    type: 'package',
    typeLabel: 'Package',
    documentId: String(row.package_id ?? ''),
    documentNumber: String(row.package_number ?? ''),
    date: String(row.date ?? ''),
    createdTime: String(row.date ?? ''),
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: String(row.customer_name ?? '').trim() || null,
    quantity: Math.abs(qty),
    qtyDelta: 0,
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
    } catch {
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

  const [
    invoices,
    bills,
    creditnotes,
    adjustments,
    moveorders,
    packages,
    purchasereceives,
    transferorders,
    putaways,
  ] = await Promise.all([
    listAllItemTransactions(zohoGet, 'invoices', itemId, 'invoices'),
    listAllItemTransactions(zohoGet, 'bills', itemId, 'bills'),
    listAllItemTransactions(zohoGet, 'creditnotes', itemId, 'creditnotes'),
    listAllItemTransactions(zohoGet, 'inventoryadjustments', itemId, 'inventory_adjustments'),
    listAllItemTransactions(zohoGet, 'moveorders', itemId, 'moveorders'),
    listAllItemTransactions(zohoGet, 'packages', itemId, 'packages'),
    listAllItemTransactions(zohoGet, 'purchasereceives', itemId, 'purchasereceives'),
    listAllItemTransactions(zohoGet, 'transferorders', itemId, 'transferorders'),
    listAllItemTransactions(zohoGet, 'putaways', itemId, 'putaways'),
  ]);

  const salesReturns = await listSalesReturns(zohoGet, itemId);

  const movements = [
    ...invoices.map(mapInvoice),
    ...bills.map(mapBill),
    ...creditnotes.map(mapCreditNote),
    ...adjustments.map(mapAdjustment),
    ...moveorders.map(r => mapTransferLike(r, 'moveorder', 'Transfer', 'moveorder_id', 'moveorder_number')),
    ...packages.map(mapPackage),
    ...purchasereceives.map(mapPurchaseReceive),
    ...transferorders.map(r => mapTransferLike(r, 'transferorder', 'Transfer order', 'transfer_order_id', 'transfer_order_number')),
    ...putaways.map(r => mapTransferLike(r, 'putaway', 'Putaway', 'putaway_id', 'putaway_number')),
    ...salesReturns,
  ].filter(Boolean);

  let currentStock = null;
  try {
    const itemJson = await zohoGet(`/items/${encodeURIComponent(itemId)}`);
    const item = itemJson.item;
    currentStock = Number(
      item?.stock_on_hand ?? item?.available_stock ?? item?.actual_available_stock ?? NaN,
    );
    if (!Number.isFinite(currentStock)) currentStock = null;
  } catch {
    // optional
  }

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
 * Uses cached lifetime ledger when available unless forceRefresh.
 */
export async function listCatalogProductStockMovements(
  secrets,
  configuredOrgId,
  catalogProductId,
  untilIso,
  { forceRefresh = false } = {},
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
    { forceRefresh },
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
    fromCache: full.fromCache ?? false,
    movements: sorted,
  };
}

async function readLifetimeCache(catalogProductId) {
  const snap = await getFirestore()
    .collection('catalogProducts')
    .doc(catalogProductId)
    .collection(STOCK_MOVEMENTS_SUB)
    .doc(LIFETIME_CACHE_DOC)
    .get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!Array.isArray(data?.movements)) return null;
  return data;
}

async function writeLifetimeCache(payload) {
  const { fromCache: _fc, ...rest } = payload;
  await getFirestore()
    .collection('catalogProducts')
    .doc(payload.catalogProductId)
    .collection(STOCK_MOVEMENTS_SUB)
    .doc(LIFETIME_CACHE_DOC)
    .set({
      ...rest,
      cachedAt: new Date().toISOString(),
    });
}

/**
 * Lifetime ledger with Firestore cache.
 * forceRefresh=false → return cache if present, else fetch Zoho and save.
 * forceRefresh=true → always refetch Zoho and overwrite cache.
 */
export async function getLifetimeStockMovements(
  secrets,
  configuredOrgId,
  catalogProductId,
  { forceRefresh = false } = {},
) {
  const itemId = String(catalogProductId ?? '').trim();
  if (!itemId) throw new Error('catalogProductId is required.');

  if (!forceRefresh) {
    const cached = await readLifetimeCache(itemId);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  const fresh = await listCatalogProductLifetimeStockMovements(
    secrets,
    configuredOrgId,
    itemId,
  );
  await writeLifetimeCache(fresh);
  return { ...fresh, fromCache: false };
}
