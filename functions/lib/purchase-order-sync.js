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
  classifyInvoiceCategoryBreakdown,
  classifyInvoiceFromLineItems,
  parseInvoiceCategory,
  sumNonFreightQuantity,
} from './invoice-category.js';
import { extractWebhookEvent } from './invoice-sync.js';

const COLLECTION = 'purchaseOrders';
const META_DOC = 'purchaseOrderMeta/orgSync';
/** Do not store or re-sync POs dated before this FY start. */
export const PURCHASE_ORDER_KEEP_AFTER_DATE = '2026-04-01';
/** Older POs that must still be mirrored and shown. */
export const PURCHASE_ORDER_KEEP_NUMBERS = ['PO-00279', 'PO-00283'];
/** Same pacing knobs as org-invoice-sync. */
const ORG_SYNC_CONCURRENCY = 2;
const ORG_SYNC_MAX_LIST_PAGES = 150;
const STALE_RUN_MS = 75 * 60 * 1000;
const LIST_PAGE_DELAY_MS = 400;
const DETAIL_PULL_DELAY_MS = 250;
const RATE_LIMIT_RETRIES = 6;
const RATE_LIMIT_BASE_MS = 30_000;
const LIST_SORT = {
  sortColumn: 'date',
  sortOrder: 'D',
  dateStart: PURCHASE_ORDER_KEEP_AFTER_DATE,
};
/** Nightly scheduled sync stops before consuming this share of the daily Zoho quota. */
export const SCHEDULED_API_QUOTA_RESERVE_RATIO = 0.30;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function scheduledQuotaReserveRemaining(dailyLimit) {
  return Math.ceil(Number(dailyLimit) * SCHEDULED_API_QUOTA_RESERVE_RATIO);
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

async function zohoJsonRequest(accessToken, orgId, path, { method = 'GET', body } = {}) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  if (!url.searchParams.has('organization_id')) {
    url.searchParams.set('organization_id', orgId);
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      ...authHeaders(accessToken, orgId),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
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
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err?.code !== 'RATE_LIMITED' || attempt >= RATE_LIMIT_RETRIES) {
        await recordZohoApiFailure(err, { operation: label, source: 'purchase-order-sync' }).catch(() => {});
        throw err;
      }
      const waitMs = RATE_LIMIT_BASE_MS * (attempt + 1);
      console.warn(
        `Zoho rate limit on ${label}, waiting ${waitMs / 1000}s `
        + `(retry ${attempt + 1}/${RATE_LIMIT_RETRIES})`,
      );
      await sleep(waitMs);
    }
  }
  return null;
}

async function mapConcurrent(items, concurrency, fn) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await fn(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function fetchPurchaseOrdersListPage(accessToken, orgId, page, options = {}) {
  const url = new URL(`${ZOHO_API_BASE}/purchaseorders`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '200');
  url.searchParams.set('sort_column', options.sortColumn ?? 'last_modified_time');
  url.searchParams.set('sort_order', options.sortOrder ?? 'D');
  url.searchParams.set('date_start', options.dateStart ?? PURCHASE_ORDER_KEEP_AFTER_DATE);

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
    doc.vendorState,
    doc.vendorCountry,
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

function pickVendorAddressFromPurchaseOrder(raw) {
  const billing = raw?.billing_address && typeof raw.billing_address === 'object'
    ? raw.billing_address
    : null;
  const shipping = raw?.delivery_address && typeof raw.delivery_address === 'object'
    ? raw.delivery_address
    : (raw?.shipping_address && typeof raw.shipping_address === 'object'
      ? raw.shipping_address
      : null);
  const addr = billing || shipping || null;
  const clean = (value) => {
    const s = value != null ? String(value).trim() : '';
    return s || null;
  };
  return {
    vendorState: clean(addr?.state ?? addr?.province ?? raw?.source_of_supply),
    vendorCountry: clean(addr?.country),
  };
}

function mapPurchaseOrder(raw) {
  const lineItems = Array.isArray(raw.line_items)
    ? raw.line_items.map(mapLineItem)
    : [];
  const vendorAddress = pickVendorAddressFromPurchaseOrder(raw);
  return {
    id: String(raw.purchaseorder_id ?? ''),
    purchaseOrderNumber: String(raw.purchaseorder_number ?? ''),
    date: raw.date ? String(raw.date) : null,
    createdTime: raw.created_time ? String(raw.created_time) : (raw.createdTime ? String(raw.createdTime) : null),
    deliveryDate: raw.delivery_date ? String(raw.delivery_date) : null,
    status: String(raw.status ?? 'draft').trim().toLowerCase(),
    total: Number(raw.total ?? 0),
    balance: Number(raw.balance ?? raw.total ?? 0),
    referenceNumber: raw.reference_number ? String(raw.reference_number) : null,
    currencyCode: String(raw.currency_code ?? 'INR'),
    vendorId: raw.vendor_id != null ? String(raw.vendor_id) : '',
    vendorName: raw.vendor_name ? String(raw.vendor_name) : null,
    vendorState: vendorAddress.vendorState,
    vendorCountry: vendorAddress.vendorCountry,
    subtotal: Number(raw.sub_total ?? raw.subtotal ?? 0),
    taxTotal: Number(raw.tax_total ?? 0),
    notes: raw.notes ? String(raw.notes) : null,
    lineItems,
    zohoLastModified: raw.last_modified_time ? String(raw.last_modified_time) : null,
  };
}

function purchaseOrderNumberKept(purchaseOrderNumber) {
  const number = String(purchaseOrderNumber ?? '').trim().toUpperCase();
  return PURCHASE_ORDER_KEEP_NUMBERS.includes(number);
}

function purchaseOrderDateKept(dateValue) {
  const date = String(dateValue ?? '').trim().slice(0, 10);
  return Boolean(date && date >= PURCHASE_ORDER_KEEP_AFTER_DATE);
}

function purchaseOrderShouldKeep(dateValue, purchaseOrderNumber) {
  return purchaseOrderNumberKept(purchaseOrderNumber) || purchaseOrderDateKept(dateValue);
}

function purchaseOrderListDate(summary) {
  return String(summary?.date ?? '').trim().slice(0, 10);
}

async function upsertPurchaseOrderFromRaw(raw, options = {}) {
  const mapped = mapPurchaseOrder(raw);
  if (!mapped.id) throw new Error('Missing purchaseorder_id.');
  if (!purchaseOrderShouldKeep(mapped.date, mapped.purchaseOrderNumber)) {
    await deletePurchaseOrderFromFirestore(mapped.id);
    return { id: mapped.id, purchaseOrderCategory: null, skipped: true };
  }

  const catalog = await loadCatalogMeta(mapped.lineItems.map(line => line.itemId).filter(Boolean));
  const categoryBreakdown = classifyInvoiceCategoryBreakdown(mapped.lineItems, catalog);
  const purchaseOrderCategory = categoryBreakdown.categories[0]
    ?? classifyInvoiceFromLineItems(mapped.lineItems, catalog);
  const now = Timestamp.now();
  const doc = {
    ...mapped,
    searchBlob: buildSearchBlob(mapped),
    purchaseOrderCategory,
    categories: categoryBreakdown.categories,
    categoryAmounts: categoryBreakdown.categoryAmounts,
    itemQuantity: sumNonFreightQuantity(mapped.lineItems),
    syncedAt: now,
    contentFingerprint: `${mapped.zohoLastModified}|${mapped.lineItems.length}|${mapped.total}`,
    forceKeep: purchaseOrderNumberKept(mapped.purchaseOrderNumber),
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

  while (hasMore && page <= ORG_SYNC_MAX_LIST_PAGES) {
    const list = await zohoCallWithRetry(
      () => fetchPurchaseOrdersListPage(accessToken, organizationId, page, LIST_SORT),
      `PO count list page ${page}`,
    );
    totalInRange += list.purchaseOrders.length;
    pulledCount += await batchHasStoredDetail(list.purchaseOrders);
    hasMore = list.hasMore;
    page += 1;
    if (hasMore) await sleep(LIST_PAGE_DELAY_MS);
  }

  const now = FieldValue.serverTimestamp();
  const priorMeta = await readOrgSyncMeta();
  const scopeChanged = priorMeta.totalInRange != null && priorMeta.totalInRange !== totalInRange;
  await writeOrgSyncMeta({
    totalInRange,
    pulledCount,
    keepAfterDate: PURCHASE_ORDER_KEEP_AFTER_DATE,
    totalCountedAt: now,
    status: priorMeta.status === 'running'
      ? 'running'
      : (pulledCount >= totalInRange && totalInRange > 0 ? 'complete' : 'idle'),
    completedAt: pulledCount >= totalInRange && totalInRange > 0 ? now : priorMeta.completedAt ?? null,
    checkpointPage: scopeChanged ? 1 : (priorMeta.checkpointPage ?? 1),
    checkpointIndex: scopeChanged ? 0 : (priorMeta.checkpointIndex ?? 0),
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

  console.log(
    `Org PO sync started (${source}): checkpoint page ${priorMeta.checkpointPage ?? 1} `
    + `index ${priorMeta.checkpointIndex ?? 0}, `
    + `pulled ${priorMeta.pulledCount ?? 0}/${priorMeta.totalInRange ?? '?'}.`,
  );

  let page = Number(priorMeta.checkpointPage ?? 1);
  let index = Number(priorMeta.checkpointIndex ?? 0);
  if (String(priorMeta.keepAfterDate ?? '') !== PURCHASE_ORDER_KEEP_AFTER_DATE) {
    console.log(
      `Org PO sync date window is now ${PURCHASE_ORDER_KEEP_AFTER_DATE}; restarting from page 1.`,
    );
    page = 1;
    index = 0;
    await writeOrgSyncMeta({
      keepAfterDate: PURCHASE_ORDER_KEEP_AFTER_DATE,
      checkpointPage: 1,
      checkpointIndex: 0,
    });
  }
  const baselinePulled = Number(priorMeta.pulledCount ?? 0);
  let pulledCount = baselinePulled;
  const totalInRange = priorMeta.totalInRange ?? null;

  let synced = 0;
  let failed = 0;
  let skipped = 0;
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

  const computePulledCount = () => Math.max(
    Number(priorMeta.pulledCount ?? 0),
    baselinePulled + newlyPulled + unchanged,
  );

  const publishProgress = async (force = false) => {
    if (!force && newlyPulled > 0 && newlyPulled % 25 !== 0) return;
    await writeOrgSyncMeta({
      pulledCount: computePulledCount(),
      checkpointPage: page,
      checkpointIndex: index,
      lastRunSummary: {
        synced,
        failed,
        skipped,
        unchanged,
        newlyPulled,
        rateLimited: false,
        quotaReserved: false,
        inProgress: true,
      },
    });
  };

  try {
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, orgId);

    if (quotaReserveRatio > 0) {
      const usage = await fetchZohoOrgApiUsage(accessToken, organizationId);
      apiCallsThisRun = 1;
      const reserveRemaining = scheduledQuotaReserveRemaining(usage.dailyLimit);
      apiBudget = Math.max(0, usage.remaining - reserveRemaining);
      console.log(
        `Scheduled PO sync API budget: ${apiBudget.toLocaleString()} calls `
        + `(keeping ${Math.round(quotaReserveRatio * 100)}% / `
        + `${reserveRemaining.toLocaleString()} of ${usage.dailyLimit.toLocaleString()} daily quota).`,
      );
      if (apiBudget <= 0) {
        quotaReserved = true;
        console.log('Scheduled PO sync skipped — daily quota already at or below the 30% reserve.');
      }
    }

    const processSummary = async summary => {
      if (shouldStopForQuota()) {
        quotaReserved = true;
        return { synced: 0, unchanged: 0, failed: 0, skipped: 0, newlyPulled: 0, rateLimited: false, stopQuota: true };
      }

      const poId = String(summary.purchaseorder_id ?? '');
      if (!poId) {
        return { synced: 0, unchanged: 0, failed: 0, skipped: 1, newlyPulled: 0, rateLimited: false };
      }
      const listDate = purchaseOrderListDate(summary);
      if (listDate && !purchaseOrderShouldKeep(listDate, summary.purchaseorder_number)) {
        return { synced: 0, unchanged: 0, failed: 0, skipped: 1, newlyPulled: 0, rateLimited: false };
      }

      const existingSnap = await poCollection().doc(poId).get();
      const existing = existingSnap.exists ? existingSnap.data() : null;
      if (detailStillValid(existing, summary)) {
        return { synced: 1, unchanged: 1, failed: 0, skipped: 0, newlyPulled: 0, rateLimited: false };
      }

      let fullRaw;
      try {
        fullRaw = await zohoCallWithRetry(
          () => fetchPurchaseOrderRaw(accessToken, organizationId, poId),
          `PO ${poId}`,
        );
        trackZohoCall();
      } catch (err) {
        if (err?.code === 'RATE_LIMITED') {
          return { synced: 0, unchanged: 0, failed: 0, skipped: 0, newlyPulled: 0, rateLimited: true };
        }
        return { synced: 0, unchanged: 0, failed: 1, skipped: 0, newlyPulled: 0, rateLimited: false };
      }

      if (!fullRaw) {
        return { synced: 0, unchanged: 0, failed: 0, skipped: 1, newlyPulled: 0, rateLimited: false };
      }

      try {
        await upsertPurchaseOrderFromRaw(fullRaw);
        await sleep(DETAIL_PULL_DELAY_MS);
        return { synced: 1, unchanged: 0, failed: 0, skipped: 0, newlyPulled: 1, rateLimited: false };
      } catch (err) {
        console.warn('Org PO sync item failed:', err?.message ?? err);
        return { synced: 0, unchanged: 0, failed: 1, skipped: 0, newlyPulled: 0, rateLimited: false };
      }
    };

    while (!completed && !rateLimited && !quotaReserved) {
      if (shouldStopForQuota()) {
        quotaReserved = true;
        break;
      }

      let list;
      try {
        list = await zohoCallWithRetry(
          () => fetchPurchaseOrdersListPage(accessToken, organizationId, page, LIST_SORT),
          `PO list page ${page}`,
        );
        trackZohoCall();
      } catch (err) {
        if (err?.code === 'RATE_LIMITED') {
          rateLimited = true;
          break;
        }
        throw err;
      }

      const slice = list.purchaseOrders.slice(index);
      const toProcess = [];
      let reachedOldCutoff = false;
      for (const summary of slice) {
        const listDate = purchaseOrderListDate(summary);
        if (listDate && !purchaseOrderDateKept(listDate)) {
          reachedOldCutoff = true;
          break;
        }
        toProcess.push(summary);
      }
      const results = await mapConcurrent(toProcess, ORG_SYNC_CONCURRENCY, processSummary);
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        if (result.stopQuota) {
          quotaReserved = true;
          index += i;
          break;
        }
        if (result.rateLimited) {
          rateLimited = true;
          index += i;
          break;
        }
        synced += result.synced;
        unchanged += result.unchanged;
        failed += result.failed;
        skipped += result.skipped;
        newlyPulled += result.newlyPulled;
      }

      await publishProgress(true);

      if (newlyPulled > 0 && newlyPulled % 100 === 0) {
        console.log(`Org PO sync progress: ${newlyPulled} newly pulled this run.`);
      }

      if (rateLimited || quotaReserved) {
        await writeOrgSyncMeta({ checkpointPage: page, checkpointIndex: index });
        break;
      }

      index = 0;
      if (reachedOldCutoff || !list.hasMore) {
        completed = true;
        page = 1;
        break;
      }
      page += 1;
      await writeOrgSyncMeta({ checkpointPage: page, checkpointIndex: 0 });
      await sleep(LIST_PAGE_DELAY_MS);
    }
  } catch (err) {
    await writeOrgSyncMeta({
      status: 'idle',
      checkpointPage: page,
      checkpointIndex: index,
    }).catch(() => {});
    console.error('Org PO sync failed:', err?.message ?? err);
    throw err;
  } finally {
    const priorPulled = Number(priorMeta.pulledCount ?? 0);
    const runEstimate = baselinePulled + newlyPulled + unchanged;
    pulledCount = Math.max(priorPulled, runEstimate);
    if (completed && totalInRange != null) {
      pulledCount = Math.min(totalInRange, Math.max(pulledCount, runEstimate));
    }
    const allDone = completed && (totalInRange == null || pulledCount >= totalInRange);
    const status = allDone ? 'complete' : 'idle';

    await writeOrgSyncMeta({
      status,
      keepAfterDate: PURCHASE_ORDER_KEEP_AFTER_DATE,
      totalInRange: totalInRange ?? priorMeta.totalInRange ?? null,
      pulledCount,
      checkpointPage: completed ? 1 : page,
      checkpointIndex: completed ? 0 : (rateLimited || quotaReserved ? index : 0),
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunSource: source,
      lastRunSummary: {
        synced,
        failed,
        skipped,
        unchanged,
        newlyPulled,
        rateLimited,
        quotaReserved,
        inProgress: false,
      },
      ...(allDone ? { completedAt: FieldValue.serverTimestamp() } : {}),
    });
  }

  const remaining = totalInRange == null ? null : Math.max(0, totalInRange - pulledCount);
  const message = rateLimited
    ? 'Zoho API rate limit reached. Progress is saved at the current checkpoint — wait for quota to recover, then click Pull now again.'
    : quotaReserved
      ? `Scheduled sync stopped to preserve ${Math.round((quotaReserveRatio || SCHEDULED_API_QUOTA_RESERVE_RATIO) * 100)}% of today's Zoho API quota for daytime use. Resume with Pull now or wait for the next 3 AM run.`
      : completed
        ? 'All purchase orders are synced.'
        : 'Purchase order sync paused.';

  console.log(
    `Org PO sync finished (${source}): status=${completed ? 'complete' : 'idle'}, `
    + `newlyPulled=${newlyPulled}, unchanged=${unchanged}, failed=${failed}, rateLimited=${rateLimited}, `
    + `quotaReserved=${quotaReserved}, pulled=${pulledCount}/${totalInRange ?? '?'}.`,
  );

  return {
    status: completed && (totalInRange == null || pulledCount >= totalInRange) ? 'complete' : 'idle',
    syncedCount: synced,
    failedCount: failed,
    skippedCount: skipped,
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
}

export async function reclassifyPurchaseOrderCategoriesFromCatalog(options = {}) {
  const limit = Math.min(Math.max(Number(options.batchSize ?? 500) || 500, 50), 2000);
  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  const counts = { product: 0, spare: 0, service: 0, software_key: 0, gatc: 0 };

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
      const breakdown = classifyInvoiceCategoryBreakdown(lines, catalog);
      const next = breakdown.categories[0] ?? classifyInvoiceFromLineItems(lines, catalog);
      counts[next] = (counts[next] || 0) + 1;
      const current = parseInvoiceCategory(data.purchaseOrderCategory);
      const sameCategories = JSON.stringify(data.categories ?? []) === JSON.stringify(breakdown.categories);
      const sameAmounts = JSON.stringify(data.categoryAmounts ?? {}) === JSON.stringify(breakdown.categoryAmounts);
      if (current === next && sameCategories && sameAmounts) {
        unchanged += 1;
        continue;
      }
      batch.update(docSnap.ref, {
        purchaseOrderCategory: next,
        categories: breakdown.categories,
        categoryAmounts: breakdown.categoryAmounts,
      });
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
    categories: Array.isArray(data.categories) ? data.categories.map(String) : [],
    categoryAmounts: data.categoryAmounts && typeof data.categoryAmounts === 'object'
      ? { ...data.categoryAmounts }
      : {},
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

function normalizeWebhookBody(body) {
  if (!body || typeof body !== 'object') return {};
  let next = { ...body };
  if (typeof body.JSONString === 'string' && body.JSONString.trim()) {
    try {
      const parsed = JSON.parse(body.JSONString);
      if (parsed && typeof parsed === 'object') next = { ...next, ...parsed };
    } catch {
      // ignore malformed Zoho JSONString
    }
  }
  return next;
}

export function extractPurchaseOrderIdFromWebhook(body, query = {}) {
  const normalized = normalizeWebhookBody(body);
  const candidates = [
    query.purchaseorder_id,
    query.purchaseOrderId,
    query.purchase_order_id,
    query.id,
    normalized.purchaseorder_id,
    normalized.purchaseOrderId,
    normalized.purchase_order_id,
    normalized.purchaseorder?.purchaseorder_id,
    normalized.purchaseorder?.purchaseorderId,
    normalized.purchase_order?.purchaseorder_id,
    normalized.data?.purchaseorder_id,
    normalized.payload?.purchaseorder_id,
  ];
  for (const value of candidates) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

export function extractPurchaseOrderNumberFromWebhook(body, query = {}) {
  const normalized = normalizeWebhookBody(body);
  const candidates = [
    query.purchaseorder_number,
    query.purchaseOrderNumber,
    normalized.purchaseorder_number,
    normalized.purchaseOrderNumber,
    normalized.purchaseorder?.purchaseorder_number,
    normalized.purchase_order?.purchaseorder_number,
    normalized.data?.purchaseorder_number,
    normalized.payload?.purchaseorder_number,
  ];
  for (const value of candidates) {
    const number = String(value ?? '').trim();
    if (number) return number;
  }
  return null;
}

export function extractPurchaseOrderDateFromWebhook(body, query = {}) {
  const normalized = normalizeWebhookBody(body);
  const candidates = [
    query.date,
    normalized.date,
    normalized.purchaseorder?.date,
    normalized.purchase_order?.date,
    normalized.data?.date,
    normalized.payload?.date,
  ];
  for (const value of candidates) {
    const date = String(value ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  }
  return null;
}

export async function deletePurchaseOrderFromFirestore(purchaseOrderId) {
  const id = String(purchaseOrderId ?? '').trim();
  if (!id) return;
  await poCollection().doc(id).delete().catch(() => {});
  try {
    await storageBucket().file(pdfPath(id)).delete({ ignoreNotFound: true });
  } catch {
    // ignore missing / storage errors
  }
}

export async function deletePurchaseOrdersBeforeKeepDate({ onProgress, dryRun = false } = {}) {
  let scanned = 0;
  let deleted = 0;
  let last = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = poCollection().orderBy('__name__').limit(200);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (!snap.docs.length) break;
    for (const docSnap of snap.docs) {
      scanned += 1;
      const data = docSnap.data() ?? {};
      const date = String(data.date ?? '').trim().slice(0, 10);
      if (data.forceKeep || purchaseOrderShouldKeep(date, data.purchaseOrderNumber)) continue;
      if (!dryRun) {
        await deletePurchaseOrderFromFirestore(docSnap.id);
      }
      deleted += 1;
      onProgress?.({ scanned, deleted, id: docSnap.id, date: date || null, dryRun });
    }
    last = snap.docs[snap.docs.length - 1];
  }
  return { scanned, deleted, keepAfterDate: PURCHASE_ORDER_KEEP_AFTER_DATE, dryRun };
}

async function findPurchaseOrderIdByNumber(accessToken, orgId, purchaseOrderNumber) {
  const wanted = String(purchaseOrderNumber ?? '').trim().toUpperCase();
  if (!wanted) return null;
  const url = new URL(`${ZOHO_API_BASE}/purchaseorders`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('search_text', wanted);
  url.searchParams.set('per_page', '25');
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  await recordZohoApiResponse(res, { operation: 'purchaseorders/search', source: 'purchase-order-sync' });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = classifyZohoHttpError(res.status, payload);
    await recordZohoApiFailure(err, { operation: 'purchaseorders/search', source: 'purchase-order-sync' });
    throw err;
  }
  const rows = payload?.purchaseorders ?? [];
  const match = rows.find(row => String(row.purchaseorder_number ?? '').trim().toUpperCase() === wanted)
    ?? rows[0];
  return match?.purchaseorder_id ? String(match.purchaseorder_id) : null;
}

export async function importPurchaseOrdersByNumber(secrets, orgId, purchaseOrderNumbers) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const results = [];
  for (const rawNumber of purchaseOrderNumbers) {
    const number = String(rawNumber ?? '').trim();
    if (!number) continue;
    const id = await findPurchaseOrderIdByNumber(accessToken, organizationId, number);
    if (!id) {
      results.push({ number, ok: false, message: 'Not found in Zoho.' });
      continue;
    }
    const raw = await fetchPurchaseOrderRaw(accessToken, organizationId, id);
    if (!raw) {
      results.push({ number, id, ok: false, message: 'Detail missing in Zoho.' });
      continue;
    }
    const upserted = await upsertPurchaseOrderFromRaw(raw);
    results.push({
      number,
      id,
      ok: !upserted.skipped,
      skipped: Boolean(upserted.skipped),
      date: raw.date ?? null,
      status: raw.status ?? null,
    });
  }
  return results;
}

const PO_LOCKED_STATUSES = new Set(['cancelled', 'canceled', 'billed', 'closed', 'void']);

export async function updatePurchaseOrderInZoho(secrets, orgId, purchaseOrderId, patch = {}) {
  const id = String(purchaseOrderId ?? '').trim();
  if (!id) throw new Error('purchaseOrderId is required.');
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const raw = await fetchPurchaseOrderRaw(accessToken, organizationId, id);
  if (!raw) throw new Error('Purchase order not found in Zoho.');

  const status = String(raw.status ?? '').trim().toLowerCase();
  if (PO_LOCKED_STATUSES.has(status)) {
    throw new Error('This purchase order can no longer be edited.');
  }

  const lines = Array.isArray(patch.lines) ? patch.lines : [];
  const lineItems = lines
    .map(line => ({
      item_id: String(line.productId ?? line.itemId ?? '').trim(),
      name: line.name ? String(line.name) : undefined,
      quantity: Number(line.quantity) || 0,
      rate: Number(line.rate) || 0,
    }))
    .filter(line => line.item_id && line.quantity > 0);
  if (!lineItems.length) {
    throw new Error('Purchase order must have at least one item.');
  }

  const body = {
    vendor_id: String(patch.vendorId ?? raw.vendor_id ?? '').trim() || raw.vendor_id,
    date: String(patch.date ?? raw.date ?? '').trim().slice(0, 10) || raw.date,
    line_items: lineItems,
  };
  if (patch.deliveryDate !== undefined) {
    body.delivery_date = String(patch.deliveryDate ?? '').trim().slice(0, 10);
  } else if (raw.delivery_date) {
    body.delivery_date = raw.delivery_date;
  }
  if (patch.referenceNumber !== undefined) {
    body.reference_number = String(patch.referenceNumber ?? '').trim();
  } else if (raw.reference_number) {
    body.reference_number = raw.reference_number;
  }
  if (patch.notes !== undefined) {
    body.notes = String(patch.notes ?? '');
  } else if (raw.notes) {
    body.notes = raw.notes;
  }

  const payload = await zohoJsonRequest(
    accessToken,
    organizationId,
    `/purchaseorders/${id}`,
    { method: 'PUT', body },
  );
  const updated = payload?.purchaseorder ?? raw;
  await upsertPurchaseOrderFromRaw(updated);
  try {
    await storageBucket().file(pdfPath(id)).delete({ ignoreNotFound: true });
    await poCollection().doc(id).set({ pdfStoragePath: FieldValue.delete() }, { merge: true });
  } catch {
    // ignore stale PDF cache errors
  }
  return {
    id,
    purchaseOrderNumber: updated.purchaseorder_number
      ? String(updated.purchaseorder_number)
      : String(raw.purchaseorder_number ?? ''),
  };
}

/** Pull one PO from Zoho into Firestore (webhook / single refresh). */
export async function mirrorPurchaseOrderFromZoho(secrets, orgId, purchaseOrderId) {
  const id = String(purchaseOrderId ?? '').trim();
  if (!id) throw new Error('purchaseOrderId is required.');
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const raw = await fetchPurchaseOrderRaw(accessToken, organizationId, id);
  if (!raw) throw new Error('Purchase order not found in Zoho.');
  return upsertPurchaseOrderFromRaw(raw);
}

/**
 * Zoho Purchase Order webhook — create/edit/delete mirror in Firestore.
 */
export async function handleZohoPurchaseOrderWebhook(secrets, orgId, req) {
  const body = normalizeWebhookBody(req.body ?? {});
  const purchaseOrderId = extractPurchaseOrderIdFromWebhook(body, req.query ?? {});
  if (!purchaseOrderId) {
    return { ok: false, status: 400, message: 'Missing purchaseorder_id' };
  }

  const queryAction = String(req.query?.action ?? '').trim().toLowerCase();
  const event = queryAction || extractWebhookEvent(body);
  if (event.includes('delete')) {
    await deletePurchaseOrderFromFirestore(purchaseOrderId);
    return { ok: true, status: 200, action: 'deleted', purchaseOrderId };
  }

  const payloadDate = extractPurchaseOrderDateFromWebhook(body, req.query ?? {});
  const payloadNumber = extractPurchaseOrderNumberFromWebhook(body, req.query ?? {});
  if (payloadDate && !purchaseOrderShouldKeep(payloadDate, payloadNumber)) {
    await deletePurchaseOrderFromFirestore(purchaseOrderId);
    return {
      ok: true,
      status: 200,
      action: 'skipped',
      purchaseOrderId,
      date: payloadDate,
      keepAfterDate: PURCHASE_ORDER_KEEP_AFTER_DATE,
    };
  }

  const result = await mirrorPurchaseOrderFromZoho(secrets, orgId, purchaseOrderId);
  return {
    ok: true,
    status: 200,
    action: result?.skipped ? 'skipped' : 'synced',
    purchaseOrderId,
    result,
  };
}
