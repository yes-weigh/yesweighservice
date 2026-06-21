import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId } from './zoho.js';
import { recordZohoApiFailure } from './zoho-api-usage.js';
import {
  fetchInvoicesListPage,
  fetchInvoiceRaw,
  upsertInvoiceFromRaw,
  invoiceDetailStillValid,
  invoicesCollection,
  customerInvoiceMetaRef,
} from './invoice-sync.js';

const ORG_SYNC_CONCURRENCY = 2;
const ORG_SYNC_MAX_LIST_PAGES = 150;
const STALE_RUN_MS = 75 * 60 * 1000;
const LIST_PAGE_DELAY_MS = 400;
const RATE_LIMIT_RETRIES = 6;
const RATE_LIMIT_BASE_MS = 30_000;
const LIST_SORT = { sortColumn: 'date', sortOrder: 'D' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function orgInvoiceSyncRef() {
  return getFirestore().collection('invoiceMeta').doc('orgSync');
}

async function zohoCallWithRetry(fn, label) {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err?.code !== 'RATE_LIMITED' || attempt >= RATE_LIMIT_RETRIES) {
        await recordZohoApiFailure(err, { operation: label, source: 'org-invoice-sync' }).catch(() => {});
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

async function readOrgSyncMeta() {
  const snap = await orgInvoiceSyncRef().get();
  return snap.exists ? snap.data() : {};
}

function normalizeStatus(meta) {
  const status = String(meta.status ?? 'idle');
  if (status === 'running') return 'running';
  if (status === 'complete') return 'complete';
  if (status === 'paused_quota') return 'idle';
  return 'idle';
}

export async function getOrgInvoiceSyncStatus() {
  const meta = await readOrgSyncMeta();
  const totalInRange = meta.totalInRange ?? null;
  const pulledCount = meta.pulledCount ?? 0;
  const remaining = totalInRange == null ? null : Math.max(0, totalInRange - pulledCount);
  let status = normalizeStatus(meta);
  const startedAt = meta.runStartedAt?.toDate?.();
  if (status === 'running' && startedAt && Date.now() - startedAt.getTime() > STALE_RUN_MS) {
    status = pulledCount >= totalInRange && totalInRange > 0 ? 'complete' : 'idle';
    await writeOrgSyncMeta({ status }).catch(() => {});
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
  const ref = orgInvoiceSyncRef();
  return getFirestore().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const startedAt = data.runStartedAt?.toDate?.();
    const staleRun = data.status === 'running'
      && startedAt
      && Date.now() - startedAt.getTime() > STALE_RUN_MS;
    if (data.status === 'running' && !staleRun) {
      const err = new Error('Org invoice sync is already running.');
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
  await orgInvoiceSyncRef().set({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function batchHasStoredDetail(summaries) {
  const db = getFirestore();
  let pulled = 0;
  const refs = summaries.map(summary =>
    invoicesCollection(String(summary.customer_id)).doc(String(summary.invoice_id)),
  );

  for (let i = 0; i < refs.length; i += 100) {
    const chunk = refs.slice(i, i + 100);
    const snaps = await db.getAll(...chunk);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() ?? {};
      if (Array.isArray(data.lineItems) && data.lineItems.length > 0) {
        pulled += 1;
      }
    }
  }

  return pulled;
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

/** Count every org invoice in Zoho and how many already have details in Firestore. */
export async function countOrgInvoicesInRange(secrets, orgId) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  let page = 1;
  let totalInRange = 0;
  let pulledCount = 0;
  let hasMore = true;

  while (hasMore && page <= ORG_SYNC_MAX_LIST_PAGES) {
    const batch = await zohoCallWithRetry(
      () => fetchInvoicesListPage(accessToken, organizationId, page, LIST_SORT),
      `count list page ${page}`,
    );

    totalInRange += batch.invoices.length;
    pulledCount += await batchHasStoredDetail(batch.invoices);

    hasMore = batch.hasMore;
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

/** Pull invoice details for every org invoice until all are in Firestore. */
export async function syncOrgInvoicesToFirestore(secrets, orgId, options = {}) {
  const source = options.source ?? 'org-sync';

  let priorMeta;
  try {
    priorMeta = await beginOrgSyncRun();
  } catch (err) {
    if (err?.code === 'ALREADY_RUNNING') throw err;
    throw err;
  }

  console.log(
    `Org invoice sync started (${source}): checkpoint page ${priorMeta.checkpointPage ?? 1} `
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
        inProgress: true,
      },
    });
  };

  try {
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, orgId);
    const upsertOptions = {
      skipPdfs: true,
      skipSalesOrder: true,
      skipImages: true,
      forcePdfs: false,
      source,
    };

    const processSummary = async summary => {
      const invoiceId = String(summary.invoice_id);
      const customerId = String(summary.customer_id);
      const existingSnap = await invoicesCollection(customerId).doc(invoiceId).get();
      const existing = existingSnap.exists ? existingSnap.data() : null;

      if (invoiceDetailStillValid(existing, summary)) {
        return { synced: 1, unchanged: 1, failed: 0, skipped: 0, newlyPulled: 0, rateLimited: false };
      }

      let fullRaw;
      try {
        fullRaw = await zohoCallWithRetry(
          () => fetchInvoiceRaw(accessToken, organizationId, invoiceId),
          `invoice ${invoiceId}`,
        );
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
        await upsertInvoiceFromRaw(accessToken, organizationId, fullRaw, {
          ...upsertOptions,
          useProvidedRaw: true,
          existingDoc: existing,
        });
        await customerInvoiceMetaRef(customerId).set({
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        await sleep(250);
        return { synced: 1, unchanged: 0, failed: 0, skipped: 0, newlyPulled: 1, rateLimited: false };
      } catch (err) {
        console.warn('Org invoice sync item failed:', err?.message ?? err);
        return { synced: 0, unchanged: 0, failed: 1, skipped: 0, newlyPulled: 0, rateLimited: false };
      }
    };

    while (!completed && !rateLimited) {
      let batch;
      try {
        batch = await zohoCallWithRetry(
          () => fetchInvoicesListPage(accessToken, organizationId, page, LIST_SORT),
          `list page ${page}`,
        );
      } catch (err) {
        if (err?.code === 'RATE_LIMITED') {
          rateLimited = true;
          break;
        }
        throw err;
      }

      const slice = batch.invoices.slice(index);
      const results = await mapConcurrent(slice, ORG_SYNC_CONCURRENCY, processSummary);
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
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
        console.log(`Org invoice sync progress: ${newlyPulled} newly pulled this run.`);
      }

      if (rateLimited) {
        await writeOrgSyncMeta({ checkpointPage: page, checkpointIndex: index });
        break;
      }

      index = 0;
      if (!batch.hasMore) {
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
    console.error('Org invoice sync failed:', err?.message ?? err);
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
      checkpointIndex: completed ? 0 : (rateLimited ? index : 0),
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunSource: source,
      lastRunSummary: {
        synced,
        failed,
        skipped,
        unchanged,
        newlyPulled,
        rateLimited,
        inProgress: false,
      },
      completedAt: allDone ? FieldValue.serverTimestamp() : priorMeta.completedAt ?? null,
    });
  }

  const finalStatus = completed ? 'complete' : 'idle';
  const message = rateLimited
    ? 'Zoho API rate limit reached. Progress is saved at the current checkpoint — wait for quota to recover, then click Pull now again.'
    : undefined;

  console.log(
    `Org invoice sync finished (${source}): status=${finalStatus}, newlyPulled=${newlyPulled}, `
    + `unchanged=${unchanged}, failed=${failed}, rateLimited=${rateLimited}, `
    + `pulled=${pulledCount}/${totalInRange ?? '?'}.`,
  );

  return {
    status: finalStatus,
    syncedCount: synced,
    failedCount: failed,
    skippedCount: skipped,
    unchangedCount: unchanged,
    newlyPulled,
    totalInRange: totalInRange ?? priorMeta.totalInRange ?? null,
    pulledCount,
    remaining: totalInRange == null
      ? null
      : Math.max(0, totalInRange - pulledCount),
    completed,
    rateLimited,
    message,
  };
}
