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
    ...(line.description ? { description: String(line.description) } : {}),
    ...(line.hsn ? { hsn_or_sac: String(line.hsn) } : {}),
  })).filter(line => line.quantity > 0 && line.item_id);
}

/** Writable line fields only — Zoho GET payloads include read-only keys that break PUT. */
function lineItemsForSalesOrderPut(so) {
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
    return line;
  }).filter(line => line.item_id && Number(line.quantity) > 0);
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

  // Zoho Inventory "notes" is the sales-order remarks field (UI: Customer Notes / Remarks).
  const dealerRemarks = String(order.remarks ?? order.notes ?? '').trim();
  const notes = dealerRemarks
    || `YesOne cart ${order.orderNumber || order.id}`;

  // Zoho Inventory creates SOs as Draft by default (Save as Draft).
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
  } else if (order.shippingAddressInline && typeof order.shippingAddressInline === 'object') {
    body.shipping_address = {
      attention: order.shippingAddressInline.attention || '',
      address: order.shippingAddressInline.address || '',
      street2: order.shippingAddressInline.street2 || '',
      city: order.shippingAddressInline.city || '',
      state: order.shippingAddressInline.state || '',
      zip: order.shippingAddressInline.zip || '',
      country: order.shippingAddressInline.country || 'India',
      phone: order.shippingAddressInline.phone || '',
    };
  }

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
    status: so.status ? String(so.status) : 'draft',
    salespersonId: so.salesperson_id != null && String(so.salesperson_id).trim()
      ? String(so.salesperson_id).trim()
      : (salespersonId || null),
    salespersonName: so.salesperson_name ? String(so.salesperson_name).trim() || null : null,
  };
}

/**
 * Replace line items on a Draft Zoho Inventory sales order.
 * @param {object} secrets
 * @param {string} configuredOrgId
 * @param {string} salesOrderId
 * @param {Array<{ itemId: string, name?: string, rate?: number, quantity: number, unit?: string, hsn?: string|null }>} lines
 */
export async function updateSalesOrderLines(secrets, configuredOrgId, salesOrderId, lines) {
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
  if (status !== 'draft' && status !== 'pending') {
    throw new Error('Only Draft sales orders can be edited.');
  }

  const body = {
    customer_id: so.customer_id,
    reference_number: so.reference_number || '',
    date: so.date || new Date().toISOString().slice(0, 10),
    line_items: lineItems,
    notes: so.notes || '',
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
  await zohoJson(accessToken, orgId, `/salesorders/${soId}/status/confirmed`, {
    method: 'POST',
    body: {},
  });
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

/**
 * Create an invoice linked to an existing sales order.
 * Tries convert-from-SO first, then falls back to invoice with salesorder_id.
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

  // Prefer convert endpoint when available (inherits SO salesperson when set on SO).
  try {
    const converted = await zohoJson(
      accessToken,
      orgId,
      `/invoices/fromsalesorder?salesorder_id=${encodeURIComponent(soId)}`,
      { method: 'POST', body: {} },
    );
    const inv = converted?.invoice;
    if (inv?.invoice_id) {
      const invoiceId = String(inv.invoice_id);
      // Ensure salesperson on invoice when convert did not copy it.
      if (spId && String(inv.salesperson_id || '').trim() !== spId) {
        try {
          await zohoJson(accessToken, orgId, `/invoices/${encodeURIComponent(invoiceId)}`, {
            method: 'PUT',
            body: {
              customer_id: inv.customer_id,
              date: inv.date,
              line_items: Array.isArray(inv.line_items) ? inv.line_items : [],
              salesperson_id: spId,
            },
          });
        } catch (err) {
          console.warn('Could not set salesperson on converted invoice:', err?.message || err);
        }
      }
      return {
        invoiceId,
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
  const effectiveSp = spId || (so.salesperson_id != null ? String(so.salesperson_id).trim() : '');
  if (effectiveSp) body.salesperson_id = effectiveSp;

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

/**
 * Push an invoice's e-invoice to the IRP (Zoho "Push to IRP").
 * Only succeeds for GST-registered B2B customers.
 */
export async function pushInvoiceEinvoiceToIrp(secrets, configuredOrgId, invoiceId) {
  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const id = String(invoiceId || '').trim();
  if (!id) throw new Error('Invoice id is required.');

  const payload = await zohoJson(
    accessToken,
    orgId,
    `/invoices/${encodeURIComponent(id)}/einvoice/push`,
    { method: 'POST' },
  );

  return {
    invoiceId: id,
    message: payload?.message ? String(payload.message) : 'success',
    code: payload?.code ?? 0,
  };
}

