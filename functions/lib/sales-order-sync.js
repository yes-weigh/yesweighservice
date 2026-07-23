/**
 * Zoho Inventory sales orders → Firestore mirror (org-wide, customer-scoped fields).
 * Pattern mirrors invoice-sync / org-invoice-sync, but docs live at salesOrders/{id}.
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

const COLLECTION = 'salesOrders';
const META_DOC = 'salesOrderMeta/orgSync';
/** Same pacing knobs as org-invoice-sync. */
const ORG_SYNC_CONCURRENCY = 2;
const ORG_SYNC_MAX_LIST_PAGES = 150;
const STALE_RUN_MS = 75 * 60 * 1000;
const LIST_PAGE_DELAY_MS = 400;
const DETAIL_PULL_DELAY_MS = 250;
const RATE_LIMIT_RETRIES = 6;
const RATE_LIMIT_BASE_MS = 30_000;
const LIST_SORT = { sortColumn: 'date', sortOrder: 'D' };
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

function soCollection() {
  return getFirestore().collection(COLLECTION);
}

function orgSyncRef() {
  return getFirestore().doc(META_DOC);
}

function pdfPath(soId) {
  return `salesorders/${soId}.pdf`;
}

async function zohoJsonRequest(accessToken, orgId, path) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  if (!url.searchParams.has('organization_id')) {
    url.searchParams.set('organization_id', orgId);
  }
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  await recordZohoApiResponse(res, { operation: path, source: 'sales-order-sync' });
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
    await recordZohoApiFailure(err, { operation: path, source: 'sales-order-sync' });
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
        await recordZohoApiFailure(err, { operation: label, source: 'sales-order-sync' }).catch(() => {});
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

async function fetchSalesOrdersListPage(accessToken, orgId, page, options = {}) {
  const url = new URL(`${ZOHO_API_BASE}/salesorders`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '200');
  url.searchParams.set('sort_column', options.sortColumn ?? 'last_modified_time');
  url.searchParams.set('sort_order', options.sortOrder ?? 'D');

  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  await recordZohoApiResponse(res, { operation: `salesorders/list?page=${page}`, source: 'sales-order-sync' });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = classifyZohoHttpError(res.status, payload);
    await recordZohoApiFailure(err, { operation: `salesorders/list?page=${page}`, source: 'sales-order-sync' });
    throw err;
  }
  return {
    salesOrders: payload?.salesorders ?? [],
    hasMore: Boolean(payload?.page_context?.has_more_page),
  };
}

async function fetchSalesOrderRaw(accessToken, orgId, soId) {
  const payload = await zohoJsonRequest(accessToken, orgId, `/salesorders/${soId}`);
  return payload?.salesorder ?? null;
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
    doc.salesOrderNumber,
    doc.customerName,
    doc.customerId,
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

function mapSalesOrder(raw) {
  const lineItems = Array.isArray(raw.line_items)
    ? raw.line_items.map(mapLineItem)
    : [];
  return {
    id: String(raw.salesorder_id ?? ''),
    salesOrderNumber: String(raw.salesorder_number ?? ''),
    date: raw.date ? String(raw.date) : null,
    shipmentDate: raw.shipment_date ? String(raw.shipment_date) : null,
    status: String(raw.status ?? 'draft'),
    total: Number(raw.total ?? 0),
    balance: Number(raw.balance ?? raw.total ?? 0),
    referenceNumber: raw.reference_number ? String(raw.reference_number) : null,
    currencyCode: String(raw.currency_code ?? 'INR'),
    customerId: raw.customer_id != null ? String(raw.customer_id) : '',
    customerName: raw.customer_name ? String(raw.customer_name) : null,
    subtotal: Number(raw.sub_total ?? raw.subtotal ?? 0),
    taxTotal: Number(raw.tax_total ?? 0),
    notes: raw.notes ? String(raw.notes) : null,
    lineItems,
    zohoLastModified: raw.last_modified_time ? String(raw.last_modified_time) : null,
  };
}

async function upsertSalesOrderFromRaw(raw, options = {}) {
  const mapped = mapSalesOrder(raw);
  if (!mapped.id) throw new Error('Missing salesorder_id.');

  const catalog = await loadCatalogMeta(mapped.lineItems.map(line => line.itemId).filter(Boolean));
  const salesOrderCategory = classifyInvoiceFromLineItems(mapped.lineItems, catalog);
  const now = Timestamp.now();
  const doc = {
    ...mapped,
    searchBlob: buildSearchBlob(mapped),
    salesOrderCategory,
    itemQuantity: mapped.lineItems.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    syncedAt: now,
    contentFingerprint: `${mapped.zohoLastModified}|${mapped.lineItems.length}|${mapped.total}`,
  };

  await soCollection().doc(mapped.id).set(doc, { merge: true });
  return { id: mapped.id, salesOrderCategory };
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

export async function getOrgSalesOrderSyncStatus() {
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
      const err = new Error('Sales order sync is already running.');
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
  const refs = summaries.map(s => soCollection().doc(String(s.salesorder_id)));
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

export async function countOrgSalesOrdersInRange(secrets, orgId) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  let page = 1;
  let totalInRange = 0;
  let pulledCount = 0;
  let hasMore = true;

  while (hasMore && page <= ORG_SYNC_MAX_LIST_PAGES) {
    const list = await zohoCallWithRetry(
      () => fetchSalesOrdersListPage(accessToken, organizationId, page, LIST_SORT),
      `SO count list page ${page}`,
    );
    totalInRange += list.salesOrders.length;
    pulledCount += await batchHasStoredDetail(list.salesOrders);
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

export async function syncOrgSalesOrdersToFirestore(secrets, orgId, options = {}) {
  const source = options.source ?? 'org-so-sync';
  let priorMeta;
  try {
    priorMeta = await beginOrgSyncRun();
  } catch (err) {
    if (err?.code === 'ALREADY_RUNNING') throw err;
    throw err;
  }

  console.log(
    `Org SO sync started (${source}): checkpoint page ${priorMeta.checkpointPage ?? 1} `
    + `index ${priorMeta.checkpointIndex ?? 0}, `
    + `pulled ${priorMeta.pulledCount ?? 0}/${priorMeta.totalInRange ?? '?'}.`,
  );

  let page = Number(priorMeta.checkpointPage ?? 1);
  let index = Number(priorMeta.checkpointIndex ?? 0);
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
        `Scheduled SO sync API budget: ${apiBudget.toLocaleString()} calls `
        + `(keeping ${Math.round(quotaReserveRatio * 100)}% / `
        + `${reserveRemaining.toLocaleString()} of ${usage.dailyLimit.toLocaleString()} daily quota).`,
      );
      if (apiBudget <= 0) {
        quotaReserved = true;
        console.log('Scheduled SO sync skipped — daily quota already at or below the 30% reserve.');
      }
    }

    const processSummary = async summary => {
      if (shouldStopForQuota()) {
        quotaReserved = true;
        return { synced: 0, unchanged: 0, failed: 0, skipped: 0, newlyPulled: 0, rateLimited: false, stopQuota: true };
      }

      const soId = String(summary.salesorder_id ?? '');
      if (!soId) {
        return { synced: 0, unchanged: 0, failed: 0, skipped: 1, newlyPulled: 0, rateLimited: false };
      }

      const existingSnap = await soCollection().doc(soId).get();
      const existing = existingSnap.exists ? existingSnap.data() : null;
      if (detailStillValid(existing, summary)) {
        return { synced: 1, unchanged: 1, failed: 0, skipped: 0, newlyPulled: 0, rateLimited: false };
      }

      let fullRaw;
      try {
        fullRaw = await zohoCallWithRetry(
          () => fetchSalesOrderRaw(accessToken, organizationId, soId),
          `SO ${soId}`,
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
        await upsertSalesOrderFromRaw(fullRaw);
        await sleep(DETAIL_PULL_DELAY_MS);
        return { synced: 1, unchanged: 0, failed: 0, skipped: 0, newlyPulled: 1, rateLimited: false };
      } catch (err) {
        console.warn('Org SO sync item failed:', err?.message ?? err);
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
          () => fetchSalesOrdersListPage(accessToken, organizationId, page, LIST_SORT),
          `SO list page ${page}`,
        );
        trackZohoCall();
      } catch (err) {
        if (err?.code === 'RATE_LIMITED') {
          rateLimited = true;
          break;
        }
        throw err;
      }

      const slice = list.salesOrders.slice(index);
      const results = await mapConcurrent(slice, ORG_SYNC_CONCURRENCY, processSummary);
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
        console.log(`Org SO sync progress: ${newlyPulled} newly pulled this run.`);
      }

      if (rateLimited || quotaReserved) {
        await writeOrgSyncMeta({ checkpointPage: page, checkpointIndex: index });
        break;
      }

      index = 0;
      if (!list.hasMore) {
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
    console.error('Org SO sync failed:', err?.message ?? err);
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
      ? `Scheduled sync stopped to preserve ${Math.round((quotaReserveRatio || SCHEDULED_API_QUOTA_RESERVE_RATIO) * 100)}% of today's Zoho API quota for daytime use. Resume with Pull now or wait for the next 4 AM run.`
      : completed
        ? 'All sales orders are synced.'
        : 'Sales order sync paused.';

  console.log(
    `Org SO sync finished (${source}): status=${completed ? 'complete' : 'idle'}, `
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

export async function reclassifySalesOrderCategoriesFromCatalog(options = {}) {
  const limit = Math.min(Math.max(Number(options.batchSize ?? 500) || 500, 50), 2000);
  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  const counts = { product: 0, spare: 0, service: 0, software_key: 0 };

  let lastDoc = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = soCollection().orderBy('__name__').limit(limit);
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
      const current = parseInvoiceCategory(data.salesOrderCategory);
      if (current === next) {
        unchanged += 1;
        continue;
      }
      batch.update(docSnap.ref, { salesOrderCategory: next });
      batchWrites += 1;
      updated += 1;
    }
    if (batchWrites) await batch.commit();
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < limit) break;
  }

  return { scanned, updated, unchanged, counts };
}

export async function ensureSalesOrderPdf(secrets, orgId, soId) {
  const id = String(soId || '').trim();
  if (!id) throw new Error('Sales order id is required.');
  const ref = soCollection().doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Sales order not found.');
  const data = snap.data() || {};
  const path = data.pdfStoragePath || pdfPath(id);
  const file = storageBucket().file(path);
  const [exists] = await file.exists();
  if (exists) {
    const [buf] = await file.download();
    return {
      contentBase64: buf.toString('base64'),
      filename: `${data.salesOrderNumber || id}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const url = new URL(`${ZOHO_API_BASE}/salesorders/${id}`);
  url.searchParams.set('organization_id', organizationId);
  const res = await fetch(url.toString(), {
    headers: {
      ...authHeaders(accessToken, organizationId),
      Accept: 'application/pdf',
    },
  });
  await recordZohoApiResponse(res, { operation: `salesorders/${id}/pdf`, source: 'sales-order-sync' });
  if (!res.ok) {
    throw new Error(`Could not download sales order PDF (${res.status}).`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('PDF file is empty.');
  await file.save(buffer, { resumable: false, contentType: 'application/pdf' });
  await ref.set({ pdfStoragePath: path }, { merge: true });
  return {
    contentBase64: buffer.toString('base64'),
    filename: `${data.salesOrderNumber || id}.pdf`,
    mimeType: 'application/pdf',
  };
}

export function mapSalesOrderDoc(id, data) {
  return {
    id,
    salesOrderNumber: String(data.salesOrderNumber ?? ''),
    date: data.date ?? null,
    shipmentDate: data.shipmentDate ?? null,
    status: String(data.status ?? 'draft'),
    total: Number(data.total ?? 0),
    balance: Number(data.balance ?? 0),
    referenceNumber: data.referenceNumber ?? null,
    currencyCode: String(data.currencyCode ?? 'INR'),
    customerId: String(data.customerId ?? ''),
    customerName: data.customerName ?? null,
    subtotal: Number(data.subtotal ?? 0),
    taxTotal: Number(data.taxTotal ?? 0),
    notes: data.notes ?? null,
    lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
    salesOrderCategory: parseInvoiceCategory(data.salesOrderCategory),
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
