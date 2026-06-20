import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId } from './zoho.js';
import {
  fetchInvoicesListPage,
  fetchInvoiceRaw,
  upsertInvoiceFromRaw,
  invoiceDetailStillValid,
  invoicesCollection,
  customerInvoiceMetaRef,
  defaultInvoiceSyncOptions,
} from './invoice-sync.js';

export const ORG_SYNC_DATE_FROM = '2025-04-01';
export const ORG_SYNC_DAILY_API_CAP = 8000;
const ORG_SYNC_TIME_BUDGET_MS = 8 * 60 * 1000;
const LIST_SORT = { sortColumn: 'date', sortOrder: 'D' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function orgInvoiceSyncRef() {
  return getFirestore().collection('invoiceMeta').doc('orgSync');
}

function zohoApiUsageRef() {
  return getFirestore().collection('invoiceMeta').doc('zohoApiUsage');
}

function istDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

function orgDateTo() {
  return istDateKey();
}

function invoiceDateValue(summary) {
  return String(summary?.date ?? '').slice(0, 10);
}

function invoiceInRange(summary, dateFrom, dateTo) {
  const date = invoiceDateValue(summary);
  if (!date) return true;
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

async function readApiUsageToday() {
  const key = istDateKey();
  const snap = await zohoApiUsageRef().get();
  return { key, count: Number(snap.data()?.[key] ?? 0) };
}

async function reserveApiCalls(count) {
  if (count <= 0) return;
  const { key } = await readApiUsageToday();
  await zohoApiUsageRef().set({
    [key]: FieldValue.increment(count),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function readOrgSyncMeta() {
  const snap = await orgInvoiceSyncRef().get();
  return snap.exists ? snap.data() : {};
}

function normalizeStatus(meta) {
  const status = String(meta.status ?? 'idle');
  if (status === 'running') return 'running';
  if (status === 'complete') return 'complete';
  if (status === 'paused_quota') return 'paused_quota';
  return 'idle';
}

export async function getOrgInvoiceSyncStatus() {
  const meta = await readOrgSyncMeta();
  const { count: apiCallsToday } = await readApiUsageToday();
  const totalInRange = meta.totalInRange ?? null;
  const pulledCount = meta.pulledCount ?? 0;
  const remaining = totalInRange == null ? null : Math.max(0, totalInRange - pulledCount);
  let status = normalizeStatus(meta);
  const startedAt = meta.runStartedAt?.toDate?.();
  if (status === 'running' && startedAt && Date.now() - startedAt.getTime() > 15 * 60 * 1000) {
    status = meta.completedAt ? 'complete' : (remaining === 0 ? 'complete' : 'idle');
  }

  return {
    dateFrom: meta.dateFrom ?? ORG_SYNC_DATE_FROM,
    dateTo: meta.dateTo ?? orgDateTo(),
    status: normalizeStatus(meta),
    totalInRange,
    pulledCount,
    remaining,
    queuedCount: remaining,
    apiCallsToday,
    dailyApiCap: ORG_SYNC_DAILY_API_CAP,
    apiRemainingToday: Math.max(0, ORG_SYNC_DAILY_API_CAP - apiCallsToday),
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
      && Date.now() - startedAt.getTime() > 15 * 60 * 1000;
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

export async function countOrgInvoicesInRange(secrets, orgId, options = {}) {
  const dateFrom = options.dateFrom ?? ORG_SYNC_DATE_FROM;
  const dateTo = options.dateTo ?? orgDateTo();
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  let apiCalls = 1;
  await reserveApiCalls(1);

  let page = 1;
  let totalInRange = 0;
  let pulledCount = 0;
  let hasMore = true;

  while (hasMore && page <= 200) {
    const batch = await fetchInvoicesListPage(accessToken, organizationId, page, {
      ...LIST_SORT,
      delayMs: options.delayMs ?? 250,
    });
    apiCalls += 1;
    await reserveApiCalls(1);

    const inRange = [];
    let reachedOlder = false;
    for (const summary of batch.invoices) {
      const date = invoiceDateValue(summary);
      if (date && date < dateFrom) {
        reachedOlder = true;
        break;
      }
      if (!invoiceInRange(summary, dateFrom, dateTo)) continue;
      inRange.push(summary);
    }

    totalInRange += inRange.length;
    pulledCount += await batchHasStoredDetail(inRange);

    if (reachedOlder) {
      hasMore = false;
    } else {
      hasMore = batch.hasMore;
      page += 1;
    }
  }

  const now = FieldValue.serverTimestamp();
  await writeOrgSyncMeta({
    dateFrom,
    dateTo,
    totalInRange,
    pulledCount,
    totalCountedAt: now,
    status: pulledCount >= totalInRange && totalInRange > 0 ? 'complete' : 'idle',
    completedAt: pulledCount >= totalInRange && totalInRange > 0 ? now : null,
    checkpointPage: 1,
    checkpointIndex: 0,
  });

  return {
    totalInRange,
    pulledCount,
    remaining: Math.max(0, totalInRange - pulledCount),
    apiCallsUsed: apiCalls,
  };
}

export async function syncOrgInvoicesToFirestore(secrets, orgId, options = {}) {
  const dateFrom = options.dateFrom ?? ORG_SYNC_DATE_FROM;
  const dateTo = options.dateTo ?? orgDateTo();
  const syncOpts = defaultInvoiceSyncOptions({ ...options, skipPdfs: true });
  const { delayMs, skipSalesOrder, skipImages } = syncOpts;
  const startedAt = Date.now();
  const source = options.source ?? 'org-sync';

  let priorMeta;
  try {
    priorMeta = await beginOrgSyncRun();
  } catch (err) {
    if (err?.code === 'ALREADY_RUNNING') throw err;
    throw err;
  }

  console.log(
    `Org invoice sync started (${source}): range ${dateFrom} → ${dateTo}, `
    + `checkpoint page ${priorMeta.checkpointPage ?? 1} index ${priorMeta.checkpointIndex ?? 0}, `
    + `pulled ${priorMeta.pulledCount ?? 0}/${priorMeta.totalInRange ?? '?'}.`,
  );

  const { count: apiUsedBefore } = await readApiUsageToday();
  let apiBudget = ORG_SYNC_DAILY_API_CAP - apiUsedBefore;
  if (apiBudget <= 0) {
    await writeOrgSyncMeta({ status: 'paused_quota' });
    console.log('Org invoice sync skipped: daily Zoho API cap already reached.');
    return {
      status: 'paused_quota',
      syncedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      unchangedCount: 0,
      apiCallsUsed: 0,
      apiRemainingToday: 0,
      message: 'Daily Zoho API cap reached. Resumes tomorrow.',
    };
  }

  let page = Number(priorMeta.checkpointPage ?? 1);
  let index = Number(priorMeta.checkpointIndex ?? 0);
  let pulledCount = Number(priorMeta.pulledCount ?? 0);
  let totalInRange = priorMeta.totalInRange ?? null;
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  let unchanged = 0;
  let newlyPulled = 0;
  let apiCallsUsed = 0;
  let pausedForQuota = false;
  let completed = false;

  try {
  const accessToken = await getAccessToken(secrets);
  apiBudget -= 1;
  apiCallsUsed += 1;
  await reserveApiCalls(1);

  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const upsertOptions = {
    skipPdfs: true,
    skipSalesOrder,
    skipImages,
    forcePdfs: false,
    source,
  };

  const processSummary = async summary => {
    if (Date.now() - startedAt > ORG_SYNC_TIME_BUDGET_MS) {
      pausedForQuota = true;
      return 'stop';
    }
    if (apiBudget <= 0) {
      pausedForQuota = true;
      return 'stop';
    }

    const invoiceId = String(summary.invoice_id);
    const customerId = String(summary.customer_id);
    const existingSnap = await invoicesCollection(customerId).doc(invoiceId).get();
    const existing = existingSnap.exists ? existingSnap.data() : null;

    if (invoiceDetailStillValid(existing, summary)) {
      unchanged += 1;
      synced += 1;
      return 'ok';
    }

    if (apiBudget <= 0) {
      pausedForQuota = true;
      return 'stop';
    }

    let fullRaw;
    try {
      fullRaw = await fetchInvoiceRaw(accessToken, organizationId, invoiceId);
      apiBudget -= 1;
      apiCallsUsed += 1;
      await reserveApiCalls(1);
    } catch (err) {
      failed += 1;
      if (err?.code === 'RATE_LIMITED') await sleep(5000);
      return 'ok';
    }

    if (!fullRaw) {
      skipped += 1;
      return 'ok';
    }

    try {
      await upsertInvoiceFromRaw(accessToken, organizationId, fullRaw, {
        ...upsertOptions,
        useProvidedRaw: true,
        existingDoc: existing,
      });
      synced += 1;
      newlyPulled += 1;
      await customerInvoiceMetaRef(customerId).set({
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      failed += 1;
      console.warn('Org invoice sync item failed:', err?.message ?? err);
    }

    if (delayMs) await sleep(delayMs);
    if (newlyPulled > 0 && newlyPulled % 50 === 0) {
      console.log(`Org invoice sync progress: ${newlyPulled} newly pulled this run (${apiCallsUsed} Zoho calls).`);
    }
    return 'ok';
  };

  try {
    while (!completed && !pausedForQuota) {
      if (Date.now() - startedAt > ORG_SYNC_TIME_BUDGET_MS) {
        pausedForQuota = true;
        break;
      }
      if (apiBudget <= 0) {
        pausedForQuota = true;
        break;
      }

      const batch = await fetchInvoicesListPage(accessToken, organizationId, page, LIST_SORT);
      apiBudget -= 1;
      apiCallsUsed += 1;
      await reserveApiCalls(1);

      for (let i = index; i < batch.invoices.length; i += 1) {
        const summary = batch.invoices[i];
        const date = invoiceDateValue(summary);
        if (date && date < dateFrom) {
          completed = true;
          index = 0;
          page = 1;
          break;
        }
        if (!invoiceInRange(summary, dateFrom, dateTo)) continue;

        const result = await processSummary(summary);
        if (result === 'stop') {
          await writeOrgSyncMeta({
            checkpointPage: page,
            checkpointIndex: i,
          });
          break;
        }
        index = i + 1;
      }

      if (completed || pausedForQuota) break;

      if (index >= batch.invoices.length) {
        if (!batch.hasMore) {
          completed = true;
          break;
        }
        page += 1;
        index = 0;
      } else {
        break;
      }
    }
  } finally {
    pulledCount += newlyPulled;
    const status = completed && !pausedForQuota
      ? 'complete'
      : (pausedForQuota ? 'paused_quota' : 'idle');

    await writeOrgSyncMeta({
      dateFrom,
      dateTo,
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
        apiCallsUsed,
      },
      completedAt: completed && !pausedForQuota ? FieldValue.serverTimestamp() : priorMeta.completedAt ?? null,
    });
  }
  } catch (err) {
    await writeOrgSyncMeta({ status: 'idle' }).catch(() => {});
    console.error('Org invoice sync failed:', err?.message ?? err);
    throw err;
  }

  const finalStatus = completed && !pausedForQuota
    ? 'complete'
    : (pausedForQuota ? 'paused_quota' : 'idle');
  console.log(
    `Org invoice sync finished (${source}): status=${finalStatus}, newlyPulled=${newlyPulled}, `
    + `unchanged=${unchanged}, failed=${failed}, apiCalls=${apiCallsUsed}, `
    + `pulled=${pulledCount}/${totalInRange ?? priorMeta.totalInRange ?? '?'}.`,
  );

  const { count: apiCallsToday } = await readApiUsageToday();
  return {
    status: finalStatus,
    syncedCount: synced,
    failedCount: failed,
    skippedCount: skipped,
    unchangedCount: unchanged,
    newlyPulled,
    apiCallsUsed,
    apiCallsToday,
    apiRemainingToday: Math.max(0, ORG_SYNC_DAILY_API_CAP - apiCallsToday),
    totalInRange: totalInRange ?? priorMeta.totalInRange ?? null,
    pulledCount,
    remaining: totalInRange == null
      ? null
      : Math.max(0, totalInRange - pulledCount),
    completed: completed && !pausedForQuota,
  };
}
