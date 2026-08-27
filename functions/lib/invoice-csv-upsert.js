import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  classifyInvoiceCategoryBreakdown,
  classifyInvoiceFromLineItems,
  parseInvoiceCategory,
} from './invoice-category.js';
import { freightSkuFromInvoiceLines } from './freight-lines.js';
import { writeInvoiceSummaryAndReconcile } from './invoice-stats.js';

const CUSTOMERS_COLLECTION = 'zohoCustomers';
const INVOICES_SUBCOLLECTION = 'invoices';
const INVOICE_INDEX_COLLECTION = 'invoiceIndex';

function invoicesCollection(customerId) {
  return getFirestore()
    .collection(CUSTOMERS_COLLECTION)
    .doc(String(customerId))
    .collection(INVOICES_SUBCOLLECTION);
}

function invoiceIndexRef(invoiceId) {
  return getFirestore().collection(INVOICE_INDEX_COLLECTION).doc(String(invoiceId));
}

function buildSearchBlob(header, lineItems) {
  const parts = [
    header.invoiceNumber,
    header.referenceNumber,
    header.customerName,
    header.notes,
  ];
  for (const item of lineItems ?? []) {
    parts.push(item.name, item.description, item.sku);
    if (Array.isArray(item.serialNumbers)) parts.push(...item.serialNumbers);
  }
  return parts
    .filter(Boolean)
    .map(value => String(value))
    .join(' ')
    .toLowerCase();
}

async function loadCatalogMetaForItemIds(itemIds) {
  const unique = [...new Set((itemIds ?? []).filter(Boolean).map(String))];
  const map = new Map();
  if (!unique.length) return map;

  const db = getFirestore();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const refs = chunk.map(id => db.collection('catalogProducts').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      map.set(snap.id, {
        hsn: data.hsn != null ? String(data.hsn) : null,
        categoryId: data.categoryId != null ? String(data.categoryId) : null,
        categoryName: data.categoryName != null ? String(data.categoryName) : null,
        imageUrl: data.imageUrl != null ? String(data.imageUrl) : null,
      });
    }
  }
  return map;
}

function normalizeLineItems(rawItems, catalogMap) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((item, index) => {
    const itemId = item?.itemId != null && String(item.itemId).trim()
      ? String(item.itemId).trim()
      : null;
    const meta = itemId ? catalogMap.get(itemId) : null;
    const quantity = Number(item?.quantity ?? 1) || 0;
    const rate = Number(item?.rate ?? 0) || 0;
    const total = item?.total != null && item.total !== ''
      ? Number(item.total)
      : quantity * rate;
    const serialNumbers = Array.isArray(item?.serialNumbers)
      ? [...new Set(item.serialNumbers.map(v => String(v).trim()).filter(Boolean))]
      : [];
    return {
      id: item?.id != null && String(item.id).trim()
        ? String(item.id).trim()
        : (itemId || `csv-${index + 1}`),
      itemId,
      name: String(item?.name ?? 'Item').trim() || 'Item',
      description: item?.description != null && String(item.description).trim()
        ? String(item.description).trim()
        : null,
      sku: item?.sku != null && String(item.sku).trim() ? String(item.sku).trim() : null,
      quantity,
      rate,
      total: Number.isFinite(total) ? total : 0,
      imageUrl: meta?.imageUrl ?? null,
      hsn: item?.hsn != null && String(item.hsn).trim()
        ? String(item.hsn).trim()
        : (meta?.hsn ?? null),
      serialNumbers,
    };
  });
}

function pickHeaderPatch(header = {}) {
  const patch = {};
  const strFields = [
    'invoiceNumber',
    'date',
    'dueDate',
    'status',
    'currencyCode',
    'customerName',
    'referenceNumber',
    'lastPaymentDate',
    'salespersonId',
    'salespersonName',
    'invoiceUrl',
    'salesOrderId',
    'salesOrderNumber',
    'notes',
  ];
  for (const key of strFields) {
    if (header[key] === undefined) continue;
    if (header[key] === null) {
      patch[key] = null;
      continue;
    }
    const value = String(header[key]).trim();
    if (value) patch[key] = value;
  }
  for (const key of ['total', 'balance', 'subtotal', 'taxTotal']) {
    if (header[key] === undefined || header[key] === null || header[key] === '') continue;
    const n = Number(header[key]);
    if (Number.isFinite(n)) patch[key] = n;
  }
  const category = parseInvoiceCategory(header.invoiceCategory);
  if (category) patch.invoiceCategory = category;
  return patch;
}

async function upsertOneInvoice(input) {
  const invoiceId = String(input?.invoiceId ?? '').trim();
  const customerId = String(input?.customerId ?? '').trim();
  if (!invoiceId || !customerId) {
    return {
      status: 'failed',
      invoiceId: invoiceId || null,
      customerId: customerId || null,
      message: 'invoiceId and customerId are required.',
    };
  }

  const headerPatch = pickHeaderPatch(input.header || {});
  const replaceLineItems = input.replaceLineItems === true;
  const ref = invoicesCollection(customerId).doc(invoiceId);
  const existingSnap = await ref.get();
  const exists = existingSnap.exists;
  const existing = exists ? (existingSnap.data() || {}) : {};

  if (!exists) {
    const missing = [];
    if (!headerPatch.invoiceNumber) missing.push('invoiceNumber');
    if (!headerPatch.date) missing.push('date');
    if (headerPatch.total == null) missing.push('total');
    if (missing.length) {
      return {
        status: 'failed',
        invoiceId,
        customerId,
        message: `Create requires: ${missing.join(', ')}`,
      };
    }
  }

  let catalogMap = new Map();
  let lineItems = Array.isArray(existing.lineItems) ? existing.lineItems : [];
  if (replaceLineItems) {
    const rawItems = Array.isArray(input.lineItems) ? input.lineItems : [];
    catalogMap = await loadCatalogMetaForItemIds(rawItems.map(item => item?.itemId));
    lineItems = normalizeLineItems(rawItems, catalogMap);
  } else if (!exists) {
    lineItems = [];
  }

  if (!catalogMap.size && lineItems.length) {
    catalogMap = await loadCatalogMetaForItemIds(lineItems.map(item => item?.itemId));
  }
  const categoryBreakdown = classifyInvoiceCategoryBreakdown(lineItems, catalogMap);
  if (!headerPatch.invoiceCategory) {
    headerPatch.invoiceCategory = categoryBreakdown.categories[0]
      || classifyInvoiceFromLineItems(lineItems, catalogMap)
      || existing.invoiceCategory
      || 'product';
  }

  const mergedHeader = {
    invoiceNumber: headerPatch.invoiceNumber ?? existing.invoiceNumber ?? '',
    date: headerPatch.date ?? existing.date ?? null,
    dueDate: headerPatch.dueDate !== undefined ? headerPatch.dueDate : (existing.dueDate ?? null),
    status: headerPatch.status ?? existing.status ?? 'sent',
    total: headerPatch.total != null ? headerPatch.total : Number(existing.total ?? 0),
    balance: headerPatch.balance != null ? headerPatch.balance : Number(existing.balance ?? 0),
    subtotal: headerPatch.subtotal !== undefined
      ? headerPatch.subtotal
      : (existing.subtotal != null ? Number(existing.subtotal) : null),
    taxTotal: headerPatch.taxTotal !== undefined
      ? headerPatch.taxTotal
      : (existing.taxTotal != null ? Number(existing.taxTotal) : null),
    currencyCode: headerPatch.currencyCode ?? existing.currencyCode ?? 'INR',
    customerName: headerPatch.customerName !== undefined
      ? headerPatch.customerName
      : (existing.customerName ?? null),
    referenceNumber: headerPatch.referenceNumber !== undefined
      ? headerPatch.referenceNumber
      : (existing.referenceNumber ?? null),
    lastPaymentDate: headerPatch.lastPaymentDate !== undefined
      ? headerPatch.lastPaymentDate
      : (existing.lastPaymentDate ?? null),
    salespersonId: headerPatch.salespersonId !== undefined
      ? headerPatch.salespersonId
      : (existing.salespersonId ?? null),
    salespersonName: headerPatch.salespersonName !== undefined
      ? headerPatch.salespersonName
      : (existing.salespersonName ?? null),
    invoiceUrl: headerPatch.invoiceUrl !== undefined
      ? headerPatch.invoiceUrl
      : (existing.invoiceUrl ?? null),
    salesOrderId: headerPatch.salesOrderId !== undefined
      ? headerPatch.salesOrderId
      : (existing.salesOrderId ?? null),
    salesOrderNumber: headerPatch.salesOrderNumber !== undefined
      ? headerPatch.salesOrderNumber
      : (existing.salesOrderNumber ?? null),
    notes: headerPatch.notes !== undefined ? headerPatch.notes : (existing.notes ?? null),
    invoiceCategory: headerPatch.invoiceCategory
      ?? existing.invoiceCategory
      ?? 'product',
  };

  const doc = {
    id: invoiceId,
    customerId,
    ...mergedHeader,
    categories: categoryBreakdown.categories,
    categoryAmounts: categoryBreakdown.categoryAmounts,
    freightSku: freightSkuFromInvoiceLines(lineItems),
    lineItems,
    searchBlob: buildSearchBlob(mergedHeader, lineItems),
    contentFingerprint: `csv-import|${invoiceId}|${Date.now()}`,
    syncedAt: FieldValue.serverTimestamp(),
  };

  await ref.set(doc, { merge: true });
  await invoiceIndexRef(invoiceId).set({
    customerId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  try {
    const afterDoc = {
      ...existing,
      ...doc,
      customerId,
      logistics: existing.logistics ?? null,
      customerPickup: existing.customerPickup ?? null,
      customerPickupMarkedAt: existing.customerPickupMarkedAt ?? null,
      manualDelivery: existing.manualDelivery ?? null,
      manualDeliveredAt: existing.manualDeliveredAt ?? null,
      ewayBill: existing.ewayBill ?? null,
      yesOneFreightPartner: existing.yesOneFreightPartner ?? null,
    };
    await writeInvoiceSummaryAndReconcile(
      customerId,
      invoiceId,
      afterDoc,
      exists ? { ...existing, customerId } : null,
    );
  } catch (err) {
    console.warn(`Invoice summary/rollup update failed for CSV ${invoiceId}:`, err?.message ?? err);
  }

  try {
    const { syncYesGatcLinksAfterInvoiceUpsert } = await import('./yesgatc-invoice-link.js');
    await syncYesGatcLinksAfterInvoiceUpsert({
      ...doc,
      id: invoiceId,
      invoiceId,
      customerId,
    });
  } catch (err) {
    console.warn(`YesGATC certificate link failed for CSV ${invoiceId}:`, err?.message ?? err);
  }

  return {
    status: exists ? 'updated' : 'created',
    invoiceId,
    customerId,
    message: null,
  };
}

/**
 * Upsert invoice documents from pre-parsed CSV payloads (no Zoho API).
 * @param {{ invoices: Array<object> }} input
 */
export async function upsertInvoicesFromCsv(input) {
  const invoices = Array.isArray(input?.invoices) ? input.invoices : [];
  if (!invoices.length) {
    throw new Error('invoices array is required.');
  }
  if (invoices.length > 100) {
    throw new Error('At most 100 invoices per batch.');
  }

  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const invoice of invoices) {
    try {
      const one = await upsertOneInvoice(invoice);
      if (one.status === 'created') result.created += 1;
      else if (one.status === 'updated') result.updated += 1;
      else if (one.status === 'skipped') result.skipped += 1;
      else {
        result.failed += 1;
        result.errors.push({
          invoiceId: one.invoiceId,
          customerId: one.customerId,
          message: one.message || 'Failed.',
        });
      }
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        invoiceId: invoice?.invoiceId ? String(invoice.invoiceId) : null,
        customerId: invoice?.customerId ? String(invoice.customerId) : null,
        message: err?.message ?? 'Failed to upsert invoice.',
      });
    }
  }

  return result;
}
