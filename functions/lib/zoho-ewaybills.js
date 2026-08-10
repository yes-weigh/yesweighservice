/**
 * Zoho Inventory e-Way Bill API (India edition).
 */
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
} from './zoho-api-usage.js';

function formatZohoApiError(payload, fallback) {
  const parts = [];
  const message = String(payload?.message ?? '').trim();
  if (message) parts.push(message);
  if (Array.isArray(payload?.error_info)) {
    for (const item of payload.error_info) {
      const text = String(item ?? '').trim();
      if (text) parts.push(text);
    }
  }
  return parts.filter(Boolean).join(' ') || fallback;
}

async function zohoJson(accessToken, orgId, path, { method = 'GET', body, query = {} } = {}) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  if (!url.searchParams.has('organization_id')) {
    url.searchParams.set('organization_id', orgId);
  }
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
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
    throw new Error(formatZohoApiError(payload, classified?.message || `Zoho request failed (${res.status}).`));
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(formatZohoApiError(payload, 'Zoho API error.'));
  }
  return payload;
}

function normalizeGstin(value) {
  const text = String(value ?? '').trim().toUpperCase();
  return /^[0-9A-Z]{15}$/.test(text) ? text : '';
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isGeneratedEwayStatus(status) {
  const value = String(status ?? '').trim().toLowerCase();
  if (!value || value === 'yet_to_generate' || value === 'not_generated') return false;
  if (value === 'cancelled' || value === 'excluded') return false;
  return true;
}

function normalizeMappedEwayStatus(status) {
  const value = String(status ?? '').trim().toLowerCase();
  if (value === 'cancelled') return 'cancelled';
  if (!value || value === 'yet_to_generate' || value === 'not_generated') return 'missing';
  if (value.includes('generated')) return 'generated';
  return value;
}

async function fetchZohoInvoice(accessToken, orgId, invoiceId) {
  const id = String(invoiceId ?? '').trim();
  if (!id) return null;
  const payload = await zohoJson(accessToken, orgId, `/invoices/${encodeURIComponent(id)}`);
  return payload?.invoice ?? null;
}

async function fetchZohoEwayBillRecord(accessToken, orgId, ewaybillId) {
  const id = String(ewaybillId ?? '').trim();
  if (!id) return null;
  const payload = await zohoJson(accessToken, orgId, `/ewaybills/${encodeURIComponent(id)}`);
  return payload?.ewaybill ?? null;
}

async function resolveEwayDistanceKm(accessToken, orgId, invoice, explicitDistance) {
  const explicit = Number(explicitDistance);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }

  const ewaybillId = invoice?.ewaybill_id ? String(invoice.ewaybill_id) : '';
  if (ewaybillId) {
    try {
      const stub = await fetchZohoEwayBillRecord(accessToken, orgId, ewaybillId);
      const fromStub = Number(stub?.distance);
      if (Number.isFinite(fromStub) && fromStub > 0) {
        return Math.round(fromStub);
      }
    } catch {
      // Fall through to actionable error below.
    }
  }

  throw new Error(
    'Distance (km) is required for e-way bill generation. Open the invoice in Zoho Inventory, confirm dispatch-from and shipping addresses, save once in Zoho so distance is calculated, then retry.',
  );
}

/**
 * @param {string} partnerId Logistics partner id from booking.
 * @returns {string}
 */
export function deliveryPartnerTabForLogisticsPartner(partnerId) {
  const id = String(partnerId ?? '').trim();
  if (id.startsWith('bluedart_')) return 'bluedart';
  if (id.startsWith('trackon_')) return 'trackon';
  return id;
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 */
export async function loadPartnerGstin(db, partnerId) {
  const tab = deliveryPartnerTabForLogisticsPartner(partnerId);
  const snap = await db.doc('appSettings/logisticsSettings').get();
  const raw = snap.data()?.partnerGstins;
  if (!raw || typeof raw !== 'object') return '';
  return normalizeGstin(raw[tab]);
}

async function loadPartnerEwaySettings(db, partnerId) {
  const tab = deliveryPartnerTabForLogisticsPartner(partnerId);
  const snap = await db.doc('appSettings/logisticsSettings').get();
  const data = snap.data() ?? {};
  const gstinRaw = data.partnerGstins;
  const transporterRaw = data.partnerTransporters?.[tab];
  let transporter = null;
  if (transporterRaw && typeof transporterRaw === 'object') {
    const id = String(transporterRaw.id ?? '').trim();
    const name = String(transporterRaw.name ?? '').trim();
    if (id && name) {
      transporter = { id, name };
    }
  }
  return {
    gstin: gstinRaw && typeof gstinRaw === 'object'
      ? normalizeGstin(gstinRaw[tab])
      : '',
    transporter,
  };
}

/**
 * @param {string} accessToken
 * @param {string} orgId
 */
export async function listZohoTransporters(accessToken, orgId) {
  const payload = await zohoJson(accessToken, orgId, '/ewaybills/transporters');
  const rows = Array.isArray(payload?.transporters) ? payload.transporters : [];
  return rows
    .map(row => ({
      id: String(row?.transporter_id ?? '').trim(),
      name: String(row?.transporter_name ?? '').trim(),
      gstin: normalizeGstin(row?.transporter_registration_id) || null,
    }))
    .filter(row => row.id && row.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Prefer the transporter configured in logistics settings; fall back to GSTIN lookup/create.
 * @param {import('firebase-admin/firestore').Firestore} db
 */
export async function resolveTransporterForPartner(accessToken, orgId, db, partnerId) {
  const settings = await loadPartnerEwaySettings(db, partnerId);
  if (settings.transporter?.id) {
    return {
      transporterId: settings.transporter.id,
      transporterName: settings.transporter.name,
    };
  }

  const transporterName = partnerLabel(partnerId) || partnerId;
  if (!settings.gstin) {
    throw new Error(
      'No Zoho transporter is linked to this delivery partner. '
      + 'Open Settings → Logistics → Delivery Partners, pick the Zoho transporter '
      + `(e.g. ${transporterName}), save, then retry.`,
    );
  }
  const transporterId = await resolveZohoTransporterId(
    accessToken,
    orgId,
    settings.gstin,
    transporterName,
  );
  return { transporterId, transporterName };
}

function partnerLabel(partnerId) {
  const labels = {
    delhivery: 'Delhivery',
    st_courier: 'ST Courier',
    bluedart: 'Blue Dart',
    trackon: 'Trackon',
    dtdc: 'DTDC',
    ecosafe: 'Ecosafe',
    aps: 'APS',
    personal_collection: 'Customer Pickup',
    own_vehicle: 'Own vehicle',
  };
  const id = String(partnerId ?? '');
  if (labels[id]) return labels[id];
  if (id.startsWith('bluedart_')) return 'Blue Dart';
  if (id.startsWith('trackon_')) return 'Trackon';
  return id || 'Courier';
}

/**
 * @param {string} accessToken
 * @param {string} orgId
 * @param {string} gstin
 * @param {string} name
 */
export async function resolveZohoTransporterId(accessToken, orgId, gstin, name) {
  const registrationId = normalizeGstin(gstin);
  if (!registrationId) {
    throw new Error(
      'Delivery partner GSTIN is not configured. '
      + 'Set a Zoho transporter (preferred) or GSTIN under Settings → Logistics → Delivery Partners.',
    );
  }

  const listed = await zohoJson(accessToken, orgId, '/ewaybills/transporters');
  const rows = Array.isArray(listed?.transporters) ? listed.transporters : [];
  const existing = rows.find(row => (
    normalizeGstin(row?.transporter_registration_id) === registrationId
  ));
  if (existing?.transporter_id) {
    return String(existing.transporter_id);
  }

  const created = await zohoJson(accessToken, orgId, '/ewaybills/transporters', {
    method: 'POST',
    body: {
      transporter_name: String(name || 'Courier').trim() || 'Courier',
      transporter_registration_id: registrationId,
    },
  });
  const transporterId = created?.transporter?.transporter_id;
  if (!transporterId) {
    throw new Error('Zoho did not return a transporter id.');
  }
  return String(transporterId);
}

/**
 * Look up a generated e-way bill via the invoice record.
 * Note: GET /ewaybills?entity_type=invoice returns "Invalid Entity Type" for this org,
 * so we read invoice.ewaybill_id and fetch the e-way bill directly.
 *
 * @param {string} accessToken
 * @param {string} orgId
 * @param {string} invoiceId
 */
export async function findZohoEwayBillForInvoice(accessToken, orgId, invoiceId) {
  const id = String(invoiceId ?? '').trim();
  if (!id) return null;

  const invoice = await fetchZohoInvoice(accessToken, orgId, id);
  if (!invoice) return null;

  const ewaybillId = invoice.ewaybill_id ? String(invoice.ewaybill_id) : '';
  if (!ewaybillId) return null;

  const invoiceStatus = String(invoice.ewaybill_status ?? '').toLowerCase();
  if (!isGeneratedEwayStatus(invoiceStatus)) {
    return null;
  }

  try {
    const record = await fetchZohoEwayBillRecord(accessToken, orgId, ewaybillId);
    if (String(record?.ewaybill_status ?? '').toLowerCase() === 'cancelled') {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

/**
 * @param {string} accessToken
 * @param {string} orgId
 * @param {{
 *   invoiceId: string;
 *   transporterId: string;
 *   lrNumber?: string | null;
 *   distance?: number | null;
 * }} input
 */
export async function createZohoEwayBillForInvoice(accessToken, orgId, input) {
  const invoiceId = String(input.invoiceId ?? '').trim();
  if (!invoiceId) throw new Error('Invoice id is required.');

  const invoice = await fetchZohoInvoice(accessToken, orgId, invoiceId);
  if (!invoice) throw new Error('Invoice not found in Zoho.');

  const invoiceEwayStatus = String(invoice.ewaybill_status ?? '').trim().toLowerCase();
  const lr = String(input.lrNumber ?? '').trim();
  const distance = await resolveEwayDistanceKm(accessToken, orgId, invoice, input.distance);
  const shipToAddressId = invoice.shipping_address?.address_id
    ?? invoice.shipping_address_id
    ?? null;

  const body = {
    entity_id: invoiceId,
    entity_type: 'invoice',
    action: 'save_generate',
    transportation_mode: 'road',
    transporter_id: String(input.transporterId),
    sub_supply_type: 'supply',
    transaction_type: 'regular',
    distance,
    transporter_document_date: todayIsoDate(),
    ...(invoice.branch_id ? { branch_id: String(invoice.branch_id) } : {}),
    ...(invoice.location_id ? { location_id: String(invoice.location_id) } : {}),
    ...(shipToAddressId ? { ship_to_address_id: String(shipToAddressId) } : {}),
    ...(lr ? { transporter_document_number: lr.slice(0, 30) } : {}),
  };

  try {
    const payload = await zohoJson(accessToken, orgId, '/ewaybills', {
      method: 'POST',
      body,
    });
    return payload?.ewaybill ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(message) && invoice.ewaybill_id) {
      const record = await fetchZohoEwayBillRecord(accessToken, orgId, String(invoice.ewaybill_id));
      if (String(record?.ewaybill_status ?? '').toLowerCase() !== 'cancelled') {
        return record;
      }
    }
    if (invoiceEwayStatus === 'cancelled' || /cancel/i.test(message)) {
      throw new Error(
        'This invoice\'s previous e-way bill was cancelled in Zoho. '
        + 'Open the invoice in Zoho Inventory → E-Way Bill → generate a new bill there, then retry.',
      );
    }
    throw err;
  }
}

/**
 * @param {string} accessToken
 * @param {string} orgId
 * @param {string} ewaybillId
 */
export async function fetchZohoEwayBillPdf(accessToken, orgId, ewaybillId) {
  const id = String(ewaybillId ?? '').trim();
  if (!id) throw new Error('E-way bill id is required.');

  const url = new URL(`${ZOHO_API_BASE}/ewaybills/${encodeURIComponent(id)}`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('print', 'true');

  const res = await fetch(url.toString(), {
    headers: {
      ...authHeaders(accessToken, orgId),
      Accept: 'application/pdf,application/json,text/html,*/*',
    },
  });
  await recordZohoApiResponse(res.status, `/ewaybills/${id}?print=true`);

  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    const classified = classifyZohoHttpError(res.status, payload);
    throw new Error(formatZohoApiError(payload, classified?.message || `Could not download e-way bill (${res.status}).`));
  }

  const contentType = String(res.headers.get('content-type') ?? '').toLowerCase();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('E-way bill file is empty.');

  if (contentType.includes('pdf') || buffer.slice(0, 4).toString() === '%PDF') {
    return { buffer, mimeType: 'application/pdf', extension: 'pdf' };
  }

  const text = buffer.toString('utf8');
  try {
    const json = JSON.parse(text);
    const html = json?.print_html || json?.html || json?.data;
    if (typeof html === 'string' && html.trim()) {
      return { buffer: Buffer.from(html, 'utf8'), mimeType: 'text/html', extension: 'html' };
    }
  } catch {
    // fall through
  }

  if (text.includes('<html')) {
    return { buffer, mimeType: 'text/html', extension: 'html' };
  }

  throw new Error('Unexpected e-way bill print response from Zoho.');
}

export function mapZohoEwayBillRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const number = String(
    raw.ewaybill_number
    ?? raw.eway_bill_number
    ?? '',
  ).trim();
  return {
    zohoEwaybillId: raw.ewaybill_id ? String(raw.ewaybill_id) : null,
    ewaybillNumber: number || null,
    status: normalizeMappedEwayStatus(raw.ewaybill_status),
    generatedAt: raw.ewaybill_date ? String(raw.ewaybill_date) : null,
    expiryDate: raw.ewaybill_expiry_date ? String(raw.ewaybill_expiry_date) : null,
    transporterGstin: normalizeGstin(raw.transporter_registration_id) || null,
    pdfPrintAllowed: raw.can_allow_print_ewaybill !== false,
  };
}

export { normalizeGstin };

/**
 * Cancel a generated e-way bill on the GST portal via Zoho.
 * @param {{ reason: string; remarks?: string | null }} input
 */
export async function cancelZohoEwayBill(accessToken, orgId, ewaybillId, input) {
  const id = String(ewaybillId ?? '').trim();
  if (!id) throw new Error('E-way bill id is required.');

  const reason = String(input?.reason ?? '').trim();
  const allowed = new Set(['duplicate', 'order_cancelled', 'data_entry_mistake', 'others']);
  if (!allowed.has(reason)) {
    throw new Error('Select a valid cancellation reason.');
  }

  const remarks = String(input?.remarks ?? '').trim().slice(0, 50);
  const body = {
    reason,
    ...(remarks ? { remarks } : {}),
  };

  const payload = await zohoJson(
    accessToken,
    orgId,
    `/ewaybills/${encodeURIComponent(id)}/cancel`,
    { method: 'POST', body },
  );
  return payload?.ewaybill ?? payload;
}
