/**
 * Rebuild / list Zoho stock movements for a catalog item up to a cutoff time.
 * Sources: invoices (out), bills (in), credit notes (in), inventory adjustments.
 */
import { getAccessToken, resolveOrganizationId, ZOHO_API_BASE } from './zoho.js';

const REQUEST_GAP_MS = 120;
const LOOKBACK_DAYS = 365;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dateOnly(iso) {
  return String(iso).slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return dateOnly(d.toISOString());
}

/** Zoho created_time like 2026-07-10T14:10:00+0530 → ISO UTC */
export function zohoTimeToIso(zohoTime) {
  if (!zohoTime) return null;
  const m = String(zohoTime).match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})([+-]\d{4})$/,
  );
  if (!m) {
    const parsed = Date.parse(zohoTime);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const sign = m[3][0] === '-' ? -1 : 1;
  const offH = Number(m[3].slice(1, 3));
  const offM = Number(m[3].slice(3, 5));
  const utcMs = Date.parse(`${m[1]}T${m[2]}Z`) - sign * (offH * 60 + offM) * 60_000;
  return new Date(utcMs).toISOString();
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

async function listCollection(zohoGet, collection, itemId, dateStart, dateEnd) {
  const path = `/${collection}?item_id=${encodeURIComponent(itemId)}`
    + `&date_start=${dateStart}&date_end=${dateEnd}&per_page=200`;
  const json = await zohoGet(path);
  return Array.isArray(json[collection]) ? json[collection] : [];
}

async function lineQtyForItem(zohoGet, collection, singular, idField, docId, itemId) {
  const json = await zohoGet(`/${collection}/${docId}`);
  const doc = json[singular];
  if (!doc) return null;
  let qty = 0;
  for (const line of doc.line_items || []) {
    if (String(line.item_id) === String(itemId)) qty += Number(line.quantity || 0);
  }
  if (!qty) return null;
  return {
    documentId: String(docId),
    documentNumber: String(doc[idField] ?? docId),
    date: String(doc.date ?? ''),
    createdTime: String(doc.created_time ?? ''),
    createdAt: zohoTimeToIso(doc.created_time),
    status: String(doc.status ?? ''),
    customerOrVendor: String(
      doc.customer_name
      ?? doc.vendor_name
      ?? doc.company_name
      ?? '',
    ).trim() || null,
    quantity: qty,
    reference: String(doc.reference_number ?? doc.salesorder_number ?? '').trim() || null,
  };
}

/**
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} secrets
 * @param {string} configuredOrgId
 * @param {string} catalogProductId
 * @param {string} untilIso - include movements with createdAt <= untilIso
 */
export async function listCatalogProductStockMovements(
  secrets,
  configuredOrgId,
  catalogProductId,
  untilIso,
) {
  const itemId = String(catalogProductId ?? '').trim();
  const until = String(untilIso ?? '').trim();
  if (!itemId) throw new Error('catalogProductId is required.');
  if (!until || Number.isNaN(Date.parse(until))) {
    throw new Error('until must be a valid ISO datetime.');
  }

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, configuredOrgId);
  const zohoGet = createZohoGetter(accessToken, organizationId);

  const untilDate = dateOnly(until);
  const dateStart = addDays(untilDate, -LOOKBACK_DAYS);
  const movements = [];

  const invoices = await listCollection(zohoGet, 'invoices', itemId, dateStart, untilDate);
  for (const inv of invoices) {
    const row = await lineQtyForItem(
      zohoGet,
      'invoices',
      'invoice',
      'invoice_number',
      inv.invoice_id,
      itemId,
    );
    if (!row || !row.createdAt || row.createdAt > until) continue;
    movements.push({
      ...row,
      type: 'invoice',
      typeLabel: 'Invoice',
      qtyDelta: -row.quantity,
    });
  }

  const bills = await listCollection(zohoGet, 'bills', itemId, dateStart, untilDate);
  for (const bill of bills) {
    const row = await lineQtyForItem(
      zohoGet,
      'bills',
      'bill',
      'bill_number',
      bill.bill_id,
      itemId,
    );
    if (!row || !row.createdAt || row.createdAt > until) continue;
    movements.push({
      ...row,
      type: 'bill',
      typeLabel: 'Bill',
      qtyDelta: +row.quantity,
    });
  }

  const creditnotes = await listCollection(zohoGet, 'creditnotes', itemId, dateStart, untilDate);
  for (const cn of creditnotes) {
    const row = await lineQtyForItem(
      zohoGet,
      'creditnotes',
      'creditnote',
      'creditnote_number',
      cn.creditnote_id,
      itemId,
    );
    if (!row || !row.createdAt || row.createdAt > until) continue;
    movements.push({
      ...row,
      type: 'creditnote',
      typeLabel: 'Credit note',
      qtyDelta: +row.quantity,
    });
  }

  // Inventory adjustments (optional; may be empty for many orgs).
  try {
    const adjJson = await zohoGet(
      `/inventoryadjustments?item_id=${encodeURIComponent(itemId)}`
      + `&date_start=${dateStart}&date_end=${untilDate}&per_page=200`,
    );
    const adjustments = Array.isArray(adjJson.inventory_adjustments)
      ? adjJson.inventory_adjustments
      : [];
    for (const adj of adjustments) {
      const detail = await zohoGet(`/inventoryadjustments/${adj.inventoryadjustment_id || adj.adjustment_id}`);
      const doc = detail.inventoryadjustment || detail.inventory_adjustment;
      if (!doc) continue;
      let qty = 0;
      for (const line of doc.line_items || []) {
        if (String(line.item_id) === String(itemId)) {
          qty += Number(line.quantity_adjusted ?? line.quantity ?? 0);
        }
      }
      if (!qty) continue;
      const createdAt = zohoTimeToIso(doc.created_time);
      if (!createdAt || createdAt > until) continue;
      movements.push({
        documentId: String(adj.inventoryadjustment_id || adj.adjustment_id),
        documentNumber: String(doc.adjustment_number ?? adj.adjustment_number ?? ''),
        date: String(doc.date ?? ''),
        createdTime: String(doc.created_time ?? ''),
        createdAt,
        status: String(doc.status ?? ''),
        customerOrVendor: null,
        quantity: Math.abs(qty),
        reference: String(doc.reason ?? doc.description ?? '').trim() || null,
        type: 'adjustment',
        typeLabel: 'Adjustment',
        qtyDelta: qty,
      });
    }
  } catch {
    // Adjustments endpoint varies by org plan — ignore failures.
  }

  movements.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const netDelta = movements.reduce((sum, m) => sum + (Number(m.qtyDelta) || 0), 0);

  return {
    catalogProductId: itemId,
    until,
    dateStart,
    dateEnd: untilDate,
    lookbackDays: LOOKBACK_DAYS,
    movementCount: movements.length,
    netDelta,
    movements,
  };
}
