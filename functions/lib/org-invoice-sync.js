import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId } from './zoho.js';
import {
  fetchInvoicesListPage,
  fetchInvoiceRaw,
  upsertInvoiceFromRaw,
  invoiceDetailStillValid,
  invoicesCollection,
  customerInvoiceMetaRef,
} from './invoice-sync.js';

const ORG_SYNC_CONCURRENCY = 6;
const ORG_SYNC_MAX_LIST_PAGES = 150;
const STALE_RUN_MS = 70 * 60 * 1000;
const LIST_SORT = { sortColumn: 'date', sortOrder: 'D' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function orgInvoiceSyncRef() {
  return getFirestore().collection('invoiceMeta').doc('orgSync');
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
    lastRunSummary: meta.lastRunSummary ?? null,
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
    const batch = await fetchInvoicesListPage(accessToken, organizationId, page, {
      ...LIST_SORT,
      delayMs: 200,
    });

    totalInRange += batch.invoices.length;
    pulledCount += await batchHasStoredDetail(batch.invoices);

    hasMore = batch.hasMore;
    page += 1;
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
  const runFromStart = page === 1 && index === 0;
  const baselinePulled = Number(priorMeta.pulledCount ?? 0);
  let pulledCount = baselinePulled;
  const totalInRange = priorMeta.totalInRange ?? null;

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  let unchanged = 0;
  let newlyPulled = 0;
  let completed = false;

  const publishProgress = async (force = false) => {
    if (!force && newlyPulled > 0 && newlyPulled % 25 !== 0) return;
    await writeOrgSyncMeta({
      pulledCount: baselinePulled + newlyPulled,
      lastRunSummary: {
        synced,
        failed,
        skipped,
        unchanged,
        newlyPulled,
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
        return { synced: 1, unchanged: 1, failed: 0, skipped: 0, newlyPulled: 0 };
      }

      let fullRaw;
      try {
        fullRaw = await fetchInvoiceRaw(accessToken, organizationId, invoiceId);
      } catch (err) {
        if (err?.code === 'RATE_LIMITED') await sleep(5000);
        return { synced: 0, unchanged: 0, failed: 1, skipped: 0, newlyPulled: 0 };
      }

      if (!fullRaw) {
        return { synced: 0, unchanged: 0, failed: 0, skipped: 1, newlyPulled: 0 };
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
        return { synced: 1, unchanged: 0, failed: 0, skipped: 0, newlyPulled: 1 };
      } catch (err) {
        console.warn('Org invoice sync item failed:', err?.message ?? err);
        return { synced: 0, unchanged: 0, failed: 1, skipped: 0, newlyPulled: 0 };
      }
    };

    while (!completed) {
      const batch = await fetchInvoicesListPage(accessToken, organizationId, page, LIST_SORT);
      const slice = batch.invoices.slice(index);

      const results = await mapConcurrent(slice, ORG_SYNC_CONCURRENCY, processSummary);
      for (const result of results) {
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

      index = 0;
      if (!batch.hasMore) {
        completed = true;
        page = 1;
        break;
      }
      page += 1;
      await writeOrgSyncMeta({ checkpointPage: page, checkpointIndex: 0 });
    }
  } catch (err) {
    await writeOrgSyncMeta({ status: 'idle' }).catch(() => {});
    console.error('Org invoice sync failed:', err?.message ?? err);
    throw err;
  } finally {
    pulledCount = runFromStart && completed
      ? newlyPulled + unchanged
      : baselinePulled + newlyPulled;
    if (completed && totalInRange != null) {
      pulledCount = Math.min(totalInRange, Math.max(pulledCount, baselinePulled + newlyPulled + unchanged));
    }
    const allDone = completed && (totalInRange == null || pulledCount >= totalInRange);
    const status = allDone ? 'complete' : 'idle';

    await writeOrgSyncMeta({
      status,
      totalInRange: totalInRange ?? priorMeta.totalInRange ?? null,
      pulledCount,
      checkpointPage: completed ? 1 : page,
      checkpointIndex: completed ? 0 : index,
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunSummary: {
        synced,
        failed,
        skipped,
        unchanged,
        newlyPulled,
        inProgress: false,
      },
      completedAt: allDone ? FieldValue.serverTimestamp() : priorMeta.completedAt ?? null,
    });
  }

  const finalStatus = completed ? 'complete' : 'idle';
  console.log(
    `Org invoice sync finished (${source}): status=${finalStatus}, newlyPulled=${newlyPulled}, `
    + `unchanged=${unchanged}, failed=${failed}, pulled=${pulledCount}/${totalInRange ?? '?'}.`,
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
  };
}
