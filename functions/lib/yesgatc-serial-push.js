/**
 * YesOne → YesGATC serial allotment webhook.
 * POSTs newly added (or pending) ranges to the destination URL on the Serial numbers page.
 */
import { fetch as undiciFetch } from 'undici';
import { getFirestore } from 'firebase-admin/firestore';
import { loadWebhookSecret } from './yesgatc-webhook.js';

export const SERIAL_NUMBER_ALLOTMENT_DOC = 'appSettings/serialNumberAllotment';

const SERIES_LABELS = {
  gatc_50kg: '50Kg GATC',
  gatc_sl: 'Sl printed GATC',
  non_gatc: 'non GATC',
};

export function isInboundYesOneWebhookUrl(raw) {
  const text = str(raw);
  if (!text) return false;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    return (host === 'yesweigh-service.web.app' || host === 'yesweigh-service.firebaseapp.com')
      && url.pathname.toLowerCase().includes('/webhooks');
  } catch {
    return /yesweigh-service\.(web\.app|firebaseapp\.com).*\/webhooks/i.test(text);
  }
}

export function outboundYesGatcWebhookUrl(raw) {
  try {
    const normalized = raw ? normalizeHttpsWebhookUrl(raw) : '';
    if (!normalized || isInboundYesOneWebhookUrl(normalized)) return '';
    return normalized;
  } catch {
    return '';
  }
}

export async function resolveYesGatcWebhookUrl(preferred = '') {
  const db = getFirestore();
  const direct = outboundYesGatcWebhookUrl(preferred);
  if (direct) return direct;
  const allotSnap = await db.doc(SERIAL_NUMBER_ALLOTMENT_DOC).get();
  return outboundYesGatcWebhookUrl(allotSnap.exists ? allotSnap.data()?.webhookUrl : '');
}

export function normalizeHttpsWebhookUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error('Enter a valid webhook URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use https.');
  }
  return parsed.toString();
}

function str(value) {
  return value == null ? '' : String(value).trim();
}

function allotmentId(row) {
  return str(row?.id);
}

export function isAllotmentPending(row) {
  return Boolean(allotmentId(row) && !str(row?.pushedAt));
}

export function serializeAllotmentForWebhook(row) {
  const series = str(row?.series) || 'non_gatc';
  const invoiceLinks = Array.isArray(row?.invoiceLinks)
    ? row.invoiceLinks.map(link => ({
      rcCode: str(link?.rcCode) || null,
      rcName: str(link?.rcName) || null,
      invoiceId: str(link?.invoiceId) || null,
      invoiceNumber: str(link?.invoiceNumber) || null,
      invoiceDate: str(link?.invoiceDate || link?.date) || null,
      qty: Math.max(0, Number(link?.qty) || 0),
      startNumber: str(link?.startNumber || link?.from) || null,
      endNumber: str(link?.endNumber || link?.to) || null,
      serialNumbers: Array.isArray(link?.serialNumbers)
        ? link.serialNumbers.map(item => str(item)).filter(Boolean)
        : [],
    }))
    : [];
  return {
    id: allotmentId(row),
    series,
    seriesLabel: SERIES_LABELS[series] || series,
    from: str(row?.from),
    to: str(row?.to),
    missing: Array.isArray(row?.missing) ? row.missing.map(item => str(item)).filter(Boolean) : [],
    count: Math.max(0, Number(row?.count) || 0),
    createdAt: str(row?.createdAt) || null,
    createdBy: str(row?.createdBy) || null,
    sku: str(row?.sku) || null,
    productName: str(row?.productName) || null,
    imageUrl: str(row?.imageUrl) || null,
    sourcePoNumber: str(row?.sourcePoNumber) || null,
    invoiceLinks,
    qty: Math.max(0, Number(row?.count) || 0),
  };
}

function pickRows(allotments, mode, ids) {
  const rows = Array.isArray(allotments) ? allotments.filter(row => allotmentId(row)) : [];
  if (mode === 'ids') {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(id => str(id)).filter(Boolean));
    return rows.filter(row => wanted.has(allotmentId(row)));
  }
  return rows.filter(isAllotmentPending);
}

export async function postYesGatcWebhook(url, secret, payload) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (secret) {
    headers['x-yesgatc-secret'] = secret;
    headers['x-yesweigh-secret'] = secret;
    headers['x-webhook-secret'] = secret;
    headers.authorization = `Bearer ${secret}`;
  }

  const response = await undiciFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const message = body?.message || body?.error || text || `HTTP ${response.status}`;
    throw new Error(`YesGATC webhook failed: ${message}`);
  }
  return body;
}

function markPushResult(allotments, sentIds, error) {
  const sent = new Set(sentIds);
  const pushedAt = error ? null : new Date().toISOString();
  const pushError = error ? String(error).slice(0, 400) : null;
  return (Array.isArray(allotments) ? allotments : []).map(row => {
    if (!sent.has(allotmentId(row))) return row;
    return {
      ...row,
      pushedAt: error ? (str(row?.pushedAt) || null) : pushedAt,
      pushError,
    };
  });
}

export async function pushSerialAllotmentsToYesGatc({
  mode = 'test',
  ids = [],
  webhookUrl = '',
  actorName = 'YESWEIGH',
} = {}) {
  const db = getFirestore();
  const ref = db.doc(SERIAL_NUMBER_ALLOTMENT_DOC);
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const allotments = Array.isArray(data.allotments) ? data.allotments : [];

  const nextUrl = await resolveYesGatcWebhookUrl(webhookUrl);
  const storedUrl = await resolveYesGatcWebhookUrl(data.webhookUrl);
  const endpoint = nextUrl || storedUrl;
  if (endpoint && endpoint !== outboundYesGatcWebhookUrl(data.webhookUrl)) {
    await ref.set({
      webhookUrl: endpoint,
      updatedAt: new Date().toISOString(),
      updatedBy: str(actorName) || 'YESWEIGH',
    }, { merge: true });
  }

  if (!endpoint) {
    throw new Error('Paste the YesGATC webhook URL first.');
  }

  const kind = String(mode || 'test').trim() === 'ids' ? 'ids' : 'test';
  const selected = pickRows(allotments, kind, ids);
  const secret = await loadWebhookSecret();
  const payload = {
    event: 'serial_allotment',
    source: 'yesone',
    test: kind === 'test',
    sentAt: new Date().toISOString(),
    allotments: selected.map(serializeAllotmentForWebhook),
  };

  try {
    await postYesGatcWebhook(endpoint, secret, payload);
  } catch (err) {
    if (selected.length) {
      await ref.set({
        allotments: markPushResult(allotments, selected.map(allotmentId), err?.message || err),
        updatedAt: new Date().toISOString(),
        updatedBy: str(actorName) || 'YESWEIGH',
      }, { merge: true });
    }
    throw err;
  }

  const sentIds = selected.map(allotmentId);
  if (sentIds.length) {
    await ref.set({
      allotments: markPushResult(allotments, sentIds, null),
      webhookUrl: endpoint,
      updatedAt: new Date().toISOString(),
      updatedBy: str(actorName) || 'YESWEIGH',
    }, { merge: true });
  }

  const afterSnap = await ref.get();
  const after = afterSnap.exists ? (afterSnap.data() || {}) : data;
  const afterRows = Array.isArray(after.allotments) ? after.allotments : [];
  const pending = afterRows.filter(isAllotmentPending).length;

  return {
    ok: true,
    test: kind === 'test',
    sent: sentIds.length,
    pending,
    webhookUrl: endpoint,
  };
}
