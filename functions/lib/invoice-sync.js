import crypto from 'node:crypto';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import {
  mapInvoice,
  mapInvoiceLineItem,
  buildInvoiceSearchBlob,
  firestoreDocToListInvoice,
  firestoreDocToDetail,
} from './invoice-mappers.js';

const CUSTOMERS_COLLECTION = 'zohoCustomers';
const INVOICES_SUBCOLLECTION = 'invoices';
const DEFAULT_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || undefined;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function invoicesCollection(customerId) {
  return getFirestore()
    .collection(CUSTOMERS_COLLECTION)
    .doc(String(customerId))
    .collection(INVOICES_SUBCOLLECTION);
}

function customerInvoiceMetaRef(customerId) {
  return getFirestore()
    .collection(CUSTOMERS_COLLECTION)
    .doc(String(customerId))
    .collection('invoiceMeta')
    .doc('sync');
}

function invoiceIndexRef(invoiceId) {
  return getFirestore().collection('invoiceIndex').doc(String(invoiceId));
}

function globalInvoiceMetaRef() {
  return getFirestore().collection('invoiceMeta').doc('sync');
}

function invoicePdfPath(customerId, invoiceId) {
  return `invoices/${customerId}/${invoiceId}.pdf`;
}

function salesOrderPdfPath(customerId, salesOrderId) {
  return `invoices/${customerId}/so-${salesOrderId}.pdf`;
}

function storageBucket() {
  return getStorage().bucket(DEFAULT_BUCKET);
}

async function zohoJsonRequest(accessToken, orgId, path) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  url.searchParams.set('organization_id', orgId);
  const res = await fetch(url.toString(), {
    headers: authHeaders(accessToken, orgId),
  });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok) {
    if (res.status === 429) {
      const err = new Error('Zoho rate limit exceeded.');
      err.code = 'RATE_LIMITED';
      throw err;
    }
    throw new Error(payload?.message || `Zoho API error (${res.status}).`);
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload.message || 'Zoho API error.');
  }
  return payload;
}

async function fetchInvoiceRaw(accessToken, orgId, invoiceId) {
  const payload = await zohoJsonRequest(accessToken, orgId, `/invoices/${invoiceId}`);
  return payload?.invoice ?? null;
}

async function fetchZohoPdf(accessToken, orgId, resource, id) {
  const url = new URL(`${ZOHO_API_BASE}/${resource}/${id}`);
  url.searchParams.set('organization_id', orgId);
  const res = await fetch(url.toString(), {
    headers: {
      ...authHeaders(accessToken, orgId),
      Accept: 'application/pdf',
    },
  });
  if (!res.ok) {
    if (res.status === 429) {
      const err = new Error('Zoho rate limit exceeded.');
      err.code = 'RATE_LIMITED';
      throw err;
    }
    const text = await res.text();
    let message = `Could not download ${resource} PDF (${res.status}).`;
    try {
      const payload = JSON.parse(text);
      if (payload?.message) message = payload.message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('PDF file is empty.');
  return buffer;
}

async function fetchInvoicesListPage(accessToken, orgId, page, options = {}) {
  const url = new URL(`${ZOHO_API_BASE}/invoices`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '200');
  url.searchParams.set('sort_column', 'last_modified_time');
  url.searchParams.set('sort_order', 'D');
  if (options.customerId) url.searchParams.set('customer_id', options.customerId);

  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    if (res.status === 429) {
      const err = new Error('Zoho rate limit exceeded.');
      err.code = 'RATE_LIMITED';
      throw err;
    }
    throw new Error(payload?.message || `Zoho invoices API error (${res.status}).`);
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload.message || 'Zoho invoices API error.');
  }

  return {
    invoices: payload?.invoices ?? [],
    hasMore: Boolean(payload?.page_context?.has_more_page),
  };
}

async function fetchAllInvoiceSummaries(accessToken, orgId, options = {}) {
  const invoices = [];
  let page = 1;
  const maxPages = options.maxPages ?? 100;

  while (page <= maxPages) {
    const batch = await fetchInvoicesListPage(accessToken, orgId, page, options);
    invoices.push(...batch.invoices);
    if (!batch.hasMore) break;
    page += 1;
    if (options.delayMs) await sleep(options.delayMs);
  }

  return invoices;
}

async function resolveSalesOrder(accessToken, orgId, customerId, invoiceRaw) {
  const salesOrderId = invoiceRaw.salesorder_id ? String(invoiceRaw.salesorder_id) : null;
  const referenceNumber = invoiceRaw.reference_number ? String(invoiceRaw.reference_number) : null;

  if (salesOrderId) {
    try {
      const payload = await zohoJsonRequest(accessToken, orgId, `/salesorders/${salesOrderId}`);
      const so = payload?.salesorder;
      if (so && String(so.customer_id) === customerId) {
        return {
          id: String(so.salesorder_id),
          number: so.salesorder_number ? String(so.salesorder_number) : referenceNumber,
        };
      }
    } catch {
      // Fall back to search by reference number.
    }
  }

  if (!referenceNumber) return null;

  const url = new URL(`${ZOHO_API_BASE}/salesorders`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('customer_id', customerId);
  url.searchParams.set('search_text', referenceNumber);
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok || payload?.code !== 0) return null;

  const orders = payload?.salesorders ?? [];
  const match =
    orders.find(so => String(so.salesorder_number) === referenceNumber)
    ?? orders.find(so => String(so.reference_number) === referenceNumber)
    ?? orders[0];

  if (!match) return null;
  return {
    id: String(match.salesorder_id),
    number: match.salesorder_number ? String(match.salesorder_number) : referenceNumber,
  };
}

async function getCatalogImagesForItems(itemIds) {
  const unique = [...new Set(itemIds.filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;

  const db = getFirestore();
  const refs = unique.map(id => db.collection('catalogProducts').doc(id));
  const snaps = await db.getAll(...refs);
  for (const snap of snaps) {
    if (snap.exists) {
      map.set(snap.id, snap.data()?.imageUrl ?? null);
    }
  }
  return map;
}

async function uploadPdfToStorage(storagePath, buffer) {
  const bucket = storageBucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    contentType: 'application/pdf',
    metadata: { cacheControl: 'public, max-age=31536000' },
    resumable: false,
  });
  return storagePath;
}

async function readPdfFromStorage(storagePath) {
  const bucket = storageBucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buffer] = await file.download();
  return buffer.length ? buffer : null;
}

function zohoContentFingerprint(invoiceRaw) {
  return [
    invoiceRaw.last_modified_time,
    invoiceRaw.status,
    invoiceRaw.total,
    invoiceRaw.balance,
    invoiceRaw.invoice_number,
    (invoiceRaw.line_items ?? []).length,
  ].join('|');
}

async function buildFirestoreInvoiceDoc(accessToken, orgId, invoiceRaw, options = {}) {
  const customerId = String(invoiceRaw.customer_id);
  const invoiceId = String(invoiceRaw.invoice_id);
  const lineItemsRaw = invoiceRaw.line_items ?? [];
  const itemIds = lineItemsRaw.map(item => (item.item_id ? String(item.item_id) : null));
  const imageMap = options.skipImages
    ? new Map()
    : await getCatalogImagesForItems(itemIds);
  const lineItems = lineItemsRaw.map(item =>
    mapInvoiceLineItem(item, item.item_id ? imageMap.get(String(item.item_id)) ?? null : null),
  );
  const salesOrder = options.skipSalesOrder
    ? null
    : await resolveSalesOrder(accessToken, orgId, customerId, invoiceRaw);

  const summary = mapInvoice(invoiceRaw);
  const searchBlob = buildInvoiceSearchBlob(invoiceRaw);
  const fingerprint = zohoContentFingerprint(invoiceRaw);

  return {
    ...summary,
    customerId,
    searchBlob,
    salesOrderId: salesOrder?.id ?? null,
    salesOrderNumber: salesOrder?.number
      ?? (invoiceRaw.reference_number ? String(invoiceRaw.reference_number) : null),
    subtotal: Number(invoiceRaw.sub_total ?? 0),
    taxTotal: Number(invoiceRaw.tax_total ?? 0),
    notes: invoiceRaw.notes ? String(invoiceRaw.notes) : null,
    lineItems,
    zohoLastModified: invoiceRaw.last_modified_time
      ? String(invoiceRaw.last_modified_time)
      : null,
    contentFingerprint: fingerprint,
    syncedAt: FieldValue.serverTimestamp(),
  };
}

async function cacheInvoicePdfs(accessToken, orgId, customerId, invoiceId, invoiceRaw, salesOrder, options = {}) {
  const paths = {
    pdfStoragePath: null,
    salesOrderPdfStoragePath: null,
  };

  if (options.skipPdfs) return paths;

  try {
    const pdfBuffer = await fetchZohoPdf(accessToken, orgId, 'invoices', invoiceId);
    paths.pdfStoragePath = await uploadPdfToStorage(invoicePdfPath(customerId, invoiceId), pdfBuffer);
  } catch (err) {
    console.warn(`Invoice PDF cache failed for ${invoiceId}:`, err?.message ?? err);
  }

  if (salesOrder?.id) {
    try {
      const soBuffer = await fetchZohoPdf(accessToken, orgId, 'salesorders', salesOrder.id);
      paths.salesOrderPdfStoragePath = await uploadPdfToStorage(
        salesOrderPdfPath(customerId, salesOrder.id),
        soBuffer,
      );
    } catch (err) {
      console.warn(`Sales order PDF cache failed for invoice ${invoiceId}:`, err?.message ?? err);
    }
  }

  return paths;
}

export async function upsertInvoiceFromRaw(accessToken, orgId, invoiceRaw, options = {}) {
  if (!invoiceRaw?.invoice_id || !invoiceRaw?.customer_id) {
    return { skipped: true, reason: 'missing ids' };
  }

  const customerId = String(invoiceRaw.customer_id);
  const invoiceId = String(invoiceRaw.invoice_id);
  const existingSnap = await invoicesCollection(customerId).doc(invoiceId).get();
  const existing = existingSnap.exists ? existingSnap.data() : null;
  const fingerprint = zohoContentFingerprint(invoiceRaw);

  const needsDetail = !existing
    || existing.contentFingerprint !== fingerprint
    || !Array.isArray(existing.lineItems)
    || !existing.lineItems.length;

  let doc;
  let salesOrder = null;

  if (needsDetail || options.forceDetail) {
    const fullRaw = options.useProvidedRaw
      ? invoiceRaw
      : await fetchInvoiceRaw(accessToken, orgId, invoiceId);
    if (!fullRaw) {
      return { skipped: true, reason: 'not found in zoho' };
    }
    doc = await buildFirestoreInvoiceDoc(accessToken, orgId, fullRaw, options);
    salesOrder = doc.salesOrderId ? { id: doc.salesOrderId, number: doc.salesOrderNumber } : null;
  } else {
    doc = {
      ...firestoreDocToDetail(existing),
      ...mapInvoice(invoiceRaw),
      customerId,
      searchBlob: buildInvoiceSearchBlob(invoiceRaw),
      contentFingerprint: fingerprint,
      syncedAt: FieldValue.serverTimestamp(),
    };
    if (existing.salesOrderId) {
      salesOrder = { id: existing.salesOrderId, number: existing.salesOrderNumber };
    }
  }

  const needsPdf = options.forcePdfs
    || !existing?.pdfStoragePath
    || (salesOrder?.id && !existing?.salesOrderPdfStoragePath);

  if (needsPdf && !options.skipPdfs) {
    const fullRaw = needsDetail || options.forceDetail
      ? (options.useProvidedRaw ? invoiceRaw : await fetchInvoiceRaw(accessToken, orgId, invoiceId))
      : invoiceRaw;
    if (fullRaw) {
      const pdfPaths = await cacheInvoicePdfs(
        accessToken,
        orgId,
        customerId,
        invoiceId,
        fullRaw,
        salesOrder,
        options,
      );
      if (pdfPaths.pdfStoragePath) doc.pdfStoragePath = pdfPaths.pdfStoragePath;
      if (pdfPaths.salesOrderPdfStoragePath) doc.salesOrderPdfStoragePath = pdfPaths.salesOrderPdfStoragePath;
    }
  } else if (existing) {
    if (existing.pdfStoragePath) doc.pdfStoragePath = existing.pdfStoragePath;
    if (existing.salesOrderPdfStoragePath) doc.salesOrderPdfStoragePath = existing.salesOrderPdfStoragePath;
  }

  await invoicesCollection(customerId).doc(invoiceId).set(doc, { merge: true });
  await invoiceIndexRef(invoiceId).set({ customerId, updatedAt: FieldValue.serverTimestamp() });

  await customerInvoiceMetaRef(customerId).set({
    ...(options.source === 'webhook' ? { lastWebhookAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { customerId, invoiceId, updated: true };
}

export async function deleteInvoiceFromFirestore(customerId, invoiceId) {
  const ref = invoicesCollection(customerId).doc(invoiceId);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const data = snap.data() ?? {};
  const bucket = storageBucket();
  const paths = [data.pdfStoragePath, data.salesOrderPdfStoragePath].filter(Boolean);
  await ref.delete();
  await invoiceIndexRef(invoiceId).delete().catch(() => {});
  await Promise.all(paths.map(async path => {
    try {
      await bucket.file(path).delete({ ignoreNotFound: true });
    } catch {
      // ignore storage delete failures
    }
  }));
  return true;
}

async function mapConcurrent(items, concurrency, fn) {
  if (!items.length) return [];
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      try {
        results[current] = await fn(items[current], current);
      } catch (err) {
        results[current] = { error: err };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function syncInvoicesToFirestore(secrets, orgId, options = {}) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const concurrency = options.concurrency ?? 3;
  const delayMs = options.delayMs ?? 350;
  const skipPdfs = options.skipPdfs ?? false;
  const customerIdFilter = options.customerId ? String(options.customerId) : null;

  const summaries = await fetchAllInvoiceSummaries(accessToken, organizationId, {
    customerId: customerIdFilter ?? undefined,
    delayMs,
  });

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const customerCounts = new Map();

  await mapConcurrent(summaries, concurrency, async summary => {
    if (delayMs) await sleep(delayMs);
    try {
      const invoiceId = String(summary.invoice_id);
      const customerId = String(summary.customer_id);
      const fullRaw = await fetchInvoiceRaw(accessToken, organizationId, invoiceId);
      if (!fullRaw) {
        skipped += 1;
        return;
      }
      await upsertInvoiceFromRaw(accessToken, organizationId, fullRaw, {
        useProvidedRaw: true,
        skipPdfs,
        forcePdfs: !skipPdfs,
        source: 'sync',
      });
      synced += 1;
      customerCounts.set(customerId, (customerCounts.get(customerId) ?? 0) + 1);
    } catch (err) {
      failed += 1;
      if (err?.code === 'RATE_LIMITED') {
        await sleep(5000);
      }
      console.warn('Invoice sync item failed:', err?.message ?? err);
    }
  });

  const now = FieldValue.serverTimestamp();
  const touchedCustomers = customerIdFilter
    ? [customerIdFilter]
    : [...customerCounts.keys()];

  for (const customerId of touchedCustomers) {
    const snap = await invoicesCollection(customerId).count().get();
    await customerInvoiceMetaRef(customerId).set({
      totalCount: snap.data().count,
      lastFullSyncAt: now,
      lastSyncStatus: failed ? 'partial' : 'ok',
      updatedAt: now,
    }, { merge: true });
  }

  await globalInvoiceMetaRef().set({
    lastFullSyncAt: now,
    syncedCount: synced,
    failedCount: failed,
    skippedCount: skipped,
    totalListed: summaries.length,
    updatedAt: now,
  }, { merge: true });

  return {
    syncedCount: synced,
    failedCount: failed,
    skippedCount: skipped,
    totalListed: summaries.length,
    customerCount: touchedCustomers.length,
  };
}

export async function syncSingleInvoiceFromZoho(secrets, orgId, invoiceId, options = {}) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const fullRaw = await fetchInvoiceRaw(accessToken, organizationId, invoiceId);
  if (!fullRaw) {
    return { deleted: false, updated: false, reason: 'not found' };
  }
  const result = await upsertInvoiceFromRaw(accessToken, organizationId, fullRaw, {
    useProvidedRaw: true,
    forceDetail: true,
    forcePdfs: !options.skipPdfs,
    skipPdfs: options.skipPdfs ?? false,
    source: options.source ?? 'webhook',
  });
  return result;
}

export async function reconcileCustomerInvoices(secrets, orgId, customerId, options = {}) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  const zohoSummaries = await fetchAllInvoiceSummaries(accessToken, organizationId, {
    customerId: String(customerId),
    delayMs: options.delayMs ?? 300,
  });
  const zohoIds = new Set(zohoSummaries.map(row => String(row.invoice_id)));

  const localSnap = await invoicesCollection(customerId).get();
  const localIds = new Set(localSnap.docs.map(doc => doc.id));

  let removed = 0;
  for (const id of localIds) {
    if (!zohoIds.has(id)) {
      await deleteInvoiceFromFirestore(customerId, id);
      removed += 1;
    }
  }

  return { zohoCount: zohoIds.size, localRemoved: removed };
}

export async function readCustomerInvoicesFromFirestore(customerId) {
  const snap = await invoicesCollection(String(customerId)).get();
  const invoices = [];
  const searchBlobById = new Map();

  snap.forEach(doc => {
    const data = doc.data() ?? {};
    invoices.push(firestoreDocToListInvoice({ ...data, id: doc.id }));
    if (data.searchBlob) searchBlobById.set(doc.id, String(data.searchBlob));
  });

  const metaSnap = await customerInvoiceMetaRef(String(customerId)).get();
  const meta = metaSnap.exists ? metaSnap.data() : null;
  let lastSyncedAt = null;
  const timestamps = [meta?.lastFullSyncAt, meta?.lastWebhookAt, meta?.updatedAt];
  for (const ts of timestamps) {
    if (ts instanceof Timestamp) {
      const iso = ts.toDate().toISOString();
      if (!lastSyncedAt || iso > lastSyncedAt) lastSyncedAt = iso;
    }
  }

  return { invoices, searchBlobById, lastSyncedAt };
}

export async function readInvoiceDetailFromFirestore(customerId, invoiceId) {
  const snap = await invoicesCollection(String(customerId)).doc(String(invoiceId)).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (String(data.customerId ?? customerId) !== String(customerId)) return null;
  return firestoreDocToDetail({ ...data, id: snap.id });
}

export async function readInvoiceDocumentFromStorage(customerId, invoiceId, documentType) {
  const snap = await invoicesCollection(String(customerId)).doc(String(invoiceId)).get();
  if (!snap.exists) throw new Error('Invoice not found.');
  const data = snap.data() ?? {};
  if (String(data.customerId ?? customerId) !== String(customerId)) {
    throw new Error('Invoice not found.');
  }

  let storagePath = null;
  let filename = null;

  if (documentType === 'invoice') {
    storagePath = data.pdfStoragePath ?? invoicePdfPath(customerId, invoiceId);
    const number = data.invoiceNumber || invoiceId;
    filename = `${String(number).replace(/[^\w.-]+/g, '_')}.pdf`;
  } else if (documentType === 'salesorder') {
    if (!data.salesOrderId) throw new Error('Sales order not found for this invoice.');
    storagePath = data.salesOrderPdfStoragePath
      ?? salesOrderPdfPath(customerId, data.salesOrderId);
    const number = data.salesOrderNumber || data.salesOrderId;
    filename = `${String(number).replace(/[^\w.-]+/g, '_')}.pdf`;
  } else {
    throw new Error('Unsupported document type.');
  }

  const buffer = await readPdfFromStorage(storagePath);
  if (!buffer) throw new Error('PDF not available yet. It will appear after the next sync.');
  return {
    contentBase64: buffer.toString('base64'),
    filename,
    mimeType: 'application/pdf',
  };
}

function normalizeSignature(value) {
  return String(value ?? '').trim();
}

function signaturesMatch(received, calculated) {
  const a = normalizeSignature(received);
  const b = normalizeSignature(calculated);
  if (!a || !b) return false;
  if (a.length !== b.length) {
    if (a.toLowerCase() === b.toLowerCase()) return true;
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

export function verifyZohoWebhookSignature(req, secret) {
  if (!secret) return false;

  const received =
    req.get('X-ZB-Signature')
    ?? req.get('X-ZB-WebhookSignature')
    ?? req.get('X-Zoho-Webhook-Signature')
    ?? req.get('x-zb-signature');

  const rawBody = req.rawBody;
  if (!received || !rawBody) return false;

  const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (signaturesMatch(received, hex)) return true;

  const base64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  if (signaturesMatch(received, base64)) return true;

  return false;
}

export function extractInvoiceIdFromWebhook(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.invoice_id,
    body.invoice?.invoice_id,
    body.data?.invoice_id,
    body.payload?.invoice_id,
  ];
  for (const value of candidates) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

export function extractWebhookEvent(body) {
  if (!body || typeof body !== 'object') return 'update';
  const event = body.event_type ?? body.event ?? body.action ?? body.type;
  return String(event ?? 'update').toLowerCase();
}

export async function handleZohoInvoiceWebhook(secrets, orgId, req) {
  const body = req.body ?? {};
  const invoiceId = extractInvoiceIdFromWebhook(body);
  if (!invoiceId) {
    return { ok: false, status: 400, message: 'Missing invoice_id' };
  }

  const queryAction = String(req.query?.action ?? '').trim().toLowerCase();
  const event = queryAction || extractWebhookEvent(body);
  if (event.includes('delete')) {
    const customerId = body.customer_id ?? body.invoice?.customer_id;
    if (customerId) {
      await deleteInvoiceFromFirestore(String(customerId), invoiceId);
      return { ok: true, status: 200, action: 'deleted', invoiceId };
    }
    const indexSnap = await invoiceIndexRef(invoiceId).get();
    if (indexSnap.exists) {
      await deleteInvoiceFromFirestore(String(indexSnap.data()?.customerId), invoiceId);
      return { ok: true, status: 200, action: 'deleted', invoiceId };
    }
    return { ok: true, status: 200, action: 'ignored', invoiceId, reason: 'unknown customer' };
  }

  const result = await syncSingleInvoiceFromZoho(secrets, orgId, invoiceId, {
    source: 'webhook',
    skipPdfs: false,
  });
  return { ok: true, status: 200, action: 'synced', invoiceId, result };
}
