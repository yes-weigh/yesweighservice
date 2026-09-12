/**
 * Zoho webhook ACK policy: never HTTP 500 for daily quota or 401/57.
 * Queue the id and drain when quota recovers so Zoho does not disable the webhook.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { peekZohoApiUsageCached } from './zoho-api-usage.js';

export const WEBHOOK_RETRY_COLLECTION = 'zohoWebhookRetries';
const RETRY_META = 'zohoMeta/webhookRetry';
const DRAIN_MIN_REMAINING = 80;
const DRAIN_MAX_PER_RUN = 30;

export function isZohoQuotaError(err) {
  if (!err) return false;
  if (err.code === 'RATE_LIMITED' || err.dailyQuota === true) return true;
  const text = String(err.message ?? '').toLowerCase();
  return text.includes('maximum call rate limit')
    || text.includes('10,000')
    || text.includes('10000');
}

export function isZohoUnauthorizedError(err) {
  if (!err) return false;
  const status = Number(err.status);
  const zohoCode = Number(err.zohoCode);
  if (status === 401 || status === 403) return true;
  if (zohoCode === 57) return true;
  const text = String(err.message ?? '').toLowerCase();
  return text.includes('not authorized') || text.includes('unauthorized');
}

export function isZohoWebhookAckError(err) {
  return isZohoQuotaError(err) || isZohoUnauthorizedError(err);
}

function retryDocId(kind, entityId) {
  return `${kind}_${String(entityId).replace(/[/\\]/g, '_')}`;
}

export async function enqueueZohoWebhookRetry({
  kind,
  entityId,
  reason,
  status = 'pending',
  lastError = null,
}) {
  const id = String(entityId ?? '').trim();
  if (!kind || !id) return;
  const ref = getFirestore().collection(WEBHOOK_RETRY_COLLECTION).doc(retryDocId(kind, id));
  await ref.set({
    kind,
    entityId: id,
    reason: reason || 'quota',
    status,
    lastError: lastError ? String(lastError).slice(0, 500) : null,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function ackZohoWebhookFailure(kind, entityId, err) {
  if (!isZohoWebhookAckError(err)) return null;
  const id = String(entityId ?? '').trim();
  const unauthorized = isZohoUnauthorizedError(err);
  const reason = unauthorized ? 'unauthorized' : 'quota';
  if (id) {
    await enqueueZohoWebhookRetry({
      kind,
      entityId: id,
      reason,
      status: unauthorized ? 'blocked' : 'pending',
      lastError: err?.message ?? String(err),
    });
  }
  console.warn(
    `Zoho ${kind} webhook ACK 200 (${reason})`
    + (id ? ` for ${id}` : '')
    + `: ${err?.message ?? err}`,
  );
  return {
    ok: true,
    status: 200,
    deferred: true,
    reason,
    entityId: id || null,
  };
}

async function processRetry(secrets, orgId, row) {
  const kind = String(row.kind ?? '');
  const entityId = String(row.entityId ?? '').trim();
  if (!entityId) return { skipped: true };

  if (kind === 'salesorder') {
    const { mirrorSalesOrderFromZoho } = await import('./sales-order-sync.js');
    await mirrorSalesOrderFromZoho(secrets, orgId, entityId);
    return { kind, entityId };
  }
  if (kind === 'invoice') {
    const { syncSingleInvoiceFromZoho } = await import('./invoice-sync.js');
    await syncSingleInvoiceFromZoho(secrets, orgId, entityId, {
      source: 'webhook-retry',
      skipPdfs: true,
    });
    return { kind, entityId };
  }
  if (kind === 'purchaseorder') {
    const { mirrorPurchaseOrderFromZoho } = await import('./purchase-order-sync.js');
    await mirrorPurchaseOrderFromZoho(secrets, orgId, entityId);
    return { kind, entityId };
  }
  if (kind === 'goodsreceipt') {
    const { mirrorGoodsReceiptFromZoho } = await import('./goods-receipt-sync.js');
    await mirrorGoodsReceiptFromZoho(secrets, orgId, entityId);
    return { kind, entityId };
  }
  if (kind === 'item') {
    const { mirrorCatalogItemFromZoho } = await import('./catalog-sync.js');
    await mirrorCatalogItemFromZoho(secrets, orgId, entityId, {
      skipImages: true,
      source: 'webhook-retry',
    });
    return { kind, entityId };
  }
  if (kind === 'customer') {
    const { upsertCustomerFromZoho } = await import('./zoho-customers.js');
    await upsertCustomerFromZoho(secrets, orgId, entityId);
    return { kind, entityId };
  }
  return { skipped: true, kind };
}

export async function drainZohoWebhookRetries(secrets, orgId, options = {}) {
  const max = Math.min(80, Math.max(1, Number(options.max) || DRAIN_MAX_PER_RUN));
  const usage = await peekZohoApiUsageCached();
  if (usage.status === 'daily_limit' || usage.remaining <= DRAIN_MIN_REMAINING) {
    const summary = {
      drained: 0,
      failed: 0,
      skipped: 'quota',
      remaining: usage.remaining,
      status: usage.status,
    };
    console.log(
      `Zoho webhook retry drain skipped (quota remaining=${usage.remaining}, status=${usage.status}).`,
    );
    await getFirestore().doc(RETRY_META).set({
      lastDrainAt: FieldValue.serverTimestamp(),
      lastDrainSummary: summary,
    }, { merge: true });
    return summary;
  }

  const snap = await getFirestore()
    .collection(WEBHOOK_RETRY_COLLECTION)
    .where('status', '==', 'pending')
    .limit(max)
    .get();

  let drained = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    try {
      await processRetry(secrets, orgId, data);
      await doc.ref.delete();
      drained += 1;
    } catch (err) {
      if (isZohoQuotaError(err)) {
        await enqueueZohoWebhookRetry({
          kind: data.kind,
          entityId: data.entityId,
          reason: 'quota',
          status: 'pending',
          lastError: err?.message ?? String(err),
        });
        console.warn('Zoho webhook retry drain hit quota — stopping this run.');
        break;
      }
      if (isZohoUnauthorizedError(err)) {
        await enqueueZohoWebhookRetry({
          kind: data.kind,
          entityId: data.entityId,
          reason: 'unauthorized',
          status: 'blocked',
          lastError: err?.message ?? String(err),
        });
        failed += 1;
        continue;
      }
      failed += 1;
      await doc.ref.set({
        lastError: String(err?.message ?? err).slice(0, 500),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      console.warn(
        `Zoho webhook retry failed ${data.kind}/${data.entityId}:`,
        err?.message ?? err,
      );
    }
  }

  const summary = { drained, failed, skipped: null, remaining: usage.remaining };
  await getFirestore().doc(RETRY_META).set({
    lastDrainAt: FieldValue.serverTimestamp(),
    lastDrainSummary: summary,
  }, { merge: true });
  console.log(
    `Zoho webhook retry drain: drained=${drained}, failed=${failed}, listed=${snap.size}.`,
  );
  return summary;
}

export async function loadZohoWebhookSettings() {
  const snap = await getFirestore().doc('zohoMeta/webhook').get();
  return snap.exists ? (snap.data() || {}) : {};
}

export async function ensureZohoWebhookSettings(actorName = 'YESWEIGH') {
  const crypto = await import('node:crypto');
  const ref = getFirestore().doc('zohoMeta/webhook');
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : {};
  let secret = String(existing.secret ?? '').trim();
  if (!secret) {
    secret = crypto.randomBytes(24).toString('hex');
    await ref.set({
      secret,
      enforceSignature: false,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorName,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  return {
    secret,
    enforceSignature: existing.enforceSignature === true,
    updatedAt: existing.updatedAt?.toDate?.()?.toISOString?.() ?? null,
  };
}

export async function setZohoWebhookEnforceSignature(enforce, actorName = 'YESWEIGH') {
  const current = await ensureZohoWebhookSettings(actorName);
  await getFirestore().doc('zohoMeta/webhook').set({
    enforceSignature: Boolean(enforce),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorName,
  }, { merge: true });
  return { ...current, enforceSignature: Boolean(enforce) };
}

export async function resolveZohoWebhookSecret(envSecret) {
  const fromEnv = String(envSecret ?? '').trim();
  if (fromEnv) return fromEnv;
  const stored = await loadZohoWebhookSettings();
  if (stored.enforceSignature === true && String(stored.secret ?? '').trim()) {
    return String(stored.secret).trim();
  }
  return '';
}
