/**
 * YesOne → YesGATC serial allotment webhook.
 * POSTs newly added (or pending) ranges to the destination URL on the Serial numbers page.
 */
import { fetch as undiciFetch } from 'undici';
import { getFirestore } from 'firebase-admin/firestore';
import { compactSerialKey, expandSerialRange } from './serial-range.js';
import { loadWebhookSecret } from './yesgatc-webhook.js';
import { NON_GATC_ALLOCATIONS } from './non-gatc-serial-allot.js';
import { deleteUnusedSerialUnitsForRange, assertSerialRangeNeverUsed, WAREHOUSE_RC_CODE, WAREHOUSE_RC_NAME } from './serial-units.js';

export const SERIAL_NUMBER_ALLOTMENT_DOC = 'appSettings/serialNumberAllotment';

/** Events YesGATC inbound already handles. */
export const YESGATC_SERIAL_ALLOTTED = 'serial.allotted';
export const YESGATC_SERIAL_UPDATED = 'serial.updated';
export const YESGATC_SERIAL_CANCELLED = 'serial.cancelled';
export const YESGATC_SERIAL_ALLOTMENT = 'serial_allotment';

export function yesGatcSerialEvent({ action = 'upsert', alreadyPushed = false } = {}) {
  if (action === 'unlink' || action === 'cancel' || action === 'cancelled') {
    return YESGATC_SERIAL_CANCELLED;
  }
  if (alreadyPushed || action === 'update' || action === 'updated') {
    return YESGATC_SERIAL_UPDATED;
  }
  return YESGATC_SERIAL_ALLOTTED;
}

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
  const missing = Array.isArray(row?.missing) ? row.missing.map(item => str(item)).filter(Boolean) : [];
  const serialNumbers = expandSerialRange({
    from: row?.from,
    to: row?.to,
    missing,
  });
  return {
    id: allotmentId(row),
    series,
    seriesLabel: SERIES_LABELS[series] || series,
    from: str(row?.from),
    to: str(row?.to),
    missing,
    count: serialNumbers.length || Math.max(0, Number(row?.count) || 0),
    createdAt: str(row?.createdAt) || null,
    createdBy: str(row?.createdBy) || null,
    sku: str(row?.sku) || null,
    productId: str(row?.productId || row?.itemId) || null,
    itemId: str(row?.itemId || row?.productId) || null,
    productName: str(row?.productName) || null,
    imageUrl: str(row?.imageUrl) || null,
    sourcePoNumber: str(row?.sourcePoNumber) || null,
    rcCode: str(invoiceLinks[0]?.rcCode) || WAREHOUSE_RC_CODE,
    rcName: str(invoiceLinks[0]?.rcName) || WAREHOUSE_RC_NAME,
    invoiceLinks,
    serialNumbers,
    qty: serialNumbers.length || Math.max(0, Number(row?.count) || 0),
  };
}

function pickRows(allotments, mode, ids) {
  const rows = Array.isArray(allotments) ? allotments.filter(row => allotmentId(row)) : [];
  if (mode === 'ids') {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(id => str(id)).filter(Boolean));
    return rows.filter(row => wanted.has(allotmentId(row)));
  }
  if (mode === 'test') return rows;
  return rows.filter(isAllotmentPending);
}

function compareSerials(a, b) {
  return str(a).localeCompare(str(b), 'en', { numeric: true, sensitivity: 'base' });
}

function serialInAllotmentRange(serial, row) {
  const token = /^(.*?)(\d+)$/.exec(str(serial));
  const from = /^(.*?)(\d+)$/.exec(str(row?.from));
  const to = /^(.*?)(\d+)$/.exec(str(row?.to));
  if (!token || !from || !to || token[1] !== from[1] || from[1] !== to[1]) return false;
  const n = Number(token[2]);
  return n >= Number(from[2]) && n <= Number(to[2]);
}

async function loadRcAllottedSerials(db) {
  const snap = await db.collection(NON_GATC_ALLOCATIONS).get();
  const byRc = new Map();
  const details = [];
  snap.forEach(doc => {
    const data = doc.data() || {};
    const serial = str(data.serial || doc.id);
    if (!serial) return;
    const rcCode = str(data.rcCode).toUpperCase();
    const key = rcCode || 'UNASSIGNED';
    const slot = byRc.get(key) || {
      rcCode: rcCode || null,
      rcName: str(data.rcName) || null,
      serialNumbers: [],
      invoices: new Map(),
    };
    if (!slot.rcName && data.rcName) slot.rcName = str(data.rcName);
    slot.serialNumbers.push(serial);
    const invoiceId = str(data.invoiceId);
    if (invoiceId) {
      const inv = slot.invoices.get(invoiceId) || {
        invoiceId,
        invoiceNumber: str(data.invoiceNumber) || null,
        customerId: str(data.customerId) || null,
        serialNumbers: [],
      };
      inv.serialNumbers.push(serial);
      if (!inv.invoiceNumber && data.invoiceNumber) inv.invoiceNumber = str(data.invoiceNumber);
      slot.invoices.set(invoiceId, inv);
    }
    byRc.set(key, slot);
    details.push({
      serial,
      rcCode: rcCode || null,
      rcName: str(data.rcName) || null,
      invoiceId: invoiceId || null,
      invoiceNumber: str(data.invoiceNumber) || null,
      customerId: str(data.customerId) || null,
      lineId: str(data.lineId) || null,
      allottedAt: str(data.allottedAt) || null,
      allottedBy: str(data.allottedBy) || null,
    });
  });
  details.sort((a, b) => compareSerials(a.serial, b.serial));
  const rcs = [...byRc.values()]
    .map(row => {
      const serialNumbers = [...row.serialNumbers].sort(compareSerials);
      return {
        rcCode: row.rcCode,
        rcName: row.rcName,
        qty: serialNumbers.length,
        startNumber: serialNumbers[0] || null,
        endNumber: serialNumbers[serialNumbers.length - 1] || null,
        serialNumbers,
        invoices: [...row.invoices.values()].map(inv => {
          const serials = [...inv.serialNumbers].sort(compareSerials);
          return {
            invoiceId: inv.invoiceId,
            invoiceNumber: inv.invoiceNumber,
            customerId: inv.customerId,
            qty: serials.length,
            startNumber: serials[0] || null,
            endNumber: serials[serials.length - 1] || null,
            serialNumbers: serials,
          };
        }).sort((a, b) => str(a.invoiceNumber).localeCompare(str(b.invoiceNumber))),
      };
    })
    .sort((a, b) => str(a.rcCode).localeCompare(str(b.rcCode)));
  return { rcs, details };
}

function withAllotmentInvoiceLinks(allotments, rcGroups) {
  return (Array.isArray(allotments) ? allotments : []).map(row => {
    const links = [];
    for (const rc of rcGroups || []) {
      for (const inv of rc.invoices || []) {
        const serialNumbers = (inv.serialNumbers || []).filter(serial => (
          serialInAllotmentRange(serial, row)
        ));
        if (!serialNumbers.length) continue;
        links.push({
          rcCode: rc.rcCode,
          rcName: rc.rcName,
          invoiceId: inv.invoiceId,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate || null,
          qty: serialNumbers.length,
          startNumber: serialNumbers[0] || null,
          endNumber: serialNumbers[serialNumbers.length - 1] || null,
          serialNumbers,
        });
      }
    }
    return links.length ? { ...row, invoiceLinks: links } : row;
  });
}

export async function postYesGatcWebhook(url, secret, payload, timeoutMs = 120_000) {
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
    signal: AbortSignal.timeout(Math.max(30_000, Number(timeoutMs) || 120_000)),
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
  let serialsAllottedToRc = [];
  let rcAllottedSerialDetails = [];
  if (kind === 'test') {
    const allotted = await loadRcAllottedSerials(db);
    serialsAllottedToRc = allotted.rcs;
    rcAllottedSerialDetails = allotted.details;
  }
  const generatedSource = withAllotmentInvoiceLinks(
    kind === 'test' ? allotments : selected,
    serialsAllottedToRc,
  );
  const serialsGenerated = generatedSource.map(serializeAllotmentForWebhook);
  const allottedBySerial = new Map(
    rcAllottedSerialDetails.map(row => [compactSerialKey(row.serial), row]),
  );
  const generatedSerialDetails = [];
  for (const range of serialsGenerated) {
    for (const serial of range.serialNumbers || []) {
      const allotted = allottedBySerial.get(compactSerialKey(serial));
      generatedSerialDetails.push({
        serial,
        series: range.series,
        seriesLabel: range.seriesLabel,
        rangeId: range.id,
        from: range.from,
        to: range.to,
        status: allotted ? 'linked' : 'unused',
        rcCode: allotted?.rcCode || WAREHOUSE_RC_CODE,
        rcName: allotted?.rcName || WAREHOUSE_RC_NAME,
        sku: range.sku || null,
        productId: range.productId || null,
        productName: range.productName || null,
        invoiceId: allotted?.invoiceId || null,
        invoiceNumber: allotted?.invoiceNumber || null,
        customerId: allotted?.customerId || null,
        allottedAt: allotted?.allottedAt || null,
        allottedBy: allotted?.allottedBy || null,
      });
    }
  }
  const generatedSerialBackfill = serialsGenerated.map(range => {
    const serials = generatedSerialDetails.filter(row => row.rangeId === range.id);
    return {
      series: range.series,
      seriesLabel: range.seriesLabel,
      from: range.from,
      to: range.to,
      qty: serials.length,
      linked: serials.filter(row => row.status === 'linked').length,
      unused: serials.filter(row => row.status === 'unused').length,
      serialNumbers: range.serialNumbers || [],
      serials,
    };
  });
  const gSeries = serialsGenerated.find(row => (
    str(row.series) === 'non_gatc'
    && str(row.from).toUpperCase() === 'G0001'
    && str(row.to).toUpperCase() === 'G1082'
  )) || null;
  const payload = {
    event: YESGATC_SERIAL_ALLOTMENT,
    type: YESGATC_SERIAL_ALLOTTED,
    source: 'yesone',
    test: kind === 'test',
    sentAt: new Date().toISOString(),
    allotments: serialsGenerated,
    serialsGenerated,
    generatedSerialDetails,
    generatedSerialBackfill,
    serialsAllottedToRc,
    rcAllottedSerialDetails,
    rcSerialBackfill: gSeries
      ? {
        series: 'non_gatc',
        seriesLabel: 'non GATC',
        from: 'G0001',
        to: 'G1082',
        qty: gSeries.count,
        rcs: serialsAllottedToRc,
        serials: rcAllottedSerialDetails.filter(row => (
          serialInAllotmentRange(row.serial, { from: 'G0001', to: 'G1082' })
        )),
      }
      : null,
    totals: {
      rangesGenerated: serialsGenerated.length,
      serialsGenerated: serialsGenerated.reduce((sum, row) => sum + (Number(row.count) || 0), 0),
      generatedSerialDetails: generatedSerialDetails.length,
      serialsAllottedToRc: serialsAllottedToRc.reduce((sum, row) => sum + (Number(row.qty) || 0), 0),
    },
  };

  const storedAllotments = kind === 'test'
    ? withAllotmentInvoiceLinks(allotments, serialsAllottedToRc)
    : allotments;

  try {
    await postYesGatcWebhook(endpoint, secret, payload);
  } catch (err) {
    if (selected.length) {
      await ref.set({
        allotments: markPushResult(storedAllotments, selected.map(allotmentId), err?.message || err),
        updatedAt: new Date().toISOString(),
        updatedBy: str(actorName) || 'YESWEIGH',
      }, { merge: true });
    }
    throw err;
  }

  const sentIds = selected.map(allotmentId);
  if (sentIds.length) {
    await ref.set({
      allotments: markPushResult(storedAllotments, sentIds, null),
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
    totals: payload.totals,
  };
}

export async function deleteUnusedSerialAllotment({
  id = '',
  actorName = 'YESWEIGH',
} = {}) {
  const db = getFirestore();
  const ref = db.doc(SERIAL_NUMBER_ALLOTMENT_DOC);
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const allotments = Array.isArray(data.allotments) ? data.allotments : [];
  const wanted = str(id);
  const row = allotments.find(item => allotmentId(item) === wanted);
  if (!row) throw new Error('Allotment not found.');
  if (Array.isArray(row.invoiceLinks) && row.invoiceLinks.length) {
    throw new Error('This allotment has invoice links. It cannot be deleted.');
  }

  const missing = Array.isArray(row.missing) ? row.missing.map(item => str(item)).filter(Boolean) : [];
  const serials = expandSerialRange({
    from: row.from,
    to: row.to,
    missing,
  });
  await assertSerialRangeNeverUsed(row);
  const wasPushed = Boolean(str(row.pushedAt));
  let cancelledOnYesGatc = false;
  if (wasPushed) {
    const endpoint = await resolveYesGatcWebhookUrl(data.webhookUrl);
    if (!endpoint) {
      throw new Error('YesGATC webhook URL missing. Cannot cancel serials that were already sent.');
    }
    const secret = await loadWebhookSecret();
    const series = str(row.series) || 'non_gatc';
    await postYesGatcWebhook(endpoint, secret, {
      event: YESGATC_SERIAL_CANCELLED,
      type: YESGATC_SERIAL_CANCELLED,
      action: 'cancel',
      source: 'yesone',
      sentAt: new Date().toISOString(),
      from: str(row.from),
      to: str(row.to),
      missing,
      qty: serials.length,
      count: serials.length,
      series,
      seriesLabel: SERIES_LABELS[series] || series,
      allotments: [{
        id: allotmentId(row),
        series,
        seriesLabel: SERIES_LABELS[series] || series,
        from: str(row.from),
        to: str(row.to),
        missing,
        count: serials.length,
        qty: serials.length,
      }],
    }, 170_000);
    cancelledOnYesGatc = true;
  }

  const units = await deleteUnusedSerialUnitsForRange(row);
  await ref.set({
    allotments: allotments.filter(item => allotmentId(item) !== wanted),
    updatedAt: new Date().toISOString(),
    updatedBy: str(actorName) || 'YESWEIGH',
  }, { merge: true });

  return {
    ok: true,
    id: wanted,
    from: str(row.from),
    to: str(row.to),
    cancelledOnYesGatc,
    deletedUnits: units.deleted,
    remaining: allotments.length - 1,
  };
}
