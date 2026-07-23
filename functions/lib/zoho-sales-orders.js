/**
 * Create Zoho Inventory sales orders and invoices from portal dealer orders.
 */
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
} from './zoho-api-usage.js';

async function zohoJson(accessToken, orgId, path, { method = 'GET', body } = {}) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  if (!url.searchParams.has('organization_id')) {
    url.searchParams.set('organization_id', orgId);
  }

  const init = {
    method,
    headers: {
      ...authHeaders(accessToken, orgId),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
  };
  if (body) init.body = JSON.stringify(body);

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

function lineItemsFromOrder(order) {
  const lines = Array.isArray(order.lines) ? order.lines : [];
  return lines.map(line => ({
    item_id: String(line.itemId || line.productId),
    name: String(line.name || 'Item'),
    rate: Number(line.rate || 0),
    quantity: Number(line.quantity || 0),
    unit: String(line.unit || 'pcs'),
    ...(line.hsn ? { hsn_or_sac: String(line.hsn) } : {}),
  })).filter(line => line.quantity > 0 && line.item_id);
}

export async function createSalesOrderFromDealerOrder(secrets, configuredOrgId, order) {
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const lineItems = lineItemsFromOrder(order);
  if (!lineItems.length) {
    throw new Error('Order has no valid Zoho line items.');
  }

  const customerId = String(order.zohoCustomerId || '').trim();
  if (!customerId) throw new Error('Dealer is not linked to a Zoho customer.');

  const body = {
    customer_id: customerId,
    reference_number: String(order.orderNumber || order.id || ''),
    date: new Date().toISOString().slice(0, 10),
    line_items: lineItems,
    notes: `Portal order ${order.orderNumber || order.id}`,
  };

  const payload = await zohoJson(accessToken, orgId, '/salesorders', {
    method: 'POST',
    body,
  });

  const so = payload?.salesorder;
  if (!so?.salesorder_id) {
    throw new Error(payload?.message || 'Zoho did not return a sales order id.');
  }

  return {
    salesOrderId: String(so.salesorder_id),
    salesOrderNumber: so.salesorder_number ? String(so.salesorder_number) : null,
  };
}

/**
 * Create an invoice linked to an existing sales order.
 * Tries convert-from-SO first, then falls back to invoice with salesorder_id.
 */
export async function createInvoiceFromSalesOrder(secrets, configuredOrgId, {
  salesOrderId,
  customerId,
  referenceNumber,
}) {
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new Error('Sales order id is required.');

  // Prefer convert endpoint when available.
  try {
    const converted = await zohoJson(
      accessToken,
      orgId,
      `/invoices/fromsalesorder?salesorder_id=${encodeURIComponent(soId)}`,
      { method: 'POST', body: {} },
    );
    const inv = converted?.invoice;
    if (inv?.invoice_id) {
      return {
        invoiceId: String(inv.invoice_id),
        invoiceNumber: inv.invoice_number ? String(inv.invoice_number) : null,
      };
    }
  } catch {
    // Fall through to create-from-SO details.
  }

  const soPayload = await zohoJson(accessToken, orgId, `/salesorders/${soId}`);
  const so = soPayload?.salesorder;
  if (!so) throw new Error('Could not load sales order from Zoho.');

  const lineItems = (Array.isArray(so.line_items) ? so.line_items : []).map(item => ({
    item_id: item.item_id,
    name: item.name,
    rate: item.rate,
    quantity: item.quantity,
    unit: item.unit,
    salesorder_item_id: item.line_item_id,
  }));

  if (!lineItems.length) {
    throw new Error('Sales order has no line items to invoice.');
  }

  const body = {
    customer_id: String(customerId || so.customer_id || ''),
    reference_number: String(referenceNumber || so.reference_number || ''),
    date: new Date().toISOString().slice(0, 10),
    line_items: lineItems,
    salesorder_id: soId,
  };

  const payload = await zohoJson(accessToken, orgId, '/invoices', {
    method: 'POST',
    body,
  });

  const inv = payload?.invoice;
  if (!inv?.invoice_id) {
    throw new Error(payload?.message || 'Zoho did not return an invoice id.');
  }

  return {
    invoiceId: String(inv.invoice_id),
    invoiceNumber: inv.invoice_number ? String(inv.invoice_number) : null,
  };
}
