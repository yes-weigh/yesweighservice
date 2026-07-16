/**
 * Zoho item stock movements via /items/transactions/* (includes item_quantity).
 * Supports lifetime ledger (paginated) and cutoff-filtered history for audit popup.
 */
import { getAccessToken, resolveOrganizationId, ZOHO_API_BASE } from './zoho.js';

const REQUEST_GAP_MS = 100;
const PAGE_SIZE = 200;

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

/**
 * Paginate an item-transactions collection.
 * @returns {Promise<object[]>}
 */
async function listAllItemTransactions(zohoGet, pathSuffix, itemId, listKey) {
  const rows = [];
  let page = 1;
  for (;;) {
    const path = `/items/transactions/${pathSuffix}?item_id=${encodeURIComponent(itemId)}`
      + `&per_page=${PAGE_SIZE}&page=${page}`;
    const json = await zohoGet(path);
    const batch = Array.isArray(json[listKey]) ? json[listKey] : [];
    rows.push(...batch);
    const hasMore = Boolean(json.page_context?.has_more_page);
    if (!hasMore || batch.length === 0) break;
    page += 1;
    if (page > 100) break; // safety
  }
  return rows;
}

function mapInvoice(row) {
  const qty = Number(row.item_quantity ?? 0);
  if (!qty) return null;
  return {
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
    qtyDelta: -Math.abs(qty),
    reference: null,
    itemPrice: row.item_price != null ? Number(row.item_price) : null,
    itemTotal: row.item_total_price != null ? Number(row.item_total_price) : null,
  };
}

function mapBill(row) {
  const qty = Number(row.item_quantity ?? 0);
  if (!qty) return null;
  return {
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
    qtyDelta: +Math.abs(qty),
    reference: null,
    itemPrice: row.item_price != null ? Number(row.item_price) : null,
    itemTotal: row.item_total_price != null ? Number(row.item_total_price) : null,
  };
}

function mapCreditNote(row) {
  const qty = Number(row.item_quantity ?? 0);
  if (!qty) return null;
  return {
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
    qtyDelta: +Math.abs(qty),
    reference: null,
    itemPrice: row.item_price != null ? Number(row.item_price) : null,
    itemTotal: row.item_total_price != null ? Number(row.item_total_price) : null,
  };
}

function mapAdjustment(row) {
  const qty = Number(row.item_quantity ?? row.quantity_adjusted ?? 0);
  if (!qty) return null;
  return {
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
    qtyDelta: qty,
    reference: String(row.reason ?? row.description ?? '').trim() || null,
    itemPrice: null,
    itemTotal: null,
  };
}

function mapMoveOrder(row) {
  const qty = Number(row.item_quantity ?? 0);
  if (!qty) return null;
  return {
    type: 'moveorder',
    typeLabel: 'Transfer',
    documentId: String(row.moveorder_id ?? ''),
    documentNumber: String(row.moveorder_number ?? row.salesorder_number ?? ''),
    date: String(row.date ?? ''),
    createdTime: String(row.date ?? ''),
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : null,
    status: String(row.status ?? ''),
    customerOrVendor: null,
    quantity: Math.abs(qty),
    qtyDelta: 0, // location transfer — net stock unchanged
    reference: null,
    itemPrice: null,
    itemTotal: null,
  };
}

function mapSalesReturn(row) {
  const qty = Number(row.item_quantity ?? row.quantity ?? 0);
  if (!qty) return null;
  return {
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
    qtyDelta: +Math.abs(qty),
    reference: null,
    itemPrice: null,
    itemTotal: null,
  };
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
    // List may lack item_quantity — keep rows; qty may be 0 until we know
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

  const [invoices, bills, creditnotes, adjustments, moveorders] = await Promise.all([
    listAllItemTransactions(zohoGet, 'invoices', itemId, 'invoices'),
    listAllItemTransactions(zohoGet, 'bills', itemId, 'bills'),
    listAllItemTransactions(zohoGet, 'creditnotes', itemId, 'creditnotes'),
    listAllItemTransactions(zohoGet, 'inventoryadjustments', itemId, 'inventory_adjustments'),
    listAllItemTransactions(zohoGet, 'moveorders', itemId, 'moveorders'),
  ]);

  const salesReturns = await listSalesReturns(zohoGet, itemId);

  const movements = [
    ...invoices.map(mapInvoice),
    ...bills.map(mapBill),
    ...creditnotes.map(mapCreditNote),
    ...adjustments.map(mapAdjustment),
    ...moveorders.map(mapMoveOrder),
    ...salesReturns,
  ].filter(Boolean);

  movements.sort((a, b) => {
    const da = String(a.date || a.createdAt || '');
    const db = String(b.date || b.createdAt || '');
    if (da !== db) return db.localeCompare(da); // newest first
    return String(b.documentNumber).localeCompare(String(a.documentNumber));
  });

  // Running stock from oldest → newest, then attach for display (newest-first list).
  const oldestFirst = [...movements].reverse();
  let running = 0;
  const withRunningAsc = oldestFirst.map(m => {
    running += Number(m.qtyDelta) || 0;
    return { ...m, runningStock: running };
  });
  const byKey = new Map(
    withRunningAsc.map(m => [`${m.type}:${m.documentId}:${m.date}`, m.runningStock]),
  );
  for (const m of movements) {
    m.runningStock = byKey.get(`${m.type}:${m.documentId}:${m.date}`) ?? null;
  }

  const netDelta = movements.reduce((sum, m) => sum + (Number(m.qtyDelta) || 0), 0);

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

  return {
    catalogProductId: itemId,
    lifetime: true,
    until: null,
    dateStart: null,
    dateEnd: null,
    lookbackDays: null,
    movementCount: movements.length,
    netDelta,
    currentStock,
    fetchedAt: new Date().toISOString(),
    movements,
  };
}

/**
 * Movements with created/date ≤ until (for audit-log popup).
 * Uses the same item-transaction endpoints, then filters by date.
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

  const full = await listCatalogProductLifetimeStockMovements(
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

  const netDelta = movements.reduce((sum, m) => sum + (Number(m.qtyDelta) || 0), 0);

  return {
    catalogProductId: full.catalogProductId,
    lifetime: false,
    until,
    dateStart: null,
    dateEnd: untilDate,
    lookbackDays: null,
    movementCount: movements.length,
    netDelta,
    currentStock: full.currentStock,
    fetchedAt: full.fetchedAt,
    movements,
  };
}
