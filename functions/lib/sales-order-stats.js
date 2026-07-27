/**
 * Sales order rollups: org + month + per-dealer lifetime stats.
 * Mirrors invoice-stats.js (without slim summaries / archive).
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const SALES_ORDER_STATS_COLLECTION = 'salesOrderStats';
export const SALES_ORDER_MONTH_STATS_COLLECTION = 'salesOrderMonthStats';
export const SALES_ORDER_DEALER_STATS_COLLECTION = 'salesOrderDealerStats';

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

export function salesOrderMonthKey(dateValue) {
  const raw = String(dateValue ?? '').trim();
  const match = /^(\d{4})-(\d{2})/.exec(raw);
  if (match) return `${match[1]}-${match[2]}`;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}`;
}

export function parseSalesOrderCategoryKey(value) {
  const key = String(value ?? '').toLowerCase();
  return CATEGORY_KEYS.includes(key) ? key : null;
}

export function parseSalesOrderCategoryKeys(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    const key = parseSalesOrderCategoryKey(entry);
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

function categoriesFromSalesOrderLike(soLike) {
  const categories = parseSalesOrderCategoryKeys(soLike?.categories);
  if (categories.length) return categories;
  const legacy = parseSalesOrderCategoryKey(soLike?.salesOrderCategory);
  return legacy ? [legacy] : [];
}

function categoryAmountsFromSalesOrderLike(soLike, amount) {
  const normalized = normalizeCategoryAmounts(soLike?.categoryAmounts);
  if (Object.keys(normalized).length) return normalized;
  const legacy = parseSalesOrderCategoryKey(soLike?.salesOrderCategory);
  return legacy ? { [legacy]: amount } : {};
}

/**
 * Apply +1/-1 to org + month + dealer rollups for one sales-order snapshot.
 * @param {'add'|'remove'} op
 */
export async function applySalesOrderStatsDelta(soLike, op) {
  const sign = op === 'remove' ? -1 : 1;
  const countDelta = sign;
  const amount = amountExclGst(soLike);
  const amountDelta = sign * amount;
  const totalDelta = sign * Number(soLike?.total ?? 0);
  const balanceDelta = sign * Number(soLike?.balance ?? 0);
  const qty = soLike?.itemQuantity != null ? Number(soLike.itemQuantity) : null;
  const qtyDelta = qty != null && Number.isFinite(qty) ? sign * qty : null;
  const categories = categoriesFromSalesOrderLike(soLike);
  const categoryAmounts = categoryAmountsFromSalesOrderLike(soLike, amount);
  const monthKey = salesOrderMonthKey(soLike?.date);
  const customerId = String(soLike?.customerId ?? '').trim();

  const db = getFirestore();
  const batch = db.batch();
  const orgRef = db.doc(`${SALES_ORDER_STATS_COLLECTION}/org`);
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
    const monthRef = db.doc(`${SALES_ORDER_MONTH_STATS_COLLECTION}/${monthKey}`);
    batch.set(monthRef, updates, { merge: true });
  }

  if (customerId) {
    const dealerRef = db.doc(`${SALES_ORDER_DEALER_STATS_COLLECTION}/${customerId}`);
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
      if (soLike.customerName) {
        dealerUpdates.customerName = String(soLike.customerName);
      }
      if (soLike.date) {
        dealerUpdates.latestDate = String(soLike.date);
      }
      if (soLike.syncedAt) {
        dealerUpdates.latestSyncedAt = soLike.syncedAt;
      }
    }
    batch.set(dealerRef, dealerUpdates, { merge: true });
  }

  await batch.commit();
}

export async function reconcileSalesOrderStats(before, after) {
  if (before) await applySalesOrderStatsDelta(before, 'remove');
  if (after) await applySalesOrderStatsDelta(after, 'add');
}

/**
 * One-shot: rebuild org/month/dealer rollups from top-level salesOrders.
 */
export async function backfillSalesOrderStats({ onProgress } = {}) {
  const db = getFirestore();
  let orderCount = 0;
  let dealerDocs = 0;

  const orgRef = db.doc(`${SALES_ORDER_STATS_COLLECTION}/org`);
  await orgRef.set({
    count: 0,
    amount: 0,
    byCategory: emptyByCategory(),
    amountByCategory: emptyByCategory(),
    documentAmountByCategory: emptyByCategory(),
    updatedAt: FieldValue.serverTimestamp(),
    rebuiltAt: FieldValue.serverTimestamp(),
  });

  const monthsSnap = await db.collection(SALES_ORDER_MONTH_STATS_COLLECTION).get();
  for (let i = 0; i < monthsSnap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of monthsSnap.docs.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
  }

  const dealersSnap = await db.collection(SALES_ORDER_DEALER_STATS_COLLECTION).get();
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
    const categories = categoriesFromSalesOrderLike(summary);
    const categoryAmounts = categoryAmountsFromSalesOrderLike(summary, amount);
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
    if (summary.syncedAt) acc.latestSyncedAt = summary.syncedAt;
  };

  let lastDoc = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = db.collection('salesOrders').orderBy('__name__').limit(400);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snap = await query.get();
    if (snap.empty) break;

    for (const docSnap of snap.docs) {
      const data = docSnap.data() ?? {};
      const amount = amountExclGst(data);
      const categories = categoriesFromSalesOrderLike(data);
      const categoryAmounts = categoryAmountsFromSalesOrderLike(data, amount);
      const customerId = String(data.customerId ?? '').trim();
      const summary = {
        id: docSnap.id,
        customerId,
        customerName: data.customerName ? String(data.customerName) : null,
        date: data.date ? String(data.date) : null,
        status: String(data.status ?? 'draft'),
        total: Number(data.total ?? 0),
        balance: Number(data.balance ?? 0),
        salesOrderCategory: parseSalesOrderCategoryKey(data.salesOrderCategory),
        categories,
        categoryAmounts,
        itemQuantity: data.itemQuantity != null ? Number(data.itemQuantity) : null,
        amountExclGst: amount,
        syncedAt: data.syncedAt ?? null,
      };

      orderCount += 1;
      if (!monthAcc.has('__org__')) monthAcc.set('__org__', emptyRollup());
      bumpRollup(monthAcc.get('__org__'), summary);

      if (customerId) {
        if (!dealerAcc.has(customerId)) {
          dealerAcc.set(customerId, emptyDealerRollup(customerId));
        }
        bumpDealer(dealerAcc.get(customerId), summary);
      }

      const monthKey = salesOrderMonthKey(summary.date);
      if (monthKey) {
        if (!monthAcc.has(monthKey)) monthAcc.set(monthKey, emptyRollup());
        bumpRollup(monthAcc.get(monthKey), summary);
      }
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    onProgress?.({ orderCount, dealerDocs: dealerAcc.size });
    if (snap.size < 400) break;
  }

  const orgAcc = monthAcc.get('__org__') || emptyRollup();
  await orgRef.set({
    ...orgAcc,
    updatedAt: FieldValue.serverTimestamp(),
    rebuiltAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  for (const [key, acc] of monthAcc) {
    if (key === '__org__') continue;
    await db.doc(`${SALES_ORDER_MONTH_STATS_COLLECTION}/${key}`).set({
      ...acc,
      updatedAt: FieldValue.serverTimestamp(),
      rebuiltAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  let dealerBatch = db.batch();
  let dealerBatchOps = 0;
  for (const [customerId, acc] of dealerAcc) {
    if (!acc.count) continue;
    dealerBatch.set(db.doc(`${SALES_ORDER_DEALER_STATS_COLLECTION}/${customerId}`), {
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

  await db.doc(`${SALES_ORDER_STATS_COLLECTION}/config`).set({
    rebuiltAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    orderCount,
    monthDocs: Math.max(0, monthAcc.size - 1),
    dealerDocs,
  };
}
