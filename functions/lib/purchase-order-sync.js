/**
 * Zoho Inventory purchase orders → Firestore mirror (org-wide, vendor-scoped fields).
 * Pattern mirrors invoice-sync / org-invoice-sync, but docs live at purchaseOrders/{id}.
 */
import { getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
  fetchZohoOrgApiUsage,
} from './zoho-api-usage.js';
import {
  classifyInvoiceFromLineItems,
  parseInvoiceCategory,
} from './invoice-category.js';

const COLLECTION = 'purchaseOrders';
const META_DOC = 'purchaseOrderMeta/orgSync';
const STALE_RUN_MS = 30 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Keep 30% of daily Zoho quota for daytime (same as invoice scheduled sync). */
function scheduledQuotaReserveRemaining(dailyLimit) {
  const limit = Number(dailyLimit) || 0;
  return Math.ceil(limit * 0.30);
}

function resolveStorageBucketName() {
  const fromEnv = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  if (fromEnv) return fromEnv;
  const projectId =
    process.env.GCLOUD_PROJECT?.trim()
    ?? process.env.GCP_PROJECT?.trim()
    ?? process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (projectId) return `${projectId}.firebasestorage.app`;
  try {
    const app = getApp();
    if (app.options.storageBucket) return app.options.storageBucket;
    if (app.options.projectId) return `${app.options.projectId}.firebasestorage.app`;
  } catch {
    // ignore
  }
  return null;
}

function storageBucket() {
  const name = resolveStorageBucketName();
  return name ? getStorage().bucket(name) : getStorage().bucket();
}

function poCollection() {
  return getFirestore().collection(COLLECTION);
}

function orgSyncRef() {
  return getFirestore().doc(META_DOC);
}

function pdfPath(poId) {
  return `purchaseorders/${poId}.pdf`;
}

async function zohoJsonRequest(accessToken, orgId, path) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  if (!url.searchParams.has('organization_id')) {
    url.searchParams.set('organization_id', orgId);
  }
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  await recordZohoApiResponse(res, { operation: path, source: 'purchase-order-sync' });
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
    const err = classifyZohoHttpError(res.status, payload);
    await recordZohoApiFailure(err, { operation: path, source: 'purchase-order-sync' });
    throw err;
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    const apiErr = new Error(payload.message || 'Zoho API error.');
    apiErr.zohoCode = payload.code;
    throw apiErr;
  }
  return payload;
}

async function zohoCallWithRetry(fn, label) {
  let attempt = 0;
  while (attempt < 4) {
    try {
      return await fn();
    } catch (err) {
      const rateLimited = err?.code === 'RATE_LIMITED'
        || err?.status === 429
        || String(err?.message ?? '').toLowerCase().includes('rate');
      if (!rateLimited || attempt >= 3) throw err;
      attempt += 1;
      console.warn(`Retry ${attempt} for ${label}: ${err.message}`);
      await sleep(1500 * attempt);
    }
  }
  throw new Error(`Retries exhausted for ${label}`);
}

async function fetchPurchaseOrdersListPage(accessToken, orgId, page, options = {}) {
  const url = new URL(`${ZOHO_API_BASE}/purchaseorders`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '200');
  url.searchParams.set('sort_column', options.sortColumn ?? 'last_modified_time');
  url.searchParams.set('sort_order', options.sortOrder ?? 'D');

  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  await recordZohoApiResponse(res, { operation: `purchaseorders/list?page=${page}`, source: 'purchase-order-sync' });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = classifyZohoHttpError(res.status, payload);
    await recordZohoApiFailure(err, { operation: `purchaseorders/list?page=${page}`, source: 'purchase-order-sync' });
    throw err;
  }
  return {
    purchaseOrders: payload?.purchaseorders ?? [],
    hasMore: Boolean(payload?.page_context?.has_more_page),
  };
}

async function fetchPurchaseOrderRaw(accessToken, orgId, poId) {
  const payload = await zohoJsonRequest(accessToken, orgId, `/purchaseorders/${poId}`);
  return payload?.purchaseorder ?? null;
}

function mapLineItem(raw) {
  return {
    id: String(raw.line_item_id ?? raw.item_id ?? ''),
    itemId: raw.item_id != null ? String(raw.item_id) : null,
    name: String(raw.name ?? raw.item_name ?? 'Item'),
    description: raw.description != null ? String(raw.description) : null,
    sku: raw.sku != null ? String(raw.sku) : null,
    quantity: Number(raw.quantity ?? 0),
    rate: Number(raw.rate ?? 0),
    total: Number(raw.item_total ?? raw.total ?? 0),
    imageUrl: null,
    hsn: raw.hsn_or_sac != null ? String(raw.hsn_or_sac) : (raw.hsn != null ? String(raw.hsn) : null),
  };
}

function buildSearchBlob(doc) {
  return [
    doc.purchaseOrderNumber,
    doc.vendorName,
    doc.vendorId,
    doc.referenceNumber,
    doc.status,
    ...(doc.lineItems || []).flatMap(line => [line.name, line.sku]),
  ].filter(Boolean).join(' ').toLowerCase();
}

async function loadCatalogMeta(itemIds) {
  const unique = [...new Set(itemIds.filter(Boolean).map(String))];
  const map = new Map();
  if (!unique.length) return map;
  const db = getFirestore();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map(id => db.collection('catalogProducts').doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      map.set(snap.id, {
        hsn: data.hsn != null ? String(data.hsn) : null,
        categoryId: data.categoryId != null ? String(data.categoryId) : null,
        categoryName: data.categoryName != null ? String(data.categoryName) : null,
      });
    }
  }
  return map;
}

function mapPurchaseOrder(raw) {
  const lineItems = Array.isArray(raw.line_items)
    ? raw.line_items.map(mapLineItem)
    : [];
  return {
    id: String(raw.purchaseorder_id ?? ''),
    purchaseOrderNumber: String(raw.purchaseorder_number ?? ''),
    date: raw.date ? String(raw.date) : null,
    deliveryDate: raw.delivery_date ? String(raw.delivery_date) : null,
    status: String(raw.status ?? 'draft'),
    total: Number(raw.total ?? 0),
    balance: Number(raw.balance ?? raw.total ?? 0),
    referenceNumber: raw.reference_number ? String(raw.reference_number) : null,
    currencyCode: String(raw.currency_code ?? 'INR'),
    vendorId: raw.vendor_id != null ? String(raw.vendor_id) : '',
    vendorName: raw.vendor_name ? String(raw.vendor_name) : null,
    subtotal: Number(raw.sub_total ?? raw.subtotal ?? 0),
    taxTotal: Number(raw.tax_total ?? 0),
    notes: raw.notes ? String(raw.notes) : null,
    lineItems,
    zohoLastModified: raw.last_modified_time ? String(raw.last_modified_time) : null,
  };
}

async function upsertPurchaseOrderFromRaw(raw, options = {}) {
  const mapped = mapPurchaseOrder(raw);
  if (!mapped.id) throw new Error('Missing purchaseorder_id.');

  const catalog = await loadCatalogMeta(mapped.lineItems.map(line => line.itemId).filter(Boolean));
  const purchaseOrderCategory = classifyInvoiceFromLineItems(mapped.lineItems, catalog);
  const now = Timestamp.now();
  const doc = {
    ...mapped,
    searchBlob: buildSearchBlob(mapped),
    purchaseOrderCategory,
    itemQuantity: mapped.lineItems.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    syncedAt: now,
    contentFingerprint: `${mapped.zohoLastModified}|${mapped.lineItems.length}|${mapped.total}`,
  };

  await poCollection().doc(mapped.id).set(doc, { merge: true });
  return { id: mapped.id, purchaseOrderCategory };
}

function detailStillValid(existing, summary) {
  if (!existing) return false;
  if (!Array.isArray(existing.lineItems) || existing.lineItems.length === 0) return false;
  const existingMod = String(existing.zohoLastModified ?? '');
  const summaryMod = String(summary.last_modified_time ?? '');
  return Boolean(existingMod && summaryMod && existingMod === summaryMod);
}

async function readOrgSyncMeta() {
  const snap = await orgSyncRef().get();
  return snap.exists ? (snap.data() || {}) : {};
}

function normalizeStatus(meta) {
  const status = String(meta.status ?? 'idle');
  if (status === 'running') return 'running';
  if (status === 'complete') return 'complete';
  return 'idle';
}

export async function getOrgPurchaseOrderSyncStatus() {
  const meta = await readOrgSyncMeta();
  const totalInRange = meta.totalInRange ?? null;
  const pulledCount = meta.pulledCount ?? 0;
  const remaining = totalInRange == null ? null : Math.max(0, totalInRange - pulledCount);
  let status = normalizeStatus(meta);
  const startedAt = meta.runStartedAt?.toDate?.();
  if (status === 'running' && startedAt && Date.now() - startedAt.getTime() > STALE_RUN_MS) {
    status = pulledCount >= totalInRange && totalInRange > 0 ? 'complete' : 'idle';
    await orgSyncRef().set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return {
    status,
    totalInRange,
    pulledCount,
    remaining,
    checkpointPage: meta.checkpointPage ?? 1,
    checkpointIndex: meta.checkpointIndex ?? 0,
    lastRunAt: meta.lastRunAt?.toDate?.()?.toISOString?.() ?? null,
    lastRunSummary: meta.status === 'running' || !meta.lastRunSummary?.inProgress
      ? (meta.lastRunSummary ?? null)
      : null,
    lastRunSource: meta.lastRunSource ?? null,
    completedAt: meta.completedAt?.toDate?.()?.toISOString?.() ?? null,
    totalCountedAt: meta.totalCountedAt?.toDate?.()?.toISOString?.() ?? null,
  };
}

async function beginOrgSyncRun() {
  const ref = orgSyncRef();
  return getFirestore().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const startedAt = data.runStartedAt?.toDate?.();
    const staleRun = data.status === 'running'
      && startedAt
      && Date.now() - startedAt.getTime() > STALE_RUN_MS;
    if (data.status === 'running' && !staleRun) {
      const err = new Error('Purchase order sync is already running.');
      err.code = 'ALREADY_RUNNING';
      throw err;
    }
    tx.set(ref, {
      status: 'running',
      runStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return data;
  });
}

async function writeOrgSyncMeta(patch) {
  await orgSyncRef().set({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function batchHasStoredDetail(summaries) {
  const db = getFirestore();
  let pulled = 0;
  const refs = summaries.map(s => poCollection().doc(String(s.purchaseorder_id)));
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db.getAll(...refs.slice(i, i + 100));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() ?? {};
      if (Array.isArray(data.lineItems) && data.lineItems.length > 0) pulled += 1;
    }
  }
  return pulled;
}

export async function countOrgPurchaseOrdersInRange(secrets, orgId) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  let page = 1;
  let totalInRange = 0;
  let pulledCount = 0;
  let hasMore = true;

  while (hasMore) {
    const list = await zohoCallWithRetry(
      () => fetchPurchaseOrdersListPage(accessToken, organizationId, page, {
        sortColumn: 'date',
        sortOrder: 'D',
      }),
      `PO list page ${page}`,
    );
    totalInRange += list.purchaseOrders.length;
    pulledCount += await batchHasStoredDetail(list.purchaseOrders);
    hasMore = list.hasMore;
    page += 1;
  }

  await writeOrgSyncMeta({
    totalInRange,
    pulledCount,
    totalCountedAt: FieldValue.serverTimestamp(),
    status: 'idle',
  });

  return {
    totalInRange,
    pulledCount,
    remaining: Math.max(0, totalInRange - pulledCount),
  };
}

export async function syncOrgPurchaseOrdersToFirestore(secrets, orgId, options = {}) {
  const source = options.source ?? 'org-po-sync';
  let priorMeta;
  try {
    priorMeta = await beginOrgSyncRun();
  } catch (err) {
    if (err?.code === 'ALREADY_RUNNING') throw err;
    throw err;
  }

  let page = Number(priorMeta.checkpointPage ?? 1);
  let index = Number(priorMeta.checkpointIndex ?? 0);
  const baselinePulled = Number(priorMeta.pulledCount ?? 0);
  let pulledCount = baselinePulled;
  const totalInRange = priorMeta.totalInRange ?? null;

  let synced = 0;
  let failed = 0;
  let unchanged = 0;
  let newlyPulled = 0;
  let completed = false;
  let rateLimited = false;
  let quotaReserved = false;

  const quotaReserveRatio = Number(options.quotaReserveRatio ?? 0);
  let apiCallsThisRun = 0;
  let apiBudget = null;
  const shouldStopForQuota = () => apiBudget != null && apiCallsThisRun >= apiBudget;
  const trackZohoCall = () => {
    apiCallsThisRun += 1;
    if (shouldStopForQuota()) quotaReserved = true;
  };

  try {
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, orgId);

    if (quotaReserveRatio > 0) {
      const usage = await fetchZohoOrgApiUsage(accessToken, organizationId);
      apiCallsThisRun = 1;
      const reserveRemaining = scheduledQuotaReserveRemaining(usage.dailyLimit);
      apiBudget = Math.max(0, usage.remaining - reserveRemaining);
      if (apiBudget <= 0) quotaReserved = true;
    }

    while (!completed && !rateLimited && !quotaReserved) {
      const list = await zohoCallWithRetry(
        () => fetchPurchaseOrdersListPage(accessToken, organizationId, page, {
          sortColumn: 'last_modified_time',
          sortOrder: 'D',
        }),
        `PO list page ${page}`,
      );
      trackZohoCall();

      const rows = list.purchaseOrders;
      for (; index < rows.length; index += 1) {
        if (shouldStopForQuota()) {
          quotaReserved = true;
          break;
        }
        const summary = rows[index];
        const poId = String(summary.purchaseorder_id ?? '');
        if (!poId) continue;

        try {
          const existingSnap = await poCollection().doc(poId).get();
          const existing = existingSnap.exists ? existingSnap.data() : null;
          if (detailStillValid(existing, summary)) {
            unchanged += 1;
            synced += 1;
            continue;
          }
          const fullRaw = await zohoCallWithRetry(
            () => fetchPurchaseOrderRaw(accessToken, organizationId, poId),
            `PO ${poId}`,
          );
          trackZohoCall();
          if (!fullRaw) {
            failed += 1;
            continue;
          }
          await upsertPurchaseOrderFromRaw(fullRaw);
          newlyPulled += 1;
          synced += 1;
        } catch (err) {
          if (err?.code === 'RATE_LIMITED' || err?.status === 429) {
            rateLimited = true;
            break;
          }
          failed += 1;
          console.warn('PO sync item failed:', err?.message ?? err);
        }

        if (newlyPulled > 0 && newlyPulled % 25 === 0) {
          pulledCount = Math.max(baselinePulled, baselinePulled + newlyPulled + unchanged);
          await writeOrgSyncMeta({
            pulledCount,
            checkpointPage: page,
            checkpointIndex: index + 1,
            lastRunSummary: {
              synced, failed, unchanged, newlyPulled, rateLimited: false, quotaReserved: false, inProgress: true,
            },
          });
        }
      }

      if (rateLimited || quotaReserved) break;

      if (!list.hasMore) {
        completed = true;
        break;
      }
      page += 1;
      index = 0;
    }

    pulledCount = Math.max(baselinePulled, baselinePulled + newlyPulled + unchanged);
    const finalStatus = completed ? 'complete' : 'idle';
    await writeOrgSyncMeta({
      status: finalStatus,
      pulledCount,
      checkpointPage: completed ? 1 : page,
      checkpointIndex: completed ? 0 : index,
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunSource: source,
      lastRunSummary: {
        synced, failed, unchanged, newlyPulled, rateLimited, quotaReserved, inProgress: false,
      },
      ...(completed ? { completedAt: FieldValue.serverTimestamp() } : {}),
    });

    const remaining = totalInRange == null ? null : Math.max(0, totalInRange - pulledCount);
    const message = rateLimited
      ? 'Zoho rate limit reached. Progress saved — wait, then Pull again.'
      : quotaReserved
        ? 'Stopped to preserve Zoho API quota. Resume with Pull now.'
        : completed
          ? 'All purchase orders are synced.'
          : 'Purchase order sync paused.';

    return {
      status: finalStatus,
      syncedCount: synced,
      failedCount: failed,
      skippedCount: 0,
      unchangedCount: unchanged,
      newlyPulled,
      totalInRange,
      pulledCount,
      remaining,
      completed,
      rateLimited,
      quotaReserved,
      message,
    };
  } catch (err) {
    await writeOrgSyncMeta({
      status: 'idle',
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunSource: source,
      lastRunSummary: {
        synced, failed, unchanged, newlyPulled, rateLimited: true, quotaReserved: false, inProgress: false,
        error: err?.message ?? String(err),
      },
    }).catch(() => {});
    throw err;
  }
}

export async function reclassifyPurchaseOrderCategoriesFromCatalog(options = {}) {
  const limit = Math.min(Math.max(Number(options.batchSize ?? 500) || 500, 50), 2000);
  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  const counts = { product: 0, spare: 0, service: 0, software_key: 0 };

  let lastDoc = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = poCollection().orderBy('__name__').limit(limit);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    const itemIds = [];
    for (const docSnap of snap.docs) {
      const lines = Array.isArray(docSnap.data()?.lineItems) ? docSnap.data().lineItems : [];
      for (const line of lines) {
        if (line?.itemId) itemIds.push(String(line.itemId));
      }
    }
    const catalog = await loadCatalogMeta(itemIds);
    const batch = getFirestore().batch();
    let batchWrites = 0;

    for (const docSnap of snap.docs) {
      scanned += 1;
      const data = docSnap.data() || {};
      const lines = Array.isArray(data.lineItems) ? data.lineItems : [];
      const next = classifyInvoiceFromLineItems(lines, catalog);
      counts[next] = (counts[next] || 0) + 1;
      const current = parseInvoiceCategory(data.purchaseOrderCategory);
      if (current === next) {
        unchanged += 1;
        continue;
      }
      batch.update(docSnap.ref, { purchaseOrderCategory: next });
      batchWrites += 1;
      updated += 1;
    }
    if (batchWrites) await batch.commit();
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < limit) break;
  }

  return { scanned, updated, unchanged, counts };
}

export async function ensurePurchaseOrderPdf(secrets, orgId, poId) {
  const id = String(poId || '').trim();
  if (!id) throw new Error('Purchase order id is required.');
  const ref = poCollection().doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Purchase order not found.');
  const data = snap.data() || {};
  const path = data.pdfStoragePath || pdfPath(id);
  const file = storageBucket().file(path);
  const [exists] = await file.exists();
  if (exists) {
    const [buf] = await file.download();
    return {
      contentBase64: buf.toString('base64'),
      filename: `${data.purchaseOrderNumber || id}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const url = new URL(`${ZOHO_API_BASE}/purchaseorders/${id}`);
  url.searchParams.set('organization_id', organizationId);
  const res = await fetch(url.toString(), {
    headers: {
      ...authHeaders(accessToken, organizationId),
      Accept: 'application/pdf',
    },
  });
  await recordZohoApiResponse(res, { operation: `purchaseorders/${id}/pdf`, source: 'purchase-order-sync' });
  if (!res.ok) {
    throw new Error(`Could not download purchase order PDF (${res.status}).`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('PDF file is empty.');
  await file.save(buffer, { resumable: false, contentType: 'application/pdf' });
  await ref.set({ pdfStoragePath: path }, { merge: true });
  return {
    contentBase64: buffer.toString('base64'),
    filename: `${data.purchaseOrderNumber || id}.pdf`,
    mimeType: 'application/pdf',
  };
}

export function mapPurchaseOrderDoc(id, data) {
  return {
    id,
    purchaseOrderNumber: String(data.purchaseOrderNumber ?? ''),
    date: data.date ?? null,
    deliveryDate: data.deliveryDate ?? null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ?? null,
    currencyCode: String(data.currencyCode ?? 'INR'),
    vendorId: String(data.vendorId ?? ''),
    vendorName: data.vendorName ?? null,
    subtotal: Number(data.subtotal ?? 0),
    taxTotal: Number(data.taxTotal ?? 0),
    notes: data.notes ?? null,
    lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
    purchaseOrderCategory: parseInvoiceCategory(data.purchaseOrderCategory),
    itemQuantity: data.itemQuantity != null
      ? Number(data.itemQuantity)
      : (Array.isArray(data.lineItems)
        ? data.lineItems.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
        : null),
    syncedAt: data.syncedAt?.toDate?.()?.toISOString?.()
      ?? (typeof data.syncedAt === 'string' ? data.syncedAt : null),
    searchBlob: data.searchBlob ?? '',
    pdfStoragePath: data.pdfStoragePath ?? null,
  };
}
