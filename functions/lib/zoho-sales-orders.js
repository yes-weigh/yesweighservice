/**
 * Create Zoho Inventory sales orders and invoices from portal dealer orders.
 */
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE, hasZohoJsonBody } from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
} from './zoho-api-usage.js';
import { isSacHsn } from './sac-catalog.js';
import { isFreightOrderLine } from './freight-lines.js';

function isZohoNotAuthorized(err) {
  return /not authorized to perform this operation/i.test(String(err?.message ?? ''));
}

/** Goods that Zoho can stock at a warehouse. Freight/SAC/empty-warehouse lines must not send warehouse_id. */
export function lineAllowsWarehouse(line) {
  if (isFreightOrderLine(line)) return false;
  if (isSacHsn(line.hsn)) return false;
  const sku = String(line?.sku ?? '').trim().toUpperCase();
  const name = String(line?.name ?? '').trim().toUpperCase();
  const warehouses = Array.isArray(line?.warehouses) ? line.warehouses : null;
  if (
    (sku.includes('FREIGHT') || name.includes('FREIGHT'))
    && (!warehouses || warehouses.length === 0)
  ) {
    return false;
  }
  if (warehouses && warehouses.length === 0) return false;
  return true;
}

function warehouseIdForLine(line, fallbackWarehouseId) {
  if (!lineAllowsWarehouse(line)) return null;
  const fallback = fallbackWarehouseId != null && String(fallbackWarehouseId).trim()
    ? String(fallbackWarehouseId).trim()
    : null;
  if (!fallback) return null;
  if (Array.isArray(line?.warehouses)) {
    const hasFallback = line.warehouses.some((row) => {
      const id = String(row?.warehouseId ?? row?.warehouse_id ?? '').trim();
      return id === fallback;
    });
    return hasFallback ? fallback : null;
  }
  return fallback;
}

function inlineShippingAddress(address) {
  if (!address || typeof address !== 'object') return null;
  return {
    attention: address.attention || '',
    address: address.address || '',
    street2: address.street2 || '',
    city: address.city || '',
    state: address.state || '',
    zip: address.zip || '',
    country: address.country || 'India',
    phone: address.phone || '',
  };
}

function cloneSalesOrderBody(body) {
  return {
    ...body,
    line_items: (body.line_items || []).map(line => ({ ...line })),
  };
}

function withoutLineWarehouses(body) {
  const next = cloneSalesOrderBody(body);
  next.line_items = next.line_items.map(({ warehouse_id: _id, ...line }) => line);
  return next;
}

function withoutSalesperson(body) {
  const next = cloneSalesOrderBody(body);
  delete next.salesperson_id;
  return next;
}

function withInlineShippingBody(body, address) {
  const shipping = inlineShippingAddress(address);
  if (!shipping) return body;
  const next = cloneSalesOrderBody(body);
  delete next.shipping_address_id;
  next.shipping_address = shipping;
  return next;
}

function uniqueSalesOrderCreateAttempts(body, shippingInline) {
  const attempts = [cloneSalesOrderBody(body)];
  const hasWarehouse = body.line_items.some(line => line.warehouse_id);
  if (hasWarehouse) attempts.push(withoutLineWarehouses(body));
  if (body.salesperson_id) {
    attempts.push(withoutSalesperson(body));
    if (hasWarehouse) attempts.push(withoutSalesperson(withoutLineWarehouses(body)));
  }
  if (body.shipping_address_id && shippingInline) {
    attempts.push(withInlineShippingBody(
      withoutSalesperson(withoutLineWarehouses(body)),
      shippingInline,
    ));
  }
  return attempts;
}

async function zohoJson(accessToken, orgId, path, { method = 'GET', body } = {}) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  if (!url.searchParams.has('organization_id')) {
    url.searchParams.set('organization_id', orgId);
  }

  const sendBody = hasZohoJsonBody(body);
  const init = {
    method,
    headers: {
      ...authHeaders(accessToken, orgId),
      ...(sendBody ? { 'Content-Type': 'application/json' } : {}),
    },
  };
  if (sendBody) init.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    recordZohoApiFailure(err);
    throw err;
  }

  const payload = await res.json().catch(() => ({}));
  recordZohoApiResponse(res.status, path);

  if (!res.ok) {
    const classified = classifyZohoHttpError(res.status, payload);
    const message = payload?.message
      || payload?.code
      || classified?.message
      || `Zoho request failed (${res.status})`;
    throw new Error(message);
  }
  return payload;
}

function lineItemsFromOrder(order, warehouseId = null) {
  const lines = Array.isArray(order.lines) ? order.lines : [];
  // Multi-warehouse orgs accept warehouse_id; location_id is rejected when Locations is off.
  // SAC/service lines (software keys, GATC, freight) must not send warehouse_id —
  // Zoho returns "You are not authorized to perform this operation".
  return lines.map(line => {
    const warehouse = warehouseIdForLine(line, warehouseId);
    return {
      item_id: String(line.itemId || line.productId),
      name: String(line.name || 'Item'),
      rate: Number(line.rate || 0),
      quantity: Number(line.quantity || 0),
      unit: String(line.unit || 'pcs'),
      ...(line.description ? { description: String(line.description) } : {}),
      ...(line.hsn ? { hsn_or_sac: String(line.hsn) } : {}),
      ...(warehouse ? { warehouse_id: warehouse } : {}),
    };
  }).filter(line => line.quantity > 0 && line.item_id);
}

function zohoLineAllowsWarehouse(item) {
  return lineAllowsWarehouse({
    itemId: item?.item_id,
    productId: item?.item_id,
    sku: item?.sku,
    hsn: item?.hsn_or_sac || item?.hsn,
  });
}

function zohoStatusKey(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '_');
}

function isAlreadyConfirmedMessage(message) {
  return /already|confirmed|status is open|\bis open\b|invoiced/i.test(String(message || ''));
}

function isAlreadyInvoicedQuantityMessage(message) {
  return /no items in this sales order to be invoiced|quantity recorded cannot be more than quantity ordered/i
    .test(String(message || ''));
}

function stripSalesOrderItemIds(lines) {
  return (Array.isArray(lines) ? lines : []).map(({ salesorder_item_id: _id, ...line }) => line);
}

async function postZohoIgnore(accessToken, orgId, path, ignorePattern) {
  try {
    await zohoJson(accessToken, orgId, path, { method: 'POST', body: {} });
  } catch (err) {
    const message = String(err?.message || '');
    if (!ignorePattern.test(message) && !isZohoNotAuthorized(err)) throw err;
  }
}

/** Writable line fields only — Zoho GET payloads include read-only keys that break PUT. */
function lineItemsForSalesOrderPut(so, { keepGoodsWarehouse = false } = {}) {
  const items = Array.isArray(so?.line_items) ? so.line_items : [];
  return items.map(item => {
    const line = {
      item_id: item.item_id,
      name: item.name,
      rate: item.rate,
      quantity: item.quantity,
      unit: item.unit || 'pcs',
    };
    if (item.line_item_id) line.line_item_id = item.line_item_id;
    if (item.description) line.description = item.description;
    if (item.hsn_or_sac) line.hsn_or_sac = item.hsn_or_sac;
    if (item.tax_id) line.tax_id = item.tax_id;
    if (
      keepGoodsWarehouse
      && zohoLineAllowsWarehouse(item)
      && item.warehouse_id != null
      && String(item.warehouse_id).trim()
    ) {
      line.warehouse_id = String(item.warehouse_id).trim();
    }
    return line;
  }).filter(line => line.item_id && Number(line.quantity) > 0);
}

function salesOrderHasServiceWarehouse(so) {
  const items = Array.isArray(so?.line_items) ? so.line_items : [];
  return items.some(item =>
    item?.warehouse_id != null
    && String(item.warehouse_id).trim()
    && !zohoLineAllowsWarehouse(item),
  );
}

async function stripServiceWarehousesOnSalesOrder(accessToken, orgId, so) {
  if (!so?.salesorder_id || !salesOrderHasServiceWarehouse(so)) return so;
  const payload = await zohoJson(accessToken, orgId, `/salesorders/${so.salesorder_id}`, {
    method: 'PUT',
    body: {
      customer_id: so.customer_id,
      date: so.date || new Date().toISOString().slice(0, 10),
      line_items: lineItemsForSalesOrderPut(so, { keepGoodsWarehouse: true }),
      ...(so.reference_number ? { reference_number: so.reference_number } : {}),
      ...(so.notes ? { notes: so.notes } : {}),
      ...(so.salesperson_id ? { salesperson_id: so.salesperson_id } : {}),
    },
  });
  return payload?.salesorder || so;
}

async function ensureServiceWarehousesStripped(accessToken, orgId, so) {
  if (!so?.salesorder_id || !salesOrderHasServiceWarehouse(so)) return so;
  const soId = String(so.salesorder_id);

  try {
    const stripped = await stripServiceWarehousesOnSalesOrder(accessToken, orgId, so);
    if (!salesOrderHasServiceWarehouse(stripped)) return stripped;
  } catch (err) {
    console.warn(
      `Could not strip service warehouses on SO ${soId}:`,
      err?.message || err,
    );
  }

  try {
    await zohoJson(accessToken, orgId, `/salesorders/${soId}/status/draft`, {
      method: 'POST',
      body: {},
    });
  } catch (err) {
    const message = String(err?.message || '');
    if (!isZohoNotAuthorized(err) && !/already|draft|cannot|pending/i.test(message)) {
      console.warn(`Could not reopen SO ${soId} as draft:`, message);
    }
  }

  const reloadedPayload = await zohoJson(accessToken, orgId, `/salesorders/${soId}`);
  let current = reloadedPayload?.salesorder || so;
  try {
    current = await stripServiceWarehousesOnSalesOrder(accessToken, orgId, current);
  } catch (err) {
    console.warn(
      `Could not strip service warehouses after draft on SO ${soId}:`,
      err?.message || err,
    );
  }

  const status = zohoStatusKey(current.status);
  if (!['open', 'confirmed', 'invoiced', 'closed'].includes(status)) {
    await confirmSalesOrderRequest(accessToken, orgId, soId);
    const confirmed = await zohoJson(accessToken, orgId, `/salesorders/${soId}`);
    return confirmed?.salesorder || current;
  }
  return current;
}

function goodsWarehouseId(so, item) {
  if (!zohoLineAllowsWarehouse(item)) return null;
  const fromLine = item?.warehouse_id != null ? String(item.warehouse_id).trim() : '';
  if (fromLine) return fromLine;
  const fromSo = so?.warehouse_id != null ? String(so.warehouse_id).trim() : '';
  if (fromSo) return fromSo;
  const items = Array.isArray(so?.line_items) ? so.line_items : [];
  const sibling = items.find(row =>
    zohoLineAllowsWarehouse(row)
    && row?.warehouse_id != null
    && String(row.warehouse_id).trim(),
  );
  return sibling?.warehouse_id != null ? String(sibling.warehouse_id).trim() : null;
}

function invoiceLineItemsFromSalesOrder(so, { linkServiceLines = true } = {}) {
  const items = Array.isArray(so?.line_items) ? so.line_items : [];
  return items.map(item => {
    const line = {
      item_id: item.item_id,
      name: item.name,
      rate: item.rate,
      quantity: item.quantity,
      unit: item.unit || 'pcs',
    };
    if (item.description) line.description = item.description;
    if (item.hsn_or_sac) line.hsn_or_sac = item.hsn_or_sac;
    if (item.tax_id) line.tax_id = item.tax_id;
    if (item.line_item_id && (linkServiceLines || zohoLineAllowsWarehouse(item))) {
      line.salesorder_item_id = item.line_item_id;
    }
    const warehouseId = goodsWarehouseId(so, item);
    if (warehouseId) line.warehouse_id = warehouseId;
    return line;
  }).filter(line => line.item_id && Number(line.quantity) > 0);
}

async function confirmSalesOrderRequest(accessToken, orgId, soId) {
  try {
    await zohoJson(accessToken, orgId, `/salesorders/${soId}/status/confirmed`, {
      method: 'POST',
      body: {},
    });
  } catch (err) {
    if (isAlreadyConfirmedMessage(err?.message)) return;
    if (!isZohoNotAuthorized(err) && !/approv|submit|draft|pending/i.test(String(err?.message || ''))) {
      throw err;
    }
    await postZohoIgnore(
      accessToken,
      orgId,
      `/salesorders/${soId}/submit`,
      /already|submit|approv|cannot submit/i,
    );
    await postZohoIgnore(
      accessToken,
      orgId,
      `/salesorders/${soId}/approve`,
      /already|approv|cannot approve/i,
    );
    try {
      await zohoJson(accessToken, orgId, `/salesorders/${soId}/status/confirmed`, {
        method: 'POST',
        body: {},
      });
    } catch (retryErr) {
      if (isAlreadyConfirmedMessage(retryErr?.message)) return;
      throw retryErr;
    }
  }
}

export async function createSalesOrderFromDealerOrder(secrets, configuredOrgId, order) {
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  // order.locationId holds the Zoho warehouse_id for Cochin / Head Office.
  const warehouseId = order.locationId != null && String(order.locationId).trim()
    ? String(order.locationId).trim()
    : (order.warehouseId != null && String(order.warehouseId).trim()
      ? String(order.warehouseId).trim()
      : null);
  const lineItems = lineItemsFromOrder(order, warehouseId);
  if (!lineItems.length) {
    throw new Error('Order has no valid Zoho line items.');
  }

  const customerId = String(order.zohoCustomerId || '').trim();
  if (!customerId) throw new Error('Dealer is not linked to a Zoho customer.');

  // Zoho Inventory "notes" is the sales-order remarks field (UI: Customer Notes / Remarks).
  const dealerRemarks = String(order.remarks ?? order.notes ?? '').trim();
  const notes = dealerRemarks
    || `YesOne cart ${order.orderNumber || order.id}`;

  // Zoho Inventory creates SOs as Draft by default (Save as Draft).
  // Do not send location_id — multi-warehouse orgs reject it as an invalid element.
  const body = {
    customer_id: customerId,
    reference_number: String(order.orderNumber || order.id || ''),
    date: new Date().toISOString().slice(0, 10),
    line_items: lineItems,
    notes,
  };
  const salespersonId = String(order.salespersonId || '').trim();
  if (salespersonId) {
    body.salesperson_id = salespersonId;
  }
  if (order.shippingAddressId) {
    body.shipping_address_id = String(order.shippingAddressId);
  } else {
    const shipping = inlineShippingAddress(order.shippingAddressInline);
    if (shipping) body.shipping_address = shipping;
  }

  const attempts = uniqueSalesOrderCreateAttempts(body, order.shippingAddressInline);
  let payload = null;
  let lastErr = null;
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      payload = await zohoJson(accessToken, orgId, '/salesorders', {
        method: 'POST',
        body: attempts[i],
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (!isZohoNotAuthorized(err)) throw err;
      console.warn('Zoho sales order create not authorized', {
        attempt: i + 1,
        of: attempts.length,
        items: attempts[i].line_items.map(line => ({
          item_id: line.item_id,
          warehouse: Boolean(line.warehouse_id),
          hsn: line.hsn_or_sac || null,
        })),
        salesperson: Boolean(attempts[i].salesperson_id),
        shippingAddressId: Boolean(attempts[i].shipping_address_id),
      });
    }
  }
  if (lastErr) throw lastErr;

  const so = payload?.salesorder;
  if (!so?.salesorder_id) {
    throw new Error(payload?.message || 'Zoho did not return a sales order id.');
  }

  return {
    salesOrderId: String(so.salesorder_id),
    salesOrderNumber: so.salesorder_number ? String(so.salesorder_number) : null,
    status: so.status ? String(so.status) : 'draft',
    locationId: so.location_id != null && String(so.location_id).trim()
      ? String(so.location_id).trim()
      : warehouseId,
    warehouseId: (() => {
      const lineWh = Array.isArray(so.line_items)
        ? so.line_items.find(li => li?.warehouse_id != null && String(li.warehouse_id).trim())
          ?.warehouse_id
        : null;
      return lineWh != null && String(lineWh).trim() ? String(lineWh).trim() : warehouseId;
    })(),
    salespersonId: so.salesperson_id != null && String(so.salesperson_id).trim()
      ? String(so.salesperson_id).trim()
      : (salespersonId || null),
    salespersonName: so.salesperson_name ? String(so.salesperson_name).trim() || null : null,
  };
}

/**
 * Load a Zoho Inventory sales order by id.
 * @param {object} secrets
 * @param {string} configuredOrgId
 * @param {string} salesOrderId
 */
export async function fetchZohoSalesOrder(secrets, configuredOrgId, salesOrderId) {
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const existing = await zohoJson(accessToken, orgId, `/salesorders/${soId}`);
  return existing?.salesorder || null;
}

/**
 * Replace line items on a Draft Zoho Inventory sales order.
 * @param {object} secrets
 * @param {string} configuredOrgId
 * @param {string} salesOrderId
 * @param {Array<{ itemId: string, name?: string, rate?: number, quantity: number, unit?: string, hsn?: string|null }>} lines
 * @param {{ notes?: string, allowConfirmed?: boolean }} [options]
 */
export async function updateSalesOrderLines(secrets, configuredOrgId, salesOrderId, lines, options = {}) {
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');
  const lineItems = lineItemsFromOrder({ lines });
  if (!lineItems.length) {
    throw new Error('Sales order must have at least one line item.');
  }

  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const existing = await zohoJson(accessToken, orgId, `/salesorders/${soId}`);
  const so = existing?.salesorder;
  if (!so) throw new Error('Sales order not found in Zoho.');

  const status = String(so.status || '').toLowerCase().replace(/\s+/g, '_');
  if (status !== 'draft' && status !== 'pending' && !options.allowConfirmed) {
    throw new Error('Only Draft sales orders can be edited.');
  }

  const body = {
    customer_id: so.customer_id,
    reference_number: so.reference_number || '',
    date: so.date || new Date().toISOString().slice(0, 10),
    line_items: lineItems,
    notes: options.notes !== undefined ? String(options.notes ?? '') : (so.notes || ''),
  };
  if (so.salesperson_id) body.salesperson_id = so.salesperson_id;

  const payload = await zohoJson(accessToken, orgId, `/salesorders/${soId}`, {
    method: 'PUT',
    body,
  });
  const updated = payload?.salesorder;
  return {
    salesOrderId: soId,
    salesOrderNumber: updated?.salesorder_number
      ? String(updated.salesorder_number)
      : (so.salesorder_number ? String(so.salesorder_number) : null),
    status: updated?.status ? String(updated.status) : status,
  };
}

/**
 * Set / replace Zoho salesperson on a sales order (Draft or Confirmed).
 */
export async function setSalesOrderSalesperson(
  secrets,
  configuredOrgId,
  salesOrderId,
  { salespersonId, salespersonName = null } = {},
) {
  const soId = String(salesOrderId || '').trim();
  const spId = String(salespersonId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');
  if (!spId) throw new Error('Salesperson id is required.');

  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const existing = await zohoJson(accessToken, orgId, `/salesorders/${soId}`);
  const so = existing?.salesorder;
  if (!so) throw new Error('Sales order not found in Zoho.');

  const body = {
    customer_id: so.customer_id,
    reference_number: so.reference_number || '',
    date: so.date || new Date().toISOString().slice(0, 10),
    line_items: lineItemsForSalesOrderPut(so),
    notes: so.notes || '',
    salesperson_id: spId,
  };
  if (so.shipping_address_id) {
    body.shipping_address_id = so.shipping_address_id;
  }

  const payload = await zohoJson(accessToken, orgId, `/salesorders/${soId}`, {
    method: 'PUT',
    body,
  });
  const updated = payload?.salesorder;
  return {
    salesOrderId: soId,
    salespersonId: updated?.salesperson_id != null && String(updated.salesperson_id).trim()
      ? String(updated.salesperson_id).trim()
      : spId,
    salespersonName: updated?.salesperson_name
      ? String(updated.salesperson_name).trim() || null
      : (salespersonName ? String(salespersonName).trim() || null : null),
  };
}

/**
 * Update shipping address on a Draft/Pending Zoho sales order.
 * Prefer shipping_address_id (contact address); fall back to inline shipping_address.
 */
export async function updateSalesOrderShippingAddress(
  secrets,
  configuredOrgId,
  salesOrderId,
  { shippingAddressId = null, shippingAddressInline = null } = {},
) {
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');

  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const existing = await zohoJson(accessToken, orgId, `/salesorders/${soId}`);
  const so = existing?.salesorder;
  if (!so) throw new Error('Sales order not found in Zoho.');

  const status = String(so.status || '').toLowerCase().replace(/\s+/g, '_');
  if (status !== 'draft' && status !== 'pending') {
    throw new Error('Only Draft sales orders can change shipping address.');
  }

  const body = {
    customer_id: so.customer_id,
    reference_number: so.reference_number || '',
    date: so.date || new Date().toISOString().slice(0, 10),
    line_items: lineItemsForSalesOrderPut(so),
    notes: so.notes || '',
  };
  if (so.salesperson_id) body.salesperson_id = so.salesperson_id;
  if (shippingAddressId) {
    body.shipping_address_id = String(shippingAddressId);
  } else if (shippingAddressInline && typeof shippingAddressInline === 'object') {
    body.shipping_address = {
      attention: shippingAddressInline.attention || '',
      address: shippingAddressInline.address || '',
      street2: shippingAddressInline.street2 || '',
      city: shippingAddressInline.city || '',
      state: shippingAddressInline.state || '',
      zip: shippingAddressInline.zip || '',
      country: shippingAddressInline.country || 'India',
      phone: shippingAddressInline.phone || '',
    };
  } else {
    throw new Error('shippingAddressId or shippingAddressInline is required.');
  }

  const payload = await zohoJson(accessToken, orgId, `/salesorders/${soId}`, {
    method: 'PUT',
    body,
  });
  const updated = payload?.salesorder;
  return {
    salesOrderId: soId,
    salesOrderNumber: updated?.salesorder_number
      ? String(updated.salesorder_number)
      : (so.salesorder_number ? String(so.salesorder_number) : null),
    status: updated?.status ? String(updated.status) : status,
  };
}

/** Mark a Zoho Inventory sales order as Confirmed. */
export async function confirmSalesOrder(secrets, configuredOrgId, salesOrderId) {
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const existing = await zohoJson(accessToken, orgId, `/salesorders/${soId}`);
  let so = existing?.salesorder;
  if (!so) throw new Error('Sales order not found in Zoho.');

  const status = zohoStatusKey(so.status);
  if (['open', 'confirmed', 'invoiced', 'closed'].includes(status)) {
    return { salesOrderId: soId, status: status === 'open' ? 'confirmed' : status };
  }

  try {
    so = await stripServiceWarehousesOnSalesOrder(accessToken, orgId, so);
  } catch (err) {
    console.warn(
      `Could not strip service warehouses before confirm for SO ${soId}:`,
      err?.message || err,
    );
  }

  await confirmSalesOrderRequest(accessToken, orgId, soId);
  return { salesOrderId: soId, status: 'confirmed' };
}

/** Mark a Zoho Inventory sales order as Void. */
export async function voidSalesOrder(secrets, configuredOrgId, salesOrderId, reason = '') {
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const note = String(reason || '').trim().slice(0, 500);
  await zohoJson(accessToken, orgId, `/salesorders/${soId}/status/void`, {
    method: 'POST',
    body: note ? { reason: note } : {},
  });
  return { salesOrderId: soId, status: 'void' };
}

/** Permanently delete a Zoho Inventory sales order (Draft / eligible confirmed only). */
export async function deleteSalesOrder(secrets, configuredOrgId, salesOrderId) {
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  await zohoJson(accessToken, orgId, `/salesorders/${soId}`, {
    method: 'DELETE',
  });
  return { salesOrderId: soId, deleted: true };
}

/** Submit a draft SO for Zoho approval (only when Approvals are enabled in Zoho). */
export async function submitSalesOrderForApproval(secrets, configuredOrgId, salesOrderId) {
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  await zohoJson(accessToken, orgId, `/salesorders/${soId}/submit`, {
    method: 'POST',
    body: {},
  });
  return { salesOrderId: soId };
}

/** Approve a submitted Zoho sales order (Approvals feature). */
export async function approveSalesOrderInZoho(secrets, configuredOrgId, salesOrderId) {
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  await zohoJson(accessToken, orgId, `/salesorders/${soId}/approve`, {
    method: 'POST',
    body: {},
  });
  return { salesOrderId: soId };
}

/** Fetch a sales order PDF from Zoho (no Firestore mirror required). */
export async function downloadSalesOrderPdf(secrets, configuredOrgId, {
  salesOrderId,
  salesOrderNumber,
}) {
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');

  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const url = new URL(`${ZOHO_API_BASE}/salesorders/${soId}`);
  url.searchParams.set('organization_id', orgId);

  let res;
  try {
    res = await fetch(url.toString(), {
      headers: {
        ...authHeaders(accessToken, orgId),
        Accept: 'application/pdf',
      },
    });
  } catch (err) {
    recordZohoApiFailure(err);
    throw err;
  }

  recordZohoApiResponse(res, { operation: `salesorders/${soId}/pdf`, source: 'dealer-orders' });
  if (!res.ok) {
    const classified = classifyZohoHttpError(res.status, {});
    throw new Error(classified?.message || `Could not download sales order PDF (${res.status}).`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('PDF file is empty.');

  const number = String(salesOrderNumber || soId).replace(/[^\w.-]+/g, '_');
  return {
    contentBase64: buffer.toString('base64'),
    filename: `${number}.pdf`,
    mimeType: 'application/pdf',
  };
}

/**
 * Read the first invoice already linked to a Zoho sales order (if any).
 */
export async function getSalesOrderLinkedInvoice(secrets, configuredOrgId, salesOrderId) {
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');

  const soPayload = await zohoJson(accessToken, orgId, `/salesorders/${encodeURIComponent(soId)}`);
  const so = soPayload?.salesorder;
  if (!so) throw new Error('Could not load sales order from Zoho.');

  const invoices = Array.isArray(so.invoices) ? so.invoices : [];
  const first = invoices.find(row => row?.invoice_id) || null;
  if (!first) {
    return {
      status: so.order_status ? String(so.order_status) : (so.status ? String(so.status) : null),
      invoiceId: null,
      invoiceNumber: null,
    };
  }
  return {
    status: so.order_status ? String(so.order_status) : (so.status ? String(so.status) : null),
    invoiceId: String(first.invoice_id),
    invoiceNumber: first.invoice_number ? String(first.invoice_number) : null,
  };
}

/** Zoho invoice/SO shipping payload from a salesorder object. */
function shippingFieldsFromSalesOrder(so) {
  if (!so || typeof so !== 'object') return {};
  const addressId = so.shipping_address_id != null
    ? String(so.shipping_address_id).trim()
    : (so.shipping_address?.address_id != null
      ? String(so.shipping_address.address_id).trim()
      : '');
  if (addressId) return { shipping_address_id: addressId };

  const addr = so.shipping_address;
  if (!addr || typeof addr !== 'object') return {};
  const hasBody = Boolean(
    addr.address || addr.city || addr.state || addr.zip || addr.attention,
  );
  if (!hasBody) return {};
  return {
    shipping_address: {
      attention: addr.attention || '',
      address: addr.address || '',
      street2: addr.street2 || '',
      city: addr.city || '',
      state: addr.state || '',
      zip: addr.zip || '',
      country: addr.country || 'India',
      phone: addr.phone || '',
    },
  };
}

/**
 * Create an invoice linked to an existing sales order.
 * Tries convert-from-SO first, then falls back to invoice with salesorder_id.
 * Always copies SO shipping onto the invoice (convert does not reliably inherit it).
 */
export async function createInvoiceFromSalesOrder(secrets, configuredOrgId, {
  salesOrderId,
  customerId,
  referenceNumber,
  salespersonId = null,
}) {
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');
  const spId = String(salespersonId || '').trim();

  const loadSo = async () => {
    const soPayload = await zohoJson(accessToken, orgId, `/salesorders/${soId}`);
    const loaded = soPayload?.salesorder;
    if (!loaded) throw new Error('Could not load sales order from Zoho.');
    return loaded;
  };

  const linkedInvoiceFromSo = (order) => {
    const invoices = Array.isArray(order?.invoices) ? order.invoices : [];
    const first = invoices.find(row => row?.invoice_id) || null;
    if (!first) return null;
    return {
      invoiceId: String(first.invoice_id),
      invoiceNumber: first.invoice_number ? String(first.invoice_number) : null,
    };
  };

  let so = await loadSo();
  const already = linkedInvoiceFromSo(so);
  if (already) return already;

  try {
    so = await ensureServiceWarehousesStripped(accessToken, orgId, so);
  } catch (err) {
    console.warn(
      `Could not strip service warehouses before invoice for SO ${soId}:`,
      err?.message || err,
    );
  }

  const status = zohoStatusKey(so.status);
  if (!['open', 'confirmed', 'invoiced', 'closed'].includes(status)) {
    await confirmSalesOrderRequest(accessToken, orgId, soId);
    so = await loadSo();
    const afterConfirm = linkedInvoiceFromSo(so);
    if (afterConfirm) return afterConfirm;
  }

  const shippingFields = shippingFieldsFromSalesOrder(so);

  const patchConvertedInvoice = async (inv) => {
    const invoiceId = String(inv.invoice_id);
    const needsSalesperson = Boolean(spId && String(inv.salesperson_id || '').trim() !== spId);
    const needsShipping = Object.keys(shippingFields).length > 0;
    if (!needsSalesperson && !needsShipping) {
      return {
        invoiceId,
        invoiceNumber: inv.invoice_number ? String(inv.invoice_number) : null,
      };
    }
    try {
      await zohoJson(accessToken, orgId, `/invoices/${encodeURIComponent(invoiceId)}`, {
        method: 'PUT',
        body: {
          customer_id: inv.customer_id || so.customer_id,
          date: inv.date || so.date || new Date().toISOString().slice(0, 10),
          line_items: lineItemsForSalesOrderPut(inv, { keepGoodsWarehouse: true }),
          ...(needsSalesperson ? { salesperson_id: spId } : {}),
          ...(needsShipping ? shippingFields : {}),
        },
      });
    } catch (err) {
      console.warn(
        'Could not set salesperson/shipping on converted invoice:',
        err?.message || err,
      );
    }
    return {
      invoiceId,
      invoiceNumber: inv.invoice_number ? String(inv.invoice_number) : null,
    };
  };

  // Prefer convert endpoint when available. Do not send `{}` — Zoho treats an
  // empty JSON body as unauthorized on some orgs.
  try {
    const converted = await zohoJson(
      accessToken,
      orgId,
      `/invoices/fromsalesorder?salesorder_id=${encodeURIComponent(soId)}`,
      { method: 'POST' },
    );
    const inv = converted?.invoice;
    if (inv?.invoice_id) return patchConvertedInvoice(inv);
  } catch (convertErr) {
    so = await loadSo().catch(() => so);
    const linked = linkedInvoiceFromSo(so);
    if (linked) return linked;
    console.warn(
      `Convert SO ${soId} to invoice failed, trying create:`,
      convertErr?.message || convertErr,
    );
  }

  const linkedLineItems = invoiceLineItemsFromSalesOrder(so, { linkServiceLines: true });
  const goodsLinkedLineItems = invoiceLineItemsFromSalesOrder(so, { linkServiceLines: false });
  if (!linkedLineItems.length) {
    throw new Error('Sales order has no line items to invoice.');
  }

  const baseBody = {
    customer_id: String(customerId || so.customer_id || ''),
    reference_number: String(referenceNumber || so.reference_number || ''),
    date: new Date().toISOString().slice(0, 10),
    salesorder_id: soId,
  };
  const effectiveSp = spId || (so.salesperson_id != null ? String(so.salesperson_id).trim() : '');

  const { salesorder_id: _soLink, ...unlinkedBase } = baseBody;
  const unlinkedLineItems = stripSalesOrderItemIds(linkedLineItems);
  const unlinkedGoodsLineItems = stripSalesOrderItemIds(goodsLinkedLineItems);
  const salespersonFields = effectiveSp ? { salesperson_id: effectiveSp } : {};
  const attempts = [
    { ...baseBody, line_items: linkedLineItems, ...shippingFields, ...salespersonFields },
    { ...baseBody, line_items: linkedLineItems, ...shippingFields },
    { ...baseBody, line_items: linkedLineItems, ...salespersonFields },
    { ...baseBody, line_items: goodsLinkedLineItems, ...shippingFields, ...salespersonFields },
    { ...baseBody, line_items: goodsLinkedLineItems, ...salespersonFields },
    // Convert can report "no items to invoice" while the SO is still open. Creating
    // with salesorder_item_id then fails as "quantity … more than quantity ordered".
    // Retry without the line-item link so Zoho can still invoice the confirmed SO.
    { ...baseBody, line_items: unlinkedLineItems, ...shippingFields, ...salespersonFields },
    { ...baseBody, line_items: unlinkedLineItems, ...salespersonFields },
    { ...baseBody, line_items: unlinkedGoodsLineItems, ...salespersonFields },
    { ...unlinkedBase, line_items: linkedLineItems, ...shippingFields, ...salespersonFields },
    { ...unlinkedBase, line_items: linkedLineItems, ...salespersonFields },
  ];

  let lastErr = null;
  for (const body of attempts) {
    try {
      const payload = await zohoJson(accessToken, orgId, '/invoices', {
        method: 'POST',
        body,
      });
      const inv = payload?.invoice;
      if (inv?.invoice_id) {
        return {
          invoiceId: String(inv.invoice_id),
          invoiceNumber: inv.invoice_number ? String(inv.invoice_number) : null,
        };
      }
      lastErr = new Error(payload?.message || 'Zoho did not return an invoice id.');
    } catch (err) {
      lastErr = err;
      so = await loadSo().catch(() => so);
      const linked = linkedInvoiceFromSo(so);
      if (linked) return linked;
      const invoiced = String(so?.invoiced_status || '').toLowerCase();
      if (invoiced === 'invoiced' || invoiced === 'partially_invoiced') {
        throw new Error(
          'This sales order is already invoiced in Zoho, but YesOne could not read the invoice id. Use Mark as invoiced, or refresh and retry.',
        );
      }
      const message = String(err?.message || '');
      if (isAlreadyInvoicedQuantityMessage(message) || isZohoNotAuthorized(err)) continue;
      break;
    }
  }

  throw lastErr || new Error('Zoho did not return an invoice id.');
}

function invoiceAlreadySentMessage(message) {
  return /already (been )?sent|not (in )?draft|status is sent|has been sent/i.test(String(message ?? ''));
}

/**
 * Move a Zoho invoice out of Draft (portal payment confirmed).
 * No-ops if it is already sent. Approves first when Zoho requires it.
 */
export async function markInvoiceAsSent(secrets, configuredOrgId, invoiceId) {
  const id = String(invoiceId || '').trim();
  if (!id) throw new Error('Invoice id is required.');
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);

  const postSent = () => zohoJson(
    accessToken,
    orgId,
    `/invoices/${encodeURIComponent(id)}/status/sent`,
    { method: 'POST', body: {} },
  );

  try {
    await postSent();
    return { invoiceId: id, status: 'sent' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (invoiceAlreadySentMessage(message)) {
      return { invoiceId: id, status: 'sent' };
    }
    if (!/approv/i.test(message) && !isZohoNotAuthorized(err)) throw err;
    try {
      await zohoJson(
        accessToken,
        orgId,
        `/invoices/${encodeURIComponent(id)}/approve`,
        { method: 'POST' },
      );
    } catch (approveErr) {
      const approveMessage = approveErr instanceof Error ? approveErr.message : String(approveErr);
      if (
        !/already|approv/i.test(approveMessage)
        && !isZohoNotAuthorized(approveErr)
      ) throw approveErr;
    }
    try {
      await postSent();
      return { invoiceId: id, status: 'sent' };
    } catch (sentErr) {
      const sentMessage = sentErr instanceof Error ? sentErr.message : String(sentErr);
      if (invoiceAlreadySentMessage(sentMessage)) {
        return { invoiceId: id, status: 'sent' };
      }
      throw sentErr;
    }
  }
}

function einvoicePushLooksLikeInvalidBody(err) {
  return /json|invalid|unknown|parameter|unrecognized|not (a )?valid|unexpected/i.test(
    String(err?.message ?? ''),
  );
}

/**
 * Push an invoice's e-invoice to the IRP (Zoho "Push to IRP").
 * Invoice / IRN only — never generate or push e-way bill details.
 * Logistics generates the e-way bill later via Generate e-way bill.
 * Only succeeds for GST-registered B2B customers.
 */
export async function pushInvoiceEinvoiceToIrp(secrets, configuredOrgId, invoiceId) {
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const id = String(invoiceId || '').trim();
  if (!id) throw new Error('Invoice id is required.');

  const path = `/invoices/${encodeURIComponent(id)}/einvoice/push`;
  const skipEway = { generate_ewaybill: false, push_ewaybill: false };
  let payload;
  try {
    payload = await zohoJson(accessToken, orgId, path, {
      method: 'POST',
      body: skipEway,
    });
  } catch (err) {
    if (!einvoicePushLooksLikeInvalidBody(err)) throw err;
    payload = await zohoJson(
      accessToken,
      orgId,
      `${path}?generate_ewaybill=false`,
      { method: 'POST' },
    );
  }

  return {
    invoiceId: id,
    message: payload?.message ? String(payload.message) : 'success',
    code: payload?.code ?? 0,
  };
}

