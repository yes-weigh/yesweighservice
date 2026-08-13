/**
 * Invoice rollups, slim list summaries, and cold-archive helpers.
 * Kept separate from Zoho sync so upsert/delete can call small deltas.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const INVOICE_STATS_COLLECTION = 'invoiceStats';
export const INVOICE_MONTH_STATS_COLLECTION = 'invoiceMonthStats';
export const INVOICE_DEALER_STATS_COLLECTION = 'invoiceDealerStats';
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

export function parseInvoiceCategoryKeys(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    const key = parseInvoiceCategoryKey(entry);
    if (key) seen.add(key);
  }
  return CATEGORY_KEYS.filter(key => seen.has(key));
}

export function normalizeCategoryAmounts(value) {
  if (!value || typeof value !== 'object') return {};
  const next = {};
  for (const key of CATEGORY_KEYS) {
    const amount = Number(value[key] ?? 0);
    if (Number.isFinite(amount) && amount !== 0) next[key] = amount;
  }
  return next;
}

function categoriesFromInvoiceLike(invoiceLike) {
  const categories = parseInvoiceCategoryKeys(invoiceLike?.categories);
  if (categories.length) return categories;
  const legacy = parseInvoiceCategoryKey(invoiceLike?.invoiceCategory);
  return legacy ? [legacy] : [];
}

function categoryAmountsFromInvoiceLike(invoiceLike, amount) {
  const normalized = normalizeCategoryAmounts(invoiceLike?.categoryAmounts);
  if (Object.keys(normalized).length) return normalized;
  const legacy = parseInvoiceCategoryKey(invoiceLike?.invoiceCategory);
  return legacy ? { [legacy]: amount } : {};
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
  const categories = categoriesFromInvoiceLike(invoiceDoc);
  const categoryAmounts = categoryAmountsFromInvoiceLike(invoiceDoc, amount);
  const customerPickup = customerPickupForSummary(invoiceDoc.customerPickup);
  const customerPickupMarkedAt = invoiceDoc.customerPickupMarkedAt
    ? String(invoiceDoc.customerPickupMarkedAt).trim() || null
    : (customerPickup?.markedAt ?? null);
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
    categories,
    categoryAmounts,
    itemQuantity,
    amountExclGst: amount,
    customerPickup,
    customerPickupMarkedAt,
    syncedAt: invoiceDoc.syncedAt ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function customerPickupForSummary(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const markedAt = pickupMarkedAtForSummary(raw.markedAt);
  if (!markedAt) return null;
  return {
    markedAt,
    markedByUid: raw.markedByUid ? String(raw.markedByUid) : null,
    markedByName: raw.markedByName ? String(raw.markedByName) : null,
    shipFromSite: raw.shipFromSite ? String(raw.shipFromSite) : null,
    shipFromLabel: raw.shipFromLabel ? String(raw.shipFromLabel) : null,
    vehicleNumber: raw.vehicleNumber ? String(raw.vehicleNumber) : null,
  };
}

function pickupMarkedAtForSummary(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed && trimmed !== '[object Object]' ? trimmed : null;
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
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
 * Apply +1/-1 to org + month + dealer rollups for one invoice snapshot.
 * @param {'add'|'remove'} op
 */
export async function applyInvoiceStatsDelta(invoiceLike, op) {
  const sign = op === 'remove' ? -1 : 1;
  const countDelta = sign;
  const amount = amountExclGst(invoiceLike);
  const amountDelta = sign * amount;
  const totalDelta = sign * Number(invoiceLike?.total ?? 0);
  const balanceDelta = sign * Number(invoiceLike?.balance ?? 0);
  const qty = invoiceLike?.itemQuantity != null ? Number(invoiceLike.itemQuantity) : null;
  const qtyDelta = qty != null && Number.isFinite(qty) ? sign * qty : null;
  const categories = categoriesFromInvoiceLike(invoiceLike);
  const categoryAmounts = categoryAmountsFromInvoiceLike(invoiceLike, amount);
  const monthKey = invoiceMonthKey(invoiceLike.date);
  const customerId = String(invoiceLike?.customerId ?? '').trim();

  const db = getFirestore();
  const batch = db.batch();
  const orgRef = db.doc(`${INVOICE_STATS_COLLECTION}/org`);
  const updates = {
    count: FieldValue.increment(countDelta),
    amount: FieldValue.increment(amountDelta),
    updatedAt: FieldValue.serverTimestamp(),
  };
  for (const category of categories) {
    updates[`byCategory.${category}`] = FieldValue.increment(countDelta);
    updates[`documentAmountByCategory.${category}`] = FieldValue.increment(amountDelta);
    const categoryAmount = Number(categoryAmounts[category] ?? 0);
    if (categoryAmount) {
      updates[`amountByCategory.${category}`] = FieldValue.increment(sign * categoryAmount);
    }
  }
  batch.set(orgRef, updates, { merge: true });

  if (monthKey) {
    const monthRef = db.doc(`${INVOICE_MONTH_STATS_COLLECTION}/${monthKey}`);
    batch.set(monthRef, updates, { merge: true });
  }

  if (customerId) {
    const dealerRef = db.doc(`${INVOICE_DEALER_STATS_COLLECTION}/${customerId}`);
    const dealerUpdates = {
      customerId,
      count: FieldValue.increment(countDelta),
      amount: FieldValue.increment(amountDelta),
      total: FieldValue.increment(totalDelta),
      balance: FieldValue.increment(balanceDelta),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (qtyDelta != null) {
      dealerUpdates.itemQuantity = FieldValue.increment(qtyDelta);
    }
    for (const category of categories) {
      dealerUpdates[`byCategory.${category}`] = FieldValue.increment(countDelta);
      dealerUpdates[`documentAmountByCategory.${category}`] = FieldValue.increment(amountDelta);
      const categoryAmount = Number(categoryAmounts[category] ?? 0);
      if (categoryAmount) {
        dealerUpdates[`amountByCategory.${category}`] = FieldValue.increment(sign * categoryAmount);
      }
    }
    if (op === 'add') {
      if (invoiceLike.customerName) {
        dealerUpdates.customerName = String(invoiceLike.customerName);
      }
      if (invoiceLike.date) {
        dealerUpdates.latestDate = String(invoiceLike.date);
      }
      if (invoiceLike.syncedAt) {
        dealerUpdates.latestSyncedAt = invoiceLike.syncedAt;
      }
    }
    batch.set(dealerRef, dealerUpdates, { merge: true });
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
 * One-shot: rebuild org/month/dealer rollups and dual-write invoiceSummaries from hot invoices.
 * Dealer lifetime stats also include archived invoices so Aggregate Lifetime stays accurate.
 */
export async function backfillInvoiceStatsAndSummaries({ onProgress } = {}) {
  const db = getFirestore();
  const customersSnap = await db.collection('zohoCustomers').select().get();
  let invoiceCount = 0;
  let summaryCount = 0;
  let dealerDocs = 0;

  // Reset org stats, then rebuild.
  const orgRef = db.doc(`${INVOICE_STATS_COLLECTION}/org`);
  await orgRef.set({
    count: 0,
    amount: 0,
    byCategory: emptyByCategory(),
    amountByCategory: emptyByCategory(),
    documentAmountByCategory: emptyByCategory(),
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

  // Clear dealer docs in pages
  const dealersSnap = await db.collection(INVOICE_DEALER_STATS_COLLECTION).get();
  for (let i = 0; i < dealersSnap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of dealersSnap.docs.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
  }

  const monthAcc = new Map();
  const dealerAcc = new Map();

  const emptyRollup = () => ({
    count: 0,
    amount: 0,
    byCategory: emptyByCategory(),
    amountByCategory: emptyByCategory(),
    documentAmountByCategory: emptyByCategory(),
  });

  const emptyDealerRollup = (customerId) => ({
    customerId: String(customerId),
    customerName: null,
    count: 0,
    amount: 0,
    total: 0,
    balance: 0,
    itemQuantity: 0,
    hasItemQuantity: false,
    byCategory: emptyByCategory(),
    amountByCategory: emptyByCategory(),
    documentAmountByCategory: emptyByCategory(),
    latestDate: null,
    latestSyncedAt: null,
  });

  const bumpRollup = (acc, summary) => {
    const amount = summary.amountExclGst;
    const categories = categoriesFromInvoiceLike(summary);
    const categoryAmounts = categoryAmountsFromInvoiceLike(summary, amount);
    acc.count += 1;
    acc.amount += amount;
    for (const category of categories) {
      acc.byCategory[category] += 1;
      acc.documentAmountByCategory[category] += amount;
      acc.amountByCategory[category] += Number(categoryAmounts[category] ?? 0);
    }
  };

  const bumpDealer = (acc, summary) => {
    bumpRollup(acc, summary);
    acc.total += Number(summary.total ?? 0);
    acc.balance += Number(summary.balance ?? 0);
    if (summary.itemQuantity != null) {
      acc.itemQuantity += Number(summary.itemQuantity);
      acc.hasItemQuantity = true;
    }
    if (summary.customerName) acc.customerName = String(summary.customerName);
    const date = summary.date ? String(summary.date) : null;
    if (date && (!acc.latestDate || date > acc.latestDate)) {
      acc.latestDate = date;
    }
    const syncedAt = summary.syncedAt ?? null;
    if (syncedAt) acc.latestSyncedAt = syncedAt;
  };

  for (const customerDoc of customersSnap.docs) {
    const customerId = customerDoc.id;
    const hotCol = db.collection('zohoCustomers').doc(customerId).collection('invoices');
    const archiveCol = db.collection('zohoCustomers').doc(customerId).collection(INVOICES_ARCHIVE_SUBCOLLECTION);
    const [invSnap, archiveSnap] = await Promise.all([hotCol.get(), archiveCol.get()]);
    let batch = db.batch();
    let batchOps = 0;

    const flush = async () => {
      if (!batchOps) return;
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    };

    if (!dealerAcc.has(customerId)) {
      dealerAcc.set(customerId, emptyDealerRollup(customerId));
    }

    for (const invDoc of invSnap.docs) {
      const data = invDoc.data() ?? {};
      const summary = buildInvoiceSummaryFields(data, customerId, invDoc.id);
      // Persist derived hot-path fields on the fat doc for list/filter maps.
      batch.set(invDoc.ref, {
        itemQuantity: summary.itemQuantity,
        amountExclGst: summary.amountExclGst,
        categories: summary.categories,
        categoryAmounts: summary.categoryAmounts,
      }, { merge: true });
      batchOps += 1;
      batch.set(invoiceSummaryRef(customerId, invDoc.id), summary, { merge: true });
      batchOps += 1;
      summaryCount += 1;
      invoiceCount += 1;

      const monthKey = invoiceMonthKey(summary.date);
      if (!monthAcc.has('__org__')) monthAcc.set('__org__', emptyRollup());
      bumpRollup(monthAcc.get('__org__'), summary);
      bumpDealer(dealerAcc.get(customerId), summary);

      if (monthKey) {
        if (!monthAcc.has(monthKey)) monthAcc.set(monthKey, emptyRollup());
        bumpRollup(monthAcc.get(monthKey), summary);
      }

      if (batchOps >= 400) await flush();
    }

    // Archived invoices stay in lifetime dealer/org totals (archive move does not reverse rollups).
    for (const invDoc of archiveSnap.docs) {
      const data = invDoc.data() ?? {};
      const summary = buildInvoiceSummaryFields(data, customerId, invDoc.id);
      invoiceCount += 1;

      const monthKey = invoiceMonthKey(summary.date);
      if (!monthAcc.has('__org__')) monthAcc.set('__org__', emptyRollup());
      bumpRollup(monthAcc.get('__org__'), summary);
      bumpDealer(dealerAcc.get(customerId), summary);

      if (monthKey) {
        if (!monthAcc.has(monthKey)) monthAcc.set(monthKey, emptyRollup());
        bumpRollup(monthAcc.get(monthKey), summary);
      }
    }

    await flush();
    onProgress?.({ customerId, invoiceCount, summaryCount, dealerDocs: dealerAcc.size });
  }

  const orgAcc = monthAcc.get('__org__') || emptyRollup();
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

  let dealerBatch = db.batch();
  let dealerBatchOps = 0;
  for (const [customerId, acc] of dealerAcc) {
    if (!acc.count) continue;
    dealerBatch.set(db.doc(`${INVOICE_DEALER_STATS_COLLECTION}/${customerId}`), {
      customerId,
      customerName: acc.customerName,
      count: acc.count,
      amount: acc.amount,
      total: acc.total,
      balance: acc.balance,
      itemQuantity: acc.hasItemQuantity ? acc.itemQuantity : null,
      byCategory: acc.byCategory,
      amountByCategory: acc.amountByCategory,
      documentAmountByCategory: acc.documentAmountByCategory,
      latestDate: acc.latestDate,
      latestSyncedAt: acc.latestSyncedAt,
      updatedAt: FieldValue.serverTimestamp(),
      rebuiltAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    dealerBatchOps += 1;
    dealerDocs += 1;
    if (dealerBatchOps >= 400) {
      await dealerBatch.commit();
      dealerBatch = db.batch();
      dealerBatchOps = 0;
    }
  }
  if (dealerBatchOps) await dealerBatch.commit();

  await setInvoiceListSource('summaries');

  return {
    invoiceCount,
    summaryCount,
    monthDocs: Math.max(0, monthAcc.size - 1),
    dealerDocs,
  };
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
