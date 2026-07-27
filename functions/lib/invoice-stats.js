/**
 * Invoice rollups, slim list summaries, and cold-archive helpers.
 * Kept separate from Zoho sync so upsert/delete can call small deltas.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const INVOICE_STATS_COLLECTION = 'invoiceStats';
export const INVOICE_MONTH_STATS_COLLECTION = 'invoiceMonthStats';
export const INVOICE_SUMMARIES_SUBCOLLECTION = 'invoiceSummaries';
export const INVOICE_SUMMARIES_ARCHIVE_SUBCOLLECTION = 'invoiceSummariesArchive';
export const INVOICES_ARCHIVE_SUBCOLLECTION = 'invoicesArchive';

/** Invoices with date older than this many months leave the hot path. */
export const INVOICE_ARCHIVE_AGE_MONTHS = 24;

const CATEGORY_KEYS = ['product', 'spare', 'software_key', 'service', 'gatc'];

function emptyByCategory() {
  return {
    product: 0,
    spare: 0,
    software_key: 0,
    service: 0,
    gatc: 0,
  };
}

export function amountExclGst(doc) {
  if (doc?.subtotal != null) {
    const subtotal = Number(doc.subtotal);
    if (Number.isFinite(subtotal)) return subtotal;
  }
  const total = Number(doc?.total ?? 0);
  if (doc?.taxTotal != null) {
    const taxTotal = Number(doc.taxTotal);
    if (Number.isFinite(taxTotal)) return Math.max(0, total - taxTotal);
  }
  return Number.isFinite(total) ? total : 0;
}

export function invoiceMonthKey(dateValue) {
  const raw = String(dateValue ?? '').trim();
  const match = /^(\d{4})-(\d{2})/.exec(raw);
  if (match) return `${match[1]}-${match[2]}`;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}`;
}

export function parseInvoiceCategoryKey(value) {
  const key = String(value ?? '').toLowerCase();
  return CATEGORY_KEYS.includes(key) ? key : null;
}

export function sumInvoiceItemQuantity(lineItems) {
  if (!Array.isArray(lineItems) || !lineItems.length) return null;
  let sum = 0;
  let any = false;
  for (const item of lineItems) {
    const name = String(item?.name ?? '').toLowerCase();
    // Skip obvious freight/fee lines when present
    if (name.includes('freight') || name.includes('stamping')) continue;
    const qty = Number(item?.quantity ?? 0);
    if (Number.isFinite(qty)) {
      sum += qty;
      any = true;
    }
  }
  return any ? sum : null;
}

export function buildInvoiceSummaryFields(invoiceDoc, customerId, invoiceId) {
  const itemQuantity = invoiceDoc.itemQuantity != null
    ? Number(invoiceDoc.itemQuantity)
    : sumInvoiceItemQuantity(invoiceDoc.lineItems);
  const amount = amountExclGst(invoiceDoc);
  return {
    id: String(invoiceId),
    customerId: String(customerId),
    invoiceNumber: String(invoiceDoc.invoiceNumber ?? ''),
    customerName: invoiceDoc.customerName ? String(invoiceDoc.customerName) : null,
    salespersonId: invoiceDoc.salespersonId ? String(invoiceDoc.salespersonId) : null,
    salespersonName: invoiceDoc.salespersonName ? String(invoiceDoc.salespersonName) : null,
    date: invoiceDoc.date ? String(invoiceDoc.date) : null,
    status: String(invoiceDoc.status ?? 'draft'),
    total: Number(invoiceDoc.total ?? 0),
    subtotal: invoiceDoc.subtotal != null ? Number(invoiceDoc.subtotal) : null,
    taxTotal: invoiceDoc.taxTotal != null ? Number(invoiceDoc.taxTotal) : null,
    balance: Number(invoiceDoc.balance ?? 0),
    referenceNumber: invoiceDoc.referenceNumber ? String(invoiceDoc.referenceNumber) : null,
    invoiceCategory: parseInvoiceCategoryKey(invoiceDoc.invoiceCategory),
    itemQuantity,
    amountExclGst: amount,
    syncedAt: invoiceDoc.syncedAt ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function statsDocRef(pathParts) {
  const db = getFirestore();
  return db.doc(`${INVOICE_STATS_COLLECTION}/${pathParts.join('/')}`);
}

function applyCategoryDelta(byCategory, category, deltaCount) {
  const next = { ...emptyByCategory(), ...(byCategory || {}) };
  const key = parseInvoiceCategoryKey(category);
  if (key) next[key] = Math.max(0, Number(next[key] ?? 0) + deltaCount);
  return next;
}

/**
 * Apply +1/-1 to org + month rollups for one invoice snapshot.
 * @param {'add'|'remove'} op
 */
export async function applyInvoiceStatsDelta(invoiceLike, op) {
  const sign = op === 'remove' ? -1 : 1;
  const countDelta = sign;
  const amountDelta = sign * amountExclGst(invoiceLike);
  const category = parseInvoiceCategoryKey(invoiceLike.invoiceCategory);
  const monthKey = invoiceMonthKey(invoiceLike.date);

  const db = getFirestore();
  const batch = db.batch();
  const orgRef = db.doc(`${INVOICE_STATS_COLLECTION}/org`);
  const updates = {
    count: FieldValue.increment(countDelta),
    amount: FieldValue.increment(amountDelta),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (category) {
    updates[`byCategory.${category}`] = FieldValue.increment(countDelta);
    updates[`amountByCategory.${category}`] = FieldValue.increment(amountDelta);
  }
  batch.set(orgRef, updates, { merge: true });

  if (monthKey) {
    const monthRef = db.doc(`${INVOICE_MONTH_STATS_COLLECTION}/${monthKey}`);
    batch.set(monthRef, updates, { merge: true });
  }

  await batch.commit();
}

/**
 * Reconcile stats when an invoice changes category/amount/date.
 */
export async function reconcileInvoiceStats(before, after) {
  if (before) await applyInvoiceStatsDelta(before, 'remove');
  if (after) await applyInvoiceStatsDelta(after, 'add');
}

export function invoiceSummaryRef(customerId, invoiceId) {
  return getFirestore()
    .collection('zohoCustomers')
    .doc(String(customerId))
    .collection(INVOICE_SUMMARIES_SUBCOLLECTION)
    .doc(String(invoiceId));
}

export async function upsertInvoiceSummary(customerId, invoiceId, invoiceDoc) {
  const fields = buildInvoiceSummaryFields(invoiceDoc, customerId, invoiceId);
  await invoiceSummaryRef(customerId, invoiceId).set(fields, { merge: true });
  return fields;
}

export async function deleteInvoiceSummary(customerId, invoiceId) {
  await invoiceSummaryRef(customerId, invoiceId).delete().catch(() => {});
}

export async function readInvoiceStatsConfig() {
  const snap = await getFirestore().doc(`${INVOICE_STATS_COLLECTION}/config`).get();
  return snap.exists ? (snap.data() ?? {}) : {};
}

export async function setInvoiceListSource(listSource) {
  await getFirestore().doc(`${INVOICE_STATS_COLLECTION}/config`).set({
    listSource,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * One-shot: rebuild org/month rollups and dual-write invoiceSummaries from hot invoices.
 */
export async function backfillInvoiceStatsAndSummaries({ onProgress } = {}) {
  const db = getFirestore();
  const customersSnap = await db.collection('zohoCustomers').select().get();
  let invoiceCount = 0;
  let summaryCount = 0;

  // Reset org stats, then rebuild.
  const orgRef = db.doc(`${INVOICE_STATS_COLLECTION}/org`);
  await orgRef.set({
    count: 0,
    amount: 0,
    byCategory: emptyByCategory(),
    amountByCategory: emptyByCategory(),
    updatedAt: FieldValue.serverTimestamp(),
    rebuiltAt: FieldValue.serverTimestamp(),
  });

  // Clear month docs in pages
  const monthsSnap = await db.collection(INVOICE_MONTH_STATS_COLLECTION).get();
  for (let i = 0; i < monthsSnap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of monthsSnap.docs.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
  }

  const monthAcc = new Map();

  for (const customerDoc of customersSnap.docs) {
    const customerId = customerDoc.id;
    const invSnap = await db.collection('zohoCustomers').doc(customerId).collection('invoices').get();
    let batch = db.batch();
    let batchOps = 0;

    const flush = async () => {
      if (!batchOps) return;
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    };

    for (const invDoc of invSnap.docs) {
      const data = invDoc.data() ?? {};
      const summary = buildInvoiceSummaryFields(data, customerId, invDoc.id);
      // Persist itemQuantity on fat doc for future list maps
      batch.set(invDoc.ref, { itemQuantity: summary.itemQuantity, amountExclGst: summary.amountExclGst }, { merge: true });
      batchOps += 1;
      batch.set(invoiceSummaryRef(customerId, invDoc.id), summary, { merge: true });
      batchOps += 1;
      summaryCount += 1;
      invoiceCount += 1;

      const monthKey = invoiceMonthKey(summary.date);
      const cat = parseInvoiceCategoryKey(summary.invoiceCategory);
      const amount = summary.amountExclGst;

      const bump = (acc) => {
        acc.count += 1;
        acc.amount += amount;
        if (cat) {
          acc.byCategory[cat] += 1;
          acc.amountByCategory[cat] += amount;
        }
      };

      if (!monthAcc.has('__org__')) {
        monthAcc.set('__org__', {
          count: 0,
          amount: 0,
          byCategory: emptyByCategory(),
          amountByCategory: emptyByCategory(),
        });
      }
      bump(monthAcc.get('__org__'));

      if (monthKey) {
        if (!monthAcc.has(monthKey)) {
          monthAcc.set(monthKey, {
            count: 0,
            amount: 0,
            byCategory: emptyByCategory(),
            amountByCategory: emptyByCategory(),
          });
        }
        bump(monthAcc.get(monthKey));
      }

      if (batchOps >= 400) await flush();
    }
    await flush();
    onProgress?.({ customerId, invoiceCount, summaryCount });
  }

  const orgAcc = monthAcc.get('__org__') || {
    count: 0,
    amount: 0,
    byCategory: emptyByCategory(),
    amountByCategory: emptyByCategory(),
  };
  await orgRef.set({
    ...orgAcc,
    updatedAt: FieldValue.serverTimestamp(),
    rebuiltAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  for (const [key, acc] of monthAcc) {
    if (key === '__org__') continue;
    await db.doc(`${INVOICE_MONTH_STATS_COLLECTION}/${key}`).set({
      ...acc,
      updatedAt: FieldValue.serverTimestamp(),
      rebuiltAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  await setInvoiceListSource('summaries');

  return { invoiceCount, summaryCount, monthDocs: monthAcc.size - 1 };
}

function archiveCutoffDateKey(months = INVOICE_ARCHIVE_AGE_MONTHS) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Move invoices with date < cutoff from hot collections into archive.
 * Does NOT change rollups (historical totals stay).
 */
export async function archiveOldInvoices({
  olderThanMonths = INVOICE_ARCHIVE_AGE_MONTHS,
  maxDocs = 500,
  onProgress,
} = {}) {
  const cutoff = archiveCutoffDateKey(olderThanMonths);
  const db = getFirestore();
  const customersSnap = await db.collection('zohoCustomers').select().get();
  let archived = 0;

  for (const customerDoc of customersSnap.docs) {
    if (archived >= maxDocs) break;
    const customerId = customerDoc.id;
    const hotCol = db.collection('zohoCustomers').doc(customerId).collection('invoices');
    const snap = await hotCol
      .where('date', '<', cutoff)
      .orderBy('date', 'asc')
      .limit(Math.min(100, maxDocs - archived))
      .get();

    for (const invDoc of snap.docs) {
      if (archived >= maxDocs) break;
      const data = invDoc.data() ?? {};
      const invoiceId = invDoc.id;
      const batch = db.batch();
      const archiveRef = db
        .collection('zohoCustomers')
        .doc(customerId)
        .collection(INVOICES_ARCHIVE_SUBCOLLECTION)
        .doc(invoiceId);
      batch.set(archiveRef, {
        ...data,
        archivedAt: FieldValue.serverTimestamp(),
        archivedFrom: 'invoices',
      });
      batch.delete(invDoc.ref);

      const summaryRef = invoiceSummaryRef(customerId, invoiceId);
      const summarySnap = await summaryRef.get();
      if (summarySnap.exists) {
        const archiveSummaryRef = db
          .collection('zohoCustomers')
          .doc(customerId)
          .collection(INVOICE_SUMMARIES_ARCHIVE_SUBCOLLECTION)
          .doc(invoiceId);
        batch.set(archiveSummaryRef, {
          ...summarySnap.data(),
          archivedAt: FieldValue.serverTimestamp(),
        });
        batch.delete(summaryRef);
      }

      await batch.commit();
      archived += 1;
      onProgress?.({ customerId, invoiceId, archived, cutoff });
    }
  }

  return { archived, cutoff };
}
