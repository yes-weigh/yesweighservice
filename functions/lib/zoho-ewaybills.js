/**
 * Zoho Inventory e-Way Bill API (India edition).
 */
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
} from './zoho-api-usage.js';

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
    const message = payload?.message
      || payload?.code
      || classified?.message
      || `Zoho request failed (${res.status})`;
    throw new Error(message);
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload?.message || 'Zoho API error.');
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

/**
 * @param {string} accessToken
 * @param {string} orgId
 * @param {string} gstin
 * @param {string} name
 */
export async function resolveZohoTransporterId(accessToken, orgId, gstin, name) {
  const registrationId = normalizeGstin(gstin);
  if (!registrationId) {
    throw new Error('Delivery partner GSTIN is not configured. Set it under Logistics → Delivery Partners.');
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
 * @param {string} accessToken
 * @param {string} orgId
 * @param {string} invoiceId
 */
export async function findZohoEwayBillForInvoice(accessToken, orgId, invoiceId) {
  const id = String(invoiceId ?? '').trim();
  if (!id) return null;
  const payload = await zohoJson(accessToken, orgId, '/ewaybills', {
    query: {
      entity_type: 'invoice',
      entity_ids: id,
      per_page: 5,
    },
  });
  const rows = Array.isArray(payload?.ewaybills) ? payload.ewaybills : [];
  const match = rows.find(row => (
    String(row?.entity_id ?? '') === id
    && String(row?.ewaybill_status ?? '').toLowerCase() !== 'cancelled'
  ));
  return match ?? rows[0] ?? null;
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

  const lr = String(input.lrNumber ?? '').trim();
  const body = {
    entity_id: invoiceId,
    entity_type: 'invoice',
    action: 'save_generate',
    transportation_mode: 'road',
    transporter_id: String(input.transporterId),
    sub_supply_type: 'supply',
    ...(lr ? { transporter_document_number: lr.slice(0, 30) } : {}),
    transporter_document_date: todayIsoDate(),
    ...(Number.isFinite(Number(input.distance)) && Number(input.distance) > 0
      ? { distance: Math.round(Number(input.distance)) }
      : {}),
  };

  const payload = await zohoJson(accessToken, orgId, '/ewaybills', {
    method: 'POST',
    body,
  });
  return payload?.ewaybill ?? null;
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
    throw new Error(payload?.message || classified?.message || `Could not download e-way bill (${res.status}).`);
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
    status: String(raw.ewaybill_status ?? 'generated').toLowerCase(),
    generatedAt: raw.ewaybill_date ? String(raw.ewaybill_date) : null,
    expiryDate: raw.ewaybill_expiry_date ? String(raw.ewaybill_expiry_date) : null,
    transporterGstin: normalizeGstin(raw.transporter_registration_id) || null,
    pdfPrintAllowed: Boolean(raw.can_allow_print_ewaybill),
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
