/**
 * Invoice rollups, slim list summaries, and cold-archive helpers.
 * Kept separate from Zoho sync so upsert/delete can call small deltas.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { freightSkuFromInvoiceLines, isFreightOrderLine } from './freight-lines.js';

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

function isExcludedVariantLine(item) {
  if (isFreightOrderLine(item)) return true;
  const name = String(item?.name ?? '').toLowerCase();
  if (name.includes('freight') || name.includes('stamping') || name.includes('gatc fee')) return true;
  const sku = String(item?.sku ?? '').trim().toLowerCase();
  if (sku.includes('freight') || sku.includes('stamping') || /^grv\d/.test(sku)) return true;
  const hsn = String(item?.hsn ?? '').replace(/\s+/g, '');
  return hsn === '996812' || hsn === '998346' || hsn === '79061190';
}

/** Distinct product/spare lines, excluding freight and GATC fee lines. */
export function countInvoiceItemVariants(lineItems) {
  if (!Array.isArray(lineItems) || !lineItems.length) return null;
  const keys = new Set();
  let unnamed = 0;
  for (const item of lineItems) {
    if (isExcludedVariantLine(item)) continue;
    const sku = String(item?.sku ?? '').trim().toLowerCase();
    const itemId = String(item?.itemId ?? item?.productId ?? item?.id ?? '').trim();
    const name = String(item?.name ?? '').trim().toLowerCase();
    const key = sku || itemId || name;
    if (key) keys.add(key);
    else unnamed += 1;
  }
  return keys.size + unnamed;
}

export function buildInvoiceSummaryFields(invoiceDoc, customerId, invoiceId) {
  const itemQuantity = invoiceDoc.itemQuantity != null
    ? Number(invoiceDoc.itemQuantity)
    : sumInvoiceItemQuantity(invoiceDoc.lineItems);
  const itemVariantCount = invoiceDoc.itemVariantCount != null
    ? Number(invoiceDoc.itemVariantCount)
    : countInvoiceItemVariants(invoiceDoc.lineItems);
  const amount = amountExclGst(invoiceDoc);
  const categories = categoriesFromInvoiceLike(invoiceDoc);
  const categoryAmounts = categoryAmountsFromInvoiceLike(invoiceDoc, amount);
  const customerPickup = customerPickupForSummary(invoiceDoc.customerPickup);
  const customerPickupMarkedAt = invoiceDoc.customerPickupMarkedAt
    ? String(invoiceDoc.customerPickupMarkedAt).trim() || null
    : (customerPickup?.markedAt ?? null);
  const manualDelivery = customerPickupForSummary(invoiceDoc.manualDelivery);
  const manualDeliveredAt = invoiceDoc.manualDeliveredAt
    ? String(invoiceDoc.manualDeliveredAt).trim() || null
    : (manualDelivery?.markedAt ?? null);
  const ewayBill = ewayBillForSummary(invoiceDoc.ewayBill);
  const district = locationFieldForSummary(invoiceDoc.district);
  const billingState = locationFieldForSummary(invoiceDoc.billingState);
  const logistics = logisticsForSummary(invoiceDoc.logistics, invoiceDoc.logistics?.bookingId);
  return {
    id: String(invoiceId),
    customerId: String(customerId),
    invoiceNumber: String(invoiceDoc.invoiceNumber ?? ''),
    customerName: invoiceDoc.customerName ? String(invoiceDoc.customerName) : null,
    salespersonId: invoiceDoc.salespersonId ? String(invoiceDoc.salespersonId) : null,
    salespersonName: invoiceDoc.salespersonName ? String(invoiceDoc.salespersonName) : null,
    date: invoiceDoc.date ? String(invoiceDoc.date) : null,
    createdTime: invoiceDoc.createdTime
      ? String(invoiceDoc.createdTime)
      : (invoiceDoc.zohoLastModified ? String(invoiceDoc.zohoLastModified) : null),
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
    ...(itemVariantCount != null && Number.isFinite(itemVariantCount) ? { itemVariantCount } : {}),
    amountExclGst: amount,
    freightSku: invoiceDoc.freightSku
      ? String(invoiceDoc.freightSku).trim().toUpperCase() || null
      : freightSkuFromInvoiceLines(invoiceDoc.lineItems),
    customerPickup,
    customerPickupMarkedAt,
    manualDelivery,
    manualDeliveredAt,
    ...(ewayBill ? { ewayBill } : {}),
    ...(district ? { district } : {}),
    ...(billingState ? { billingState } : {}),
    ...(logistics ? { logistics } : {}),
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

function ewayBillForSummary(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ewaybillNumber = raw.ewaybillNumber ? String(raw.ewaybillNumber).trim() : '';
  const status = raw.status ? String(raw.status).trim() : '';
  const requiredBecause = raw.requiredBecause === 'clubbed_lr' || raw.requiredBecause === 'invoice_total'
    ? raw.requiredBecause
    : null;
  if (!ewaybillNumber && !status && raw.required !== true && !requiredBecause) return null;
  return {
    required: raw.required !== false,
    requiredBecause,
    status: status || null,
    ewaybillNumber: ewaybillNumber || null,
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

function locationFieldForSummary(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function bookingInvoiceIds(booking) {
  if (!booking || typeof booking !== 'object') return [];
  const ids = [
    ...(Array.isArray(booking.invoiceIds) ? booking.invoiceIds : []),
    ...(Array.isArray(booking.invoices) ? booking.invoices.map(row => row?.invoiceId) : []),
    booking.invoiceId,
  ];
  return [...new Set(ids.map(id => String(id ?? '').trim()).filter(Boolean))];
}

/** Slim logistics snapshot for admin list status / partner tiles. */
export function logisticsForSummary(booking, bookingId) {
  if (!booking || typeof booking !== 'object') return null;
  const status = String(booking.status ?? '').trim().toLowerCase();
  if (!status || status === 'cancelled') return null;
  const consignmentNo = String(booking.consignmentNo ?? '').trim();
  const trackingNo = String(booking.trackingNo ?? '').trim();
  return {
    bookingId: String(bookingId || booking.id || booking.bookingId || '').trim() || null,
    status,
    wizardStep: booking.wizardStep ? String(booking.wizardStep) : null,
    consignmentNo: consignmentNo || null,
    trackingNo: trackingNo || null,
    partnerId: booking.partnerId ? String(booking.partnerId) : null,
  };
}

async function customerIdForInvoice(invoiceId, fallbackCustomerId) {
  const fallback = String(fallbackCustomerId ?? '').trim();
  if (fallback) return fallback;
  const snap = await getFirestore().collection('invoiceIndex').doc(String(invoiceId)).get();
  return snap.exists ? String(snap.data()?.customerId ?? '').trim() : '';
}

async function customerLocationForSummary(customerId) {
  const id = String(customerId ?? '').trim();
  if (!id) return {};
  const snap = await getFirestore().collection('zohoCustomers').doc(id).get();
  if (!snap.exists) return {};
  const data = snap.data() ?? {};
  const district = locationFieldForSummary(data.district);
  const billingState = locationFieldForSummary(data.billingState);
  return {
    ...(district ? { district } : {}),
    ...(billingState ? { billingState } : {}),
  };
}

/**
 * Mirror booking status onto invoiceSummaries so the admin list does not
 * join logisticsBookings for every row.
 */
export async function syncInvoiceSummariesFromLogisticsBooking(bookingId, after, before = null) {
  const invoiceIds = bookingInvoiceIds(after || before || {});
  if (!invoiceIds.length) return { patched: 0 };
  const fallbackCustomerId = String((after || before)?.zohoCustomerId ?? '').trim();
  const logistics = logisticsForSummary(after, bookingId);
  let patched = 0;

  for (const invoiceId of invoiceIds) {
    const customerId = await customerIdForInvoice(invoiceId, fallbackCustomerId);
    if (!customerId) continue;
    const ref = invoiceSummaryRef(customerId, invoiceId);
    if (logistics) {
      await ref.set({
        logistics,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      patched += 1;
      continue;
    }
    const snap = await ref.get();
    if (!snap.exists) continue;
    const storedId = String(snap.data()?.logistics?.bookingId ?? '').trim();
    if (storedId && storedId !== String(bookingId)) continue;
    await ref.set({
      logistics: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    patched += 1;
  }
  return { patched };
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
  if (!fields.district && !fields.billingState) {
    Object.assign(fields, await customerLocationForSummary(customerId));
  }
  await invoiceSummaryRef(customerId, invoiceId).set(fields, { merge: true });
  return fields;
}

/**
 * Copy customerPickup from hot invoices onto invoiceSummaries.
 * The admin list reads summaries, which omitted pickup until dual-write.
 */
export async function backfillInvoiceSummaryCustomerPickups({ onProgress } = {}) {
  const db = getFirestore();
  const customersSnap = await db.collection('zohoCustomers').select().get();
  let scanned = 0;
  let patched = 0;
  let batch = db.batch();
  let batchOps = 0;

  const flush = async () => {
    if (!batchOps) return;
    await batch.commit();
    batch = db.batch();
    batchOps = 0;
  };

  for (const customer of customersSnap.docs) {
    const invoicesSnap = await customer.ref.collection('invoices')
      .select('customerPickup', 'customerPickupMarkedAt', 'manualDelivery', 'manualDeliveredAt')
      .get();
    for (const invoice of invoicesSnap.docs) {
      scanned += 1;
      const data = invoice.data() ?? {};
      const customerPickup = customerPickupForSummary(data.customerPickup);
      const customerPickupMarkedAt = data.customerPickupMarkedAt
        ? String(data.customerPickupMarkedAt).trim() || null
        : (customerPickup?.markedAt ?? null);
      const manualDelivery = customerPickupForSummary(data.manualDelivery);
      const manualDeliveredAt = data.manualDeliveredAt
        ? String(data.manualDeliveredAt).trim() || null
        : (manualDelivery?.markedAt ?? null);
      if (!customerPickup && !customerPickupMarkedAt && !manualDelivery && !manualDeliveredAt) continue;
      batch.set(invoiceSummaryRef(customer.id, invoice.id), {
        ...(customerPickup || customerPickupMarkedAt
          ? { customerPickup, customerPickupMarkedAt }
          : {}),
        ...(manualDelivery || manualDeliveredAt
          ? { manualDelivery, manualDeliveredAt }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batchOps += 1;
      patched += 1;
      if (batchOps >= 400) await flush();
    }
    onProgress?.({ customerId: customer.id, scanned, patched });
  }

  await flush();
  await db.doc(`${INVOICE_STATS_COLLECTION}/config`).set({
    summariesIncludeCustomerPickup: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { scanned, patched };
}

/**
 * Copy dealer location + logistics status onto invoiceSummaries so the
 * admin list can render without extra customer / booking reads.
 */
export async function backfillInvoiceSummaryListFields({ onProgress } = {}) {
  const db = getFirestore();
  let locationPatched = 0;
  let logisticsPatched = 0;
  let batch = db.batch();
  let batchOps = 0;

  const flush = async () => {
    if (!batchOps) return;
    await batch.commit();
    batch = db.batch();
    batchOps = 0;
  };

  const customersSnap = await db.collection('zohoCustomers')
    .select('district', 'billingState')
    .get();
  for (const customer of customersSnap.docs) {
    const data = customer.data() ?? {};
    const district = locationFieldForSummary(data.district);
    const billingState = locationFieldForSummary(data.billingState);
    if (!district && !billingState) continue;
    const summariesSnap = await customer.ref.collection(INVOICE_SUMMARIES_SUBCOLLECTION)
      .select('district', 'billingState')
      .get();
    for (const summary of summariesSnap.docs) {
      const current = summary.data() ?? {};
      if (locationFieldForSummary(current.district) && locationFieldForSummary(current.billingState)) {
        continue;
      }
      batch.set(summary.ref, {
        ...(district ? { district } : {}),
        ...(billingState ? { billingState } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batchOps += 1;
      locationPatched += 1;
      if (batchOps >= 400) await flush();
    }
    onProgress?.({ customerId: customer.id, locationPatched, logisticsPatched });
  }
  await flush();

  const bookingsSnap = await db.collection('logisticsBookings').get();
  for (const booking of bookingsSnap.docs) {
    const result = await syncInvoiceSummariesFromLogisticsBooking(booking.id, booking.data() ?? {});
    logisticsPatched += result.patched;
    onProgress?.({ bookingId: booking.id, locationPatched, logisticsPatched });
  }

  await db.doc(`${INVOICE_STATS_COLLECTION}/config`).set({
    summariesIncludeListFields: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { locationPatched, logisticsPatched };
}

/**
 * Copy freightSku from hot invoices onto invoiceSummaries so to-dispatch
 * tiles can show the courier logo without reading line items.
 */
export async function backfillInvoiceSummaryFreightSkus({ onProgress } = {}) {
  const db = getFirestore();
  let scanned = 0;
  let patched = 0;
  let batch = db.batch();
  let batchOps = 0;

  const flush = async () => {
    if (!batchOps) return;
    await batch.commit();
    batch = db.batch();
    batchOps = 0;
  };

  const customersSnap = await db.collection('zohoCustomers').select().get();
  for (const customer of customersSnap.docs) {
    const invoicesSnap = await customer.ref.collection('invoices')
      .select('freightSku', 'lineItems')
      .get();
    for (const invoice of invoicesSnap.docs) {
      scanned += 1;
      const data = invoice.data() ?? {};
      const freightSku = data.freightSku
        ? String(data.freightSku).trim().toUpperCase() || null
        : freightSkuFromInvoiceLines(data.lineItems);
      if (!freightSku) continue;
      batch.set(invoiceSummaryRef(customer.id, invoice.id), {
        freightSku,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batchOps += 1;
      patched += 1;
      if (batchOps >= 400) await flush();
    }
    onProgress?.({ customerId: customer.id, scanned, patched });
  }

  await flush();
  return { scanned, patched };
}

/**
 * Copy itemVariantCount from hot invoice line items onto invoiceSummaries
 * so the list can show Qty / Variants without reading line items.
 */
export async function backfillInvoiceSummaryVariantCounts({ onProgress } = {}) {
  const db = getFirestore();
  let scanned = 0;
  let patched = 0;
  let batch = db.batch();
  let batchOps = 0;

  const flush = async () => {
    if (!batchOps) return;
    await batch.commit();
    batch = db.batch();
    batchOps = 0;
  };

  const customersSnap = await db.collection('zohoCustomers').select().get();
  for (const customer of customersSnap.docs) {
    const invoicesSnap = await customer.ref.collection('invoices')
      .select('itemVariantCount', 'lineItems')
      .get();
    for (const invoice of invoicesSnap.docs) {
      scanned += 1;
      const data = invoice.data() ?? {};
      const itemVariantCount = data.itemVariantCount != null
        ? Number(data.itemVariantCount)
        : countInvoiceItemVariants(data.lineItems);
      if (itemVariantCount == null || !Number.isFinite(itemVariantCount)) continue;
      batch.set(invoiceSummaryRef(customer.id, invoice.id), {
        itemVariantCount,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batchOps += 1;
      patched += 1;
      if (batchOps >= 400) await flush();
    }
    onProgress?.({ customerId: customer.id, scanned, patched });
  }

  await flush();
  return { scanned, patched };
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
  const customersSnap = await db.collection('zohoCustomers')
    .select('district', 'billingState')
    .get();
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

    const customerData = customerDoc.data() ?? {};
    for (const invDoc of invSnap.docs) {
      const data = invDoc.data() ?? {};
      const summary = buildInvoiceSummaryFields({
        ...data,
        district: data.district || customerData.district,
        billingState: data.billingState || customerData.billingState,
      }, customerId, invDoc.id);
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
  await db.doc(`${INVOICE_STATS_COLLECTION}/config`).set({
    summariesIncludeCustomerPickup: true,
    summariesIncludeListFields: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

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
