import crypto from 'node:crypto';
import { getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
} from './zoho-api-usage.js';
import {
  mapInvoice,
  mapInvoiceLineItem,
  buildInvoiceSearchBlob,
  firestoreDocToListInvoice,
  firestoreDocToDetail,
} from './invoice-mappers.js';
import { formatZohoAddress } from './zoho-contact-fields.js';
import {
  classifyInvoiceCategoryBreakdown,
  classifyInvoiceFromLineItems,
  parseInvoiceCategory,
} from './invoice-category.js';
import {
  amountExclGst,
  deleteInvoiceSummary,
  reconcileInvoiceStats,
  sumInvoiceItemQuantity,
  writeInvoiceSummaryAndReconcile,
} from './invoice-stats.js';
import { markInvoiceAsSent } from './zoho-sales-orders.js';
import { freightSkuFromInvoiceLines } from './freight-lines.js';

const CUSTOMERS_COLLECTION = 'zohoCustomers';
const INVOICES_SUBCOLLECTION = 'invoices';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    // App not initialized yet.
  }

  return null;
}

function storageBucket() {
  const bucketName = resolveStorageBucketName();
  if (bucketName) return getStorage().bucket(bucketName);
  return getStorage().bucket();
}

function invoicesCollection(customerId) {
  return getFirestore()
    .collection(CUSTOMERS_COLLECTION)
    .doc(String(customerId))
    .collection(INVOICES_SUBCOLLECTION);
}

function customerInvoiceMetaRef(customerId) {
  return getFirestore()
    .collection(CUSTOMERS_COLLECTION)
    .doc(String(customerId))
    .collection('invoiceMeta')
    .doc('sync');
}

function invoiceIndexRef(invoiceId) {
  return getFirestore().collection('invoiceIndex').doc(String(invoiceId));
}

function globalInvoiceMetaRef() {
  return getFirestore().collection('invoiceMeta').doc('sync');
}

function invoicePdfPath(customerId, invoiceId) {
  return `invoices/${customerId}/${invoiceId}.pdf`;
}

function salesOrderPdfPath(customerId, salesOrderId) {
  return `invoices/${customerId}/so-${salesOrderId}.pdf`;
}

async function zohoJsonRequest(accessToken, orgId, path) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  url.searchParams.set('organization_id', orgId);
  const res = await fetch(url.toString(), {
    headers: authHeaders(accessToken, orgId),
  });
  await recordZohoApiResponse(res, { operation: path, source: 'invoice-sync' });
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
    await recordZohoApiFailure(err, { operation: path, source: 'invoice-sync' });
    throw err;
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    const err = classifyZohoHttpError(429, payload);
    if (payload.code === 43 || String(payload.message ?? '').toLowerCase().includes('rate')) {
      await recordZohoApiFailure(err, { operation: path, source: 'invoice-sync' });
    }
    const apiErr = new Error(payload.message || 'Zoho API error.');
    apiErr.zohoCode = payload.code;
    throw apiErr;
  }
  return payload;
}

async function fetchInvoiceRaw(accessToken, orgId, invoiceId) {
  const payload = await zohoJsonRequest(accessToken, orgId, `/invoices/${invoiceId}`);
  return payload?.invoice ?? null;
}

async function fetchZohoPdf(accessToken, orgId, resource, id) {
  const url = new URL(`${ZOHO_API_BASE}/${resource}/${id}`);
  url.searchParams.set('organization_id', orgId);
  const res = await fetch(url.toString(), {
    headers: {
      ...authHeaders(accessToken, orgId),
      Accept: 'application/pdf',
    },
  });
  await recordZohoApiResponse(res, { operation: `${resource}/${id}/pdf`, source: 'invoice-sync' });
  if (!res.ok) {
    if (res.status === 429) {
      const err = new Error('Zoho rate limit exceeded.');
      err.code = 'RATE_LIMITED';
      await recordZohoApiFailure(err, { operation: `${resource}/${id}/pdf`, source: 'invoice-sync' });
      throw err;
    }
    const text = await res.text();
    let message = `Could not download ${resource} PDF (${res.status}).`;
    try {
      const payload = JSON.parse(text);
      if (payload?.message) message = payload.message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('PDF file is empty.');
  return buffer;
}

async function fetchInvoicesListPage(accessToken, orgId, page, options = {}) {
  const url = new URL(`${ZOHO_API_BASE}/invoices`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '200');
  url.searchParams.set('sort_column', options.sortColumn ?? 'last_modified_time');
  url.searchParams.set('sort_order', options.sortOrder ?? 'D');
  if (options.customerId) url.searchParams.set('customer_id', options.customerId);

  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  await recordZohoApiResponse(res, { operation: `invoices/list?page=${page}`, source: 'invoice-sync' });
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
    err.message = payload?.message || err.message;
    await recordZohoApiFailure(err, { operation: `invoices/list?page=${page}`, source: 'invoice-sync' });
    throw err;
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    const err = classifyZohoHttpError(429, payload);
    if (String(payload.message ?? '').toLowerCase().includes('rate')) {
      await recordZohoApiFailure(err, { operation: `invoices/list?page=${page}`, source: 'invoice-sync' });
      throw err;
    }
    const apiErr = new Error(payload.message || 'Zoho invoices API error.');
    apiErr.zohoCode = payload.code;
    throw apiErr;
  }

  return {
    invoices: payload?.invoices ?? [],
    hasMore: Boolean(payload?.page_context?.has_more_page),
  };
}

async function fetchAllInvoiceSummaries(accessToken, orgId, options = {}) {
  const invoices = [];
  let page = 1;
  const maxPages = options.maxPages ?? 100;

  while (page <= maxPages) {
    const batch = await fetchInvoicesListPage(accessToken, orgId, page, options);
    invoices.push(...batch.invoices);
    if (!batch.hasMore) break;
    page += 1;
    if (options.delayMs) await sleep(options.delayMs);
  }

  return invoices;
}

function shippingFromSalesOrderRaw(so) {
  if (!so || typeof so !== 'object') {
    return { shippingAddress: null, shippingAddressId: null };
  }
  return {
    shippingAddress: formatZohoAddress(so.shipping_address) ?? null,
    shippingAddressId: so.shipping_address_id != null
      ? String(so.shipping_address_id).trim() || null
      : (so.shipping_address?.address_id != null
        ? String(so.shipping_address.address_id).trim() || null
        : null),
  };
}

/** Prefer mirrored Firestore SO shipping when Zoho invoice omitted ship-to. */
async function shippingFromMirroredSalesOrder(salesOrderId) {
  const id = String(salesOrderId || '').trim();
  if (!id) return { shippingAddress: null, shippingAddressId: null };
  try {
    const snap = await getFirestore().collection('salesOrders').doc(id).get();
    if (!snap.exists) return { shippingAddress: null, shippingAddressId: null };
    const data = snap.data() || {};
    return {
      shippingAddress: data.shippingAddress ? String(data.shippingAddress).trim() || null : null,
      shippingAddressId: data.shippingAddressId
        ? String(data.shippingAddressId).trim() || null
        : null,
    };
  } catch {
    return { shippingAddress: null, shippingAddressId: null };
  }
}

async function sparePackagingFromSalesOrderId(salesOrderId) {
  const id = String(salesOrderId || '').trim();
  if (!id) return null;
  try {
    const snap = await getFirestore().collection('salesOrders').doc(id).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return Array.isArray(data.sparePackaging) ? data.sparePackaging : null;
  } catch {
    return null;
  }
}

async function resolveSalesOrder(accessToken, orgId, customerId, invoiceRaw) {
  const salesOrderId = invoiceRaw.salesorder_id ? String(invoiceRaw.salesorder_id) : null;
  const referenceNumber = invoiceRaw.reference_number ? String(invoiceRaw.reference_number) : null;

  if (salesOrderId) {
    try {
      const payload = await zohoJsonRequest(accessToken, orgId, `/salesorders/${salesOrderId}`);
      const so = payload?.salesorder;
      if (so && String(so.customer_id) === customerId) {
        const shipping = shippingFromSalesOrderRaw(so);
        return {
          id: String(so.salesorder_id),
          number: so.salesorder_number ? String(so.salesorder_number) : referenceNumber,
          ...shipping,
        };
      }
    } catch {
      // Fall back to search by reference number.
    }
  }

  if (!referenceNumber) return null;

  const url = new URL(`${ZOHO_API_BASE}/salesorders`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('customer_id', customerId);
  url.searchParams.set('search_text', referenceNumber);
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok || payload?.code !== 0) return null;

  const orders = payload?.salesorders ?? [];
  const match =
    orders.find(so => String(so.salesorder_number) === referenceNumber)
    ?? orders.find(so => String(so.reference_number) === referenceNumber)
    ?? orders[0];

  if (!match) return null;
  return {
    id: String(match.salesorder_id),
    number: match.salesorder_number ? String(match.salesorder_number) : referenceNumber,
  };
}

/** @returns {Map<string, { imageUrl: string|null, hsn: string|null, categoryId: string|null, categoryName: string|null }>} */
async function getCatalogMetaForItems(itemIds) {
  const unique = [...new Set(itemIds.filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;

  const db = getFirestore();
  const refs = unique.map(id => db.collection('catalogProducts').doc(id));
  const snaps = await db.getAll(...refs);
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() || {};
    map.set(snap.id, {
      imageUrl: data.imageUrl ?? null,
      hsn: data.hsn != null ? String(data.hsn) : null,
      categoryId: data.categoryId != null ? String(data.categoryId) : null,
      categoryName: data.categoryName != null ? String(data.categoryName) : null,
    });
  }
  return map;
}

async function uploadPdfToStorage(storagePath, buffer) {
  const bucket = storageBucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    contentType: 'application/pdf',
    metadata: { cacheControl: 'public, max-age=31536000' },
    resumable: false,
  });
  return storagePath;
}

async function readPdfFromStorage(storagePath) {
  const bucket = storageBucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buffer] = await file.download();
  return buffer.length ? buffer : null;
}

function zohoContentFingerprint(invoiceRaw) {
  return [
    invoiceRaw.last_modified_time,
    invoiceRaw.status,
    invoiceRaw.total,
    invoiceRaw.balance,
    invoiceRaw.invoice_number,
    (invoiceRaw.line_items ?? []).length,
    invoiceRaw.shipping_address_id,
    invoiceRaw.shipping_address?.address,
    invoiceRaw.shipping_address?.zip,
  ].join('|');
}

async function buildFirestoreInvoiceDoc(accessToken, orgId, invoiceRaw, options = {}) {
  const customerId = String(invoiceRaw.customer_id);
  const invoiceId = String(invoiceRaw.invoice_id);
  const lineItemsRaw = invoiceRaw.line_items ?? [];
  const itemIds = lineItemsRaw.map(item => (item.item_id ? String(item.item_id) : null));
  // Always load catalog meta for HSN/category classification (and optional images).
  const catalogMap = await getCatalogMetaForItems(itemIds);
  const lineItems = lineItemsRaw.map(item => {
    const itemId = item.item_id ? String(item.item_id) : null;
    const meta = itemId ? catalogMap.get(itemId) : null;
    return mapInvoiceLineItem(
      item,
      options.skipImages ? null : (meta?.imageUrl ?? null),
    );
  });
  const classifyInput = lineItemsRaw.map(item => {
    const itemId = item.item_id ? String(item.item_id) : null;
    return {
      total: Number(item.item_total ?? item.total ?? 0),
      name: String(item.name ?? item.item_name ?? ''),
      sku: item.sku ? String(item.sku) : null,
      itemId,
      hsn: item.hsn_or_sac ?? item.hsnOrSac ?? item.hsn ?? null,
    };
  });
  const categoryBreakdown = classifyInvoiceCategoryBreakdown(classifyInput, catalogMap);
  const invoiceCategory = categoryBreakdown.categories[0]
    ?? classifyInvoiceFromLineItems(classifyInput, catalogMap);
  const salesOrder = options.skipSalesOrder
    ? null
    : await resolveSalesOrder(accessToken, orgId, customerId, invoiceRaw);

  const summary = mapInvoice(invoiceRaw);
  const searchBlob = buildInvoiceSearchBlob(invoiceRaw);
  const fingerprint = zohoContentFingerprint(invoiceRaw);

  const salesOrderId = options.skipSalesOrder
    ? (invoiceRaw.salesorder_id ? String(invoiceRaw.salesorder_id) : null)
    : (salesOrder?.id ?? (invoiceRaw.salesorder_id ? String(invoiceRaw.salesorder_id) : null));

  const sparePackaging = invoiceCategory === 'spare' && salesOrderId
    ? await sparePackagingFromSalesOrderId(salesOrderId)
    : null;

  let shippingAddress = summary.shippingAddress || null;
  let shippingAddressId = summary.shippingAddressId || null;
  if (!shippingAddress && salesOrder?.shippingAddress) {
    shippingAddress = salesOrder.shippingAddress;
    shippingAddressId = salesOrder.shippingAddressId || shippingAddressId;
  }
  if (!shippingAddress && salesOrderId) {
    const mirrored = await shippingFromMirroredSalesOrder(salesOrderId);
    if (mirrored.shippingAddress) {
      shippingAddress = mirrored.shippingAddress;
      shippingAddressId = mirrored.shippingAddressId || shippingAddressId;
    }
  }

  return {
    ...summary,
    customerId,
    searchBlob,
    salesOrderId: options.skipSalesOrder ? (salesOrderId || null) : (salesOrder?.id ?? salesOrderId),
    salesOrderNumber: options.skipSalesOrder
      ? (invoiceRaw.reference_number ? String(invoiceRaw.reference_number) : null)
      : (salesOrder?.number
        ?? (invoiceRaw.reference_number ? String(invoiceRaw.reference_number) : null)),
    subtotal: Number(invoiceRaw.sub_total ?? 0),
    taxTotal: Number(invoiceRaw.tax_total ?? 0),
    notes: invoiceRaw.notes ? String(invoiceRaw.notes) : null,
    shippingAddress,
    shippingAddressId,
    billingAddress: summary.billingAddress || null,
    lineItems,
    itemQuantity: sumInvoiceItemQuantity(lineItems),
    amountExclGst: amountExclGst({
      total: summary.total,
      subtotal: Number(invoiceRaw.sub_total ?? 0),
      taxTotal: Number(invoiceRaw.tax_total ?? 0),
    }),
    invoiceCategory,
    sparePackaging,
    categories: categoryBreakdown.categories,
    categoryAmounts: categoryBreakdown.categoryAmounts,
    freightSku: freightSkuFromInvoiceLines(lineItems),
    zohoLastModified: invoiceRaw.last_modified_time
      ? String(invoiceRaw.last_modified_time)
      : null,
    contentFingerprint: fingerprint,
    syncedAt: FieldValue.serverTimestamp(),
  };
}

function invoiceDetailStillValid(existing, summary) {
  if (!existing || !Array.isArray(existing.lineItems) || !existing.lineItems.length) {
    return false;
  }
  const modified = summary?.last_modified_time ? String(summary.last_modified_time) : '';
  return Boolean(modified && modified === String(existing.zohoLastModified ?? ''));
}

function defaultInvoiceSyncOptions(options = {}) {
  return {
    skipPdfs: options.skipPdfs ?? false,
    skipSalesOrder: options.skipSalesOrder !== false,
    skipImages: options.skipImages !== false,
    concurrency: options.concurrency ?? 3,
    delayMs: options.delayMs ?? 350,
  };
}

async function cacheInvoicePdfs(accessToken, orgId, customerId, invoiceId, invoiceRaw, salesOrder, options = {}) {
  const paths = {
    pdfStoragePath: null,
    salesOrderPdfStoragePath: null,
  };

  if (options.skipPdfs) return paths;

  try {
    const pdfBuffer = await fetchZohoPdf(accessToken, orgId, 'invoices', invoiceId);
    paths.pdfStoragePath = await uploadPdfToStorage(invoicePdfPath(customerId, invoiceId), pdfBuffer);
  } catch (err) {
    console.warn(`Invoice PDF cache failed for ${invoiceId}:`, err?.message ?? err);
  }

  if (salesOrder?.id && !options.skipSalesOrder) {
    try {
      const soBuffer = await fetchZohoPdf(accessToken, orgId, 'salesorders', salesOrder.id);
      paths.salesOrderPdfStoragePath = await uploadPdfToStorage(
        salesOrderPdfPath(customerId, salesOrder.id),
        soBuffer,
      );
    } catch (err) {
      console.warn(`Sales order PDF cache failed for invoice ${invoiceId}:`, err?.message ?? err);
    }
  }

  return paths;
}

export async function upsertInvoiceFromRaw(accessToken, orgId, invoiceRaw, options = {}) {
  if (!invoiceRaw?.invoice_id || !invoiceRaw?.customer_id) {
    return { skipped: true, reason: 'missing ids' };
  }

  const customerId = String(invoiceRaw.customer_id);
  const invoiceId = String(invoiceRaw.invoice_id);
  const existing = options.existingDoc
    ?? (await invoicesCollection(customerId).doc(invoiceId).get()).data()
    ?? null;
  const fingerprint = zohoContentFingerprint(invoiceRaw);

  const needsDetail = !options.summaryRefreshOnly && (
    !existing
    || existing.contentFingerprint !== fingerprint
    || !Array.isArray(existing.lineItems)
    || !existing.lineItems.length
  );

  let doc;
  let salesOrder = null;

  if (options.summaryRefreshOnly) {
    if (!existing) {
      return { skipped: true, reason: 'no cached detail' };
    }
    const mapped = mapInvoice(invoiceRaw);
    let shippingAddress = mapped.shippingAddress || existing.shippingAddress || null;
    let shippingAddressId = mapped.shippingAddressId || existing.shippingAddressId || null;
    if (!shippingAddress) {
      const mirrored = await shippingFromMirroredSalesOrder(
        existing.salesOrderId || invoiceRaw.salesorder_id || null,
      );
      if (mirrored.shippingAddress) {
        shippingAddress = mirrored.shippingAddress;
        shippingAddressId = mirrored.shippingAddressId || shippingAddressId;
      }
    }
    doc = {
      ...firestoreDocToDetail(existing),
      ...mapped,
      // List payloads often omit addresses — keep cached / SO ship-to.
      shippingAddress,
      shippingAddressId,
      billingAddress: mapped.billingAddress || existing.billingAddress || null,
      customerId,
      invoiceCategory: parseInvoiceCategory(existing.invoiceCategory) || 'product',
      categories: Array.isArray(existing.categories) ? existing.categories : [],
      categoryAmounts: existing.categoryAmounts ?? {},
      syncedAt: FieldValue.serverTimestamp(),
    };

    if (doc.invoiceCategory === 'spare' && doc.salesOrderId) {
      const spare = await sparePackagingFromSalesOrderId(doc.salesOrderId);
      if (spare) doc.sparePackaging = spare;
    }
  } else if (needsDetail || options.forceDetail) {
    const fullRaw = options.useProvidedRaw
      ? invoiceRaw
      : await fetchInvoiceRaw(accessToken, orgId, invoiceId);
    if (!fullRaw) {
      return { skipped: true, reason: 'not found in zoho' };
    }
    doc = await buildFirestoreInvoiceDoc(accessToken, orgId, fullRaw, options);
    if (!doc.shippingAddress && existing?.shippingAddress) {
      doc.shippingAddress = existing.shippingAddress;
      doc.shippingAddressId = doc.shippingAddressId || existing.shippingAddressId || null;
    }
    if (!options.skipSalesOrder && doc.salesOrderId) {
      salesOrder = { id: doc.salesOrderId, number: doc.salesOrderNumber };
    }
  } else {
    const mapped = mapInvoice(invoiceRaw);
    let shippingAddress = mapped.shippingAddress || existing.shippingAddress || null;
    let shippingAddressId = mapped.shippingAddressId || existing.shippingAddressId || null;
    if (!shippingAddress) {
      const soId = existing.salesOrderId || invoiceRaw.salesorder_id || null;
      const mirrored = await shippingFromMirroredSalesOrder(soId);
      if (mirrored.shippingAddress) {
        shippingAddress = mirrored.shippingAddress;
        shippingAddressId = mirrored.shippingAddressId || shippingAddressId;
      }
    }
    doc = {
      ...firestoreDocToDetail(existing),
      ...mapped,
      shippingAddress,
      shippingAddressId,
      billingAddress: mapped.billingAddress || existing.billingAddress || null,
      customerId,
      searchBlob: buildInvoiceSearchBlob(invoiceRaw),
      contentFingerprint: fingerprint,
      invoiceCategory: parseInvoiceCategory(existing.invoiceCategory) || 'product',
      categories: Array.isArray(existing.categories) ? existing.categories : [],
      categoryAmounts: existing.categoryAmounts ?? {},
      syncedAt: FieldValue.serverTimestamp(),
    };

    if (doc.invoiceCategory === 'spare' && doc.salesOrderId) {
      const spare = await sparePackagingFromSalesOrderId(doc.salesOrderId);
      if (spare) doc.sparePackaging = spare;
    }
    if (!options.skipSalesOrder && existing.salesOrderId) {
      salesOrder = { id: existing.salesOrderId, number: existing.salesOrderNumber };
    }
  }

  const needsPdf = !options.skipPdfs && (
    options.forcePdfs
    || !existing?.pdfStoragePath
    || (!options.skipSalesOrder && salesOrder?.id && !existing?.salesOrderPdfStoragePath)
  );

  if (needsPdf && !options.skipPdfs) {
    const fullRaw = needsDetail || options.forceDetail
      ? (options.useProvidedRaw ? invoiceRaw : await fetchInvoiceRaw(accessToken, orgId, invoiceId))
      : invoiceRaw;
    if (fullRaw) {
      const pdfPaths = await cacheInvoicePdfs(
        accessToken,
        orgId,
        customerId,
        invoiceId,
        fullRaw,
        salesOrder,
        options,
      );
      if (pdfPaths.pdfStoragePath) doc.pdfStoragePath = pdfPaths.pdfStoragePath;
      if (pdfPaths.salesOrderPdfStoragePath) doc.salesOrderPdfStoragePath = pdfPaths.salesOrderPdfStoragePath;
    }
  } else if (existing) {
    if (existing.pdfStoragePath) doc.pdfStoragePath = existing.pdfStoragePath;
    if (existing.salesOrderPdfStoragePath) doc.salesOrderPdfStoragePath = existing.salesOrderPdfStoragePath;
  }

  // Zoho payloads never carry YesWeigh fulfillment — keep booking/pickup/e-way.
  if (existing) {
    if (doc.logistics == null && existing.logistics) doc.logistics = existing.logistics;
    if (doc.customerPickup == null && existing.customerPickup) {
      doc.customerPickup = existing.customerPickup;
    }
    if (doc.customerPickupMarkedAt == null && existing.customerPickupMarkedAt) {
      doc.customerPickupMarkedAt = existing.customerPickupMarkedAt;
    }
    if (doc.manualDelivery == null && existing.manualDelivery) {
      doc.manualDelivery = existing.manualDelivery;
    }
    if (doc.manualDeliveredAt == null && existing.manualDeliveredAt) {
      doc.manualDeliveredAt = existing.manualDeliveredAt;
    }
    if (doc.ewayBill == null && existing.ewayBill) doc.ewayBill = existing.ewayBill;
    if (doc.district == null && existing.district) doc.district = existing.district;
    if (doc.billingState == null && existing.billingState) doc.billingState = existing.billingState;
    if (doc.yesOneFreightPartner == null && existing.yesOneFreightPartner) {
      doc.yesOneFreightPartner = existing.yesOneFreightPartner;
    }
    if (existing.kotakPaidAt) {
      doc.kotakPaidAt = existing.kotakPaidAt;
      if (existing.kotakAmountApplied != null) doc.kotakAmountApplied = existing.kotakAmountApplied;
      const zohoPaid = String(doc.status || '').trim().toLowerCase() === 'paid'
        || Number(doc.balance) <= 0.01;
      if (!zohoPaid) {
        doc.status = 'paid';
        doc.balance = 0;
      }
    }
  }

  await invoicesCollection(customerId).doc(invoiceId).set(doc, { merge: true });
  await invoiceIndexRef(invoiceId).set({ customerId, updatedAt: FieldValue.serverTimestamp() });

  if (Number(doc.total ?? 0) > 50_000) {
    try {
      const { syncEwayBillMetadataFromZoho } = await import('./invoice-ewaybill.js');
      await syncEwayBillMetadataFromZoho(accessToken, orgId, customerId, invoiceId, doc.total);
    } catch (err) {
      console.warn(`E-way bill metadata sync failed for ${invoiceId}:`, err?.message ?? err);
    }
  }

  await customerInvoiceMetaRef(customerId).set({
    ...(options.source === 'webhook' ? { lastWebhookAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  try {
    const afterSnap = {
      ...doc,
      customerId,
      invoiceCategory: parseInvoiceCategory(doc.invoiceCategory) || doc.invoiceCategory,
      date: doc.date ?? null,
      total: doc.total,
      subtotal: doc.subtotal,
      taxTotal: doc.taxTotal,
      logistics: doc.logistics ?? existing?.logistics ?? null,
      customerPickup: doc.customerPickup ?? existing?.customerPickup ?? null,
      customerPickupMarkedAt: doc.customerPickupMarkedAt
        ?? existing?.customerPickupMarkedAt
        ?? existing?.customerPickup?.markedAt
        ?? null,
      manualDelivery: doc.manualDelivery ?? existing?.manualDelivery ?? null,
      manualDeliveredAt: doc.manualDeliveredAt
        ?? existing?.manualDeliveredAt
        ?? existing?.manualDelivery?.markedAt
        ?? null,
      ewayBill: doc.ewayBill ?? existing?.ewayBill ?? null,
    };
    const beforeSnap = existing
      ? { ...existing, customerId: existing.customerId ?? customerId }
      : null;
    const fields = await writeInvoiceSummaryAndReconcile(
      customerId,
      invoiceId,
      afterSnap,
      beforeSnap,
    );
    if (fields?.listStatus) {
      await invoicesCollection(customerId).doc(invoiceId).set({
        listStatus: fields.listStatus,
        ...(fields.logistics ? { logistics: fields.logistics } : {}),
      }, { merge: true });
    }
  } catch (err) {
    console.warn(`Invoice stats/summary update failed for ${invoiceId}:`, err?.message ?? err);
  }

  // Index stamped GATC fees against this invoice (joins linked SO portal meta).
  try {
    const { maybeWriteGatcReportAfterInvoiceUpsert } = await import('./gatc-report.js');
    await maybeWriteGatcReportAfterInvoiceUpsert({
      ...doc,
      id: invoiceId,
      customerId,
    });
  } catch (err) {
    console.warn(`GATC report index failed for invoice ${invoiceId}:`, err?.message ?? err);
  }

  return { customerId, invoiceId, updated: true };
}

export async function deleteInvoiceFromFirestore(customerId, invoiceId) {
  const ref = invoicesCollection(customerId).doc(invoiceId);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const data = snap.data() ?? {};
  const bucket = storageBucket();
  const paths = [data.pdfStoragePath, data.salesOrderPdfStoragePath].filter(Boolean);
  await ref.delete();
  await invoiceIndexRef(invoiceId).delete().catch(() => {});
  let summaryListStatus = data.listStatus ?? null;
  try {
    const { invoiceSummaryRef } = await import('./invoice-stats.js');
    const summarySnap = await invoiceSummaryRef(customerId, invoiceId).get();
    if (summarySnap.exists) {
      summaryListStatus = summarySnap.data()?.listStatus ?? summaryListStatus;
    }
  } catch {
    // keep hot-invoice status
  }
  await deleteInvoiceSummary(customerId, invoiceId);
  try {
    await reconcileInvoiceStats({
      ...data,
      customerId: data.customerId ?? customerId,
      listStatus: summaryListStatus,
    }, null);
  } catch (err) {
    console.warn(`Invoice stats remove failed for ${invoiceId}:`, err?.message ?? err);
  }
  await Promise.all(paths.map(async path => {
    try {
      await bucket.file(path).delete({ ignoreNotFound: true });
    } catch {
      // ignore storage delete failures
    }
  }));
  return true;
}

async function mapConcurrent(items, concurrency, fn) {
  if (!items.length) return [];
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      try {
        results[current] = await fn(items[current], current);
      } catch (err) {
        results[current] = { error: err };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function syncInvoicesToFirestore(secrets, orgId, options = {}) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const syncOpts = defaultInvoiceSyncOptions(options);
  const { concurrency, delayMs, skipPdfs, skipSalesOrder, skipImages } = syncOpts;
  const customerIdFilter = options.customerId ? String(options.customerId) : null;

  const summaries = await fetchAllInvoiceSummaries(accessToken, organizationId, {
    customerId: customerIdFilter ?? undefined,
    delayMs,
  });

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  let unchanged = 0;
  const customerCounts = new Map();

  const upsertOptions = {
    skipPdfs,
    skipSalesOrder,
    skipImages,
    forcePdfs: !skipPdfs,
    source: options.source ?? 'sync',
  };

  await mapConcurrent(summaries, concurrency, async summary => {
    if (delayMs) await sleep(delayMs);
    try {
      const invoiceId = String(summary.invoice_id);
      const customerId = String(summary.customer_id);
      const existingSnap = await invoicesCollection(customerId).doc(invoiceId).get();
      const existing = existingSnap.exists ? existingSnap.data() : null;
      const summaryStatus = String(summary.status || existing?.status || '').trim().toLowerCase();

      if (summaryStatus !== 'draft' && invoiceDetailStillValid(existing, summary)) {
        const result = await upsertInvoiceFromRaw(accessToken, organizationId, summary, {
          ...upsertOptions,
          useProvidedRaw: true,
          summaryRefreshOnly: true,
          existingDoc: existing,
        });
        if (result.skipped) {
          skipped += 1;
          return;
        }
        unchanged += 1;
        synced += 1;
        customerCounts.set(customerId, (customerCounts.get(customerId) ?? 0) + 1);
        return;
      }

      let fullRaw;
      try {
        fullRaw = await fetchInvoiceRaw(accessToken, organizationId, invoiceId);
      } catch (err) {
        err.syncPhase = 'zoho-fetch';
        throw err;
      }
      if (!fullRaw) {
        skipped += 1;
        return;
      }
      fullRaw = await promoteDraftInvoiceIfPaymentConfirmed(
        secrets,
        orgId,
        accessToken,
        organizationId,
        invoiceId,
        fullRaw,
        existing,
      );
      try {
        await upsertInvoiceFromRaw(accessToken, organizationId, fullRaw, {
          ...upsertOptions,
          useProvidedRaw: true,
          existingDoc: existing,
        });
      } catch (err) {
        err.syncPhase = 'firestore-upsert';
        throw err;
      }
      synced += 1;
      customerCounts.set(customerId, (customerCounts.get(customerId) ?? 0) + 1);
    } catch (err) {
      failed += 1;
      if (err?.code === 'RATE_LIMITED') {
        await sleep(5000);
      }
      const phase = err?.syncPhase ? ` [${err.syncPhase}]` : '';
      const zohoHint = err?.zohoCode === 57
        ? ' (Zoho code 57 — wrong data center or missing ZohoInventory.invoices.READ scope)'
        : '';
      console.warn('Invoice sync item failed:', `${err?.message ?? err}${phase}${zohoHint}`);
    }
  });

  const now = FieldValue.serverTimestamp();
  const touchedCustomers = customerIdFilter
    ? [customerIdFilter]
    : [...customerCounts.keys()];

  for (const customerId of touchedCustomers) {
    const snap = await invoicesCollection(customerId).count().get();
    await customerInvoiceMetaRef(customerId).set({
      totalCount: snap.data().count,
      lastFullSyncAt: now,
      lastSyncStatus: failed ? 'partial' : 'ok',
      updatedAt: now,
    }, { merge: true });
  }

  await globalInvoiceMetaRef().set({
    lastFullSyncAt: now,
    syncedCount: synced,
    failedCount: failed,
    skippedCount: skipped,
    totalListed: summaries.length,
    updatedAt: now,
  }, { merge: true });

  return {
    syncedCount: synced,
    failedCount: failed,
    skippedCount: skipped,
    unchangedCount: unchanged,
    totalListed: summaries.length,
    customerCount: touchedCustomers.length,
  };
}

async function salesOrderPaymentConfirmed(salesOrderId) {
  const soId = String(salesOrderId ?? '').trim();
  if (!soId) return false;
  try {
    const snap = await getFirestore().collection('salesOrders').doc(soId).get();
    if (!snap.exists) return false;
    const data = snap.data() ?? {};
    const stage = String(data.yesOneStage ?? '').trim().toLowerCase();
    if (stage === 'completed') return true;
    return Boolean(String(data.paymentVerifiedAt ?? '').trim());
  } catch {
    return false;
  }
}

async function promoteDraftInvoiceIfPaymentConfirmed(
  secrets,
  orgId,
  accessToken,
  organizationId,
  invoiceId,
  invoiceRaw,
  existingDoc = null,
) {
  const zohoStatus = String(invoiceRaw?.status || '').trim().toLowerCase();
  if (zohoStatus !== 'draft') return invoiceRaw;
  const soId = String(invoiceRaw?.salesorder_id || existingDoc?.salesOrderId || '').trim();
  if (!soId || !(await salesOrderPaymentConfirmed(soId))) return invoiceRaw;
  try {
    await markInvoiceAsSent(secrets, orgId, invoiceId);
    const refreshed = await fetchInvoiceRaw(accessToken, organizationId, invoiceId);
    return refreshed || invoiceRaw;
  } catch (sentErr) {
    console.warn(
      `Could not mark invoice ${invoiceId} as sent during sync (SO ${soId}):`,
      sentErr?.message || sentErr,
    );
    return invoiceRaw;
  }
}

export async function syncSingleInvoiceFromZoho(secrets, orgId, invoiceId, options = {}) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const syncOpts = defaultInvoiceSyncOptions(options);
  let fullRaw = await fetchInvoiceRaw(accessToken, organizationId, invoiceId);
  if (!fullRaw) {
    return { deleted: false, updated: false, reason: 'not found' };
  }

  fullRaw = await promoteDraftInvoiceIfPaymentConfirmed(
    secrets,
    orgId,
    accessToken,
    organizationId,
    invoiceId,
    fullRaw,
  );
  const soId = String(fullRaw.salesorder_id || '').trim();

  const result = await upsertInvoiceFromRaw(accessToken, organizationId, fullRaw, {
    useProvidedRaw: true,
    forceDetail: true,
    forcePdfs: !syncOpts.skipPdfs,
    skipPdfs: syncOpts.skipPdfs,
    skipSalesOrder: syncOpts.skipSalesOrder,
    skipImages: syncOpts.skipImages,
    source: options.source ?? 'webhook',
  });

  // Outside-portal invoices: move/settle pending freight Diff onto first invoiced SO with freight.
  const customerId = String(result?.customerId || fullRaw?.customer_id || '').trim();
  if (soId && customerId && !options.skipFreightDiffSettle) {
    try {
      const { settleFreightDiffForInvoicedSalesOrder } = await import('./freight-diff-settlement.js');
      await settleFreightDiffForInvoicedSalesOrder(getFirestore(), {
        secrets,
        orgId,
        salesOrderId: soId,
        invoiceId: String(invoiceId),
        invoiceNumber: fullRaw?.invoice_number ? String(fullRaw.invoice_number) : null,
        zohoCustomerId: customerId,
      });
    } catch (freightErr) {
      console.warn(
        `Freight diff settle on invoice sync failed for SO ${soId}:`,
        freightErr?.message || freightErr,
      );
    }
  }

  return result;
}

export async function reconcileCustomerInvoices(secrets, orgId, customerId, options = {}) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  const zohoSummaries = await fetchAllInvoiceSummaries(accessToken, organizationId, {
    customerId: String(customerId),
    delayMs: options.delayMs ?? 300,
  });
  const zohoIds = new Set(zohoSummaries.map(row => String(row.invoice_id)));

  const localSnap = await invoicesCollection(customerId).get();
  const localIds = new Set(localSnap.docs.map(doc => doc.id));

  let removed = 0;
  for (const id of localIds) {
    if (!zohoIds.has(id)) {
      await deleteInvoiceFromFirestore(customerId, id);
      removed += 1;
    }
  }

  return { zohoCount: zohoIds.size, localRemoved: removed };
}

/** List fields only — omit lineItems / PDF paths so large dealers stay under memory caps. */
const INVOICE_LIST_SELECT_FIELDS = [
  'invoiceNumber',
  'date',
  'dueDate',
  'status',
  'total',
  'subtotal',
  'taxTotal',
  'balance',
  'referenceNumber',
  'lastPaymentDate',
  'currencyCode',
  'customerName',
  'salespersonId',
  'salespersonName',
  'invoiceUrl',
  'invoiceCategory',
  'freightSku',
];

export async function readCustomerInvoicesFromFirestore(
  customerId,
  { includeSearchBlob = false } = {},
) {
  const fields = includeSearchBlob
    ? [...INVOICE_LIST_SELECT_FIELDS, 'searchBlob']
    : INVOICE_LIST_SELECT_FIELDS;
  const snap = await invoicesCollection(String(customerId)).select(...fields).get();
  const invoices = [];
  const searchBlobById = new Map();

  snap.forEach(doc => {
    const data = doc.data() ?? {};
    invoices.push(firestoreDocToListInvoice({ ...data, id: doc.id }));
    if (includeSearchBlob && data.searchBlob) {
      searchBlobById.set(doc.id, String(data.searchBlob));
    }
  });

  const metaSnap = await customerInvoiceMetaRef(String(customerId)).get();
  const meta = metaSnap.exists ? metaSnap.data() : null;
  let lastSyncedAt = null;
  const timestamps = [meta?.lastFullSyncAt, meta?.lastWebhookAt, meta?.updatedAt];
  for (const ts of timestamps) {
    if (ts instanceof Timestamp) {
      const iso = ts.toDate().toISOString();
      if (!lastSyncedAt || iso > lastSyncedAt) lastSyncedAt = iso;
    }
  }

  return { invoices, searchBlobById, lastSyncedAt };
}

async function resolveInvoiceDisplayAddress(customerId, data) {
  const preferred = String(data.shippingAddress || data.billingAddress || '').trim() || null;
  const preferredId = String(data.shippingAddressId || '').trim() || null;
  if (preferred) return preferred;

  try {
    const snap = await getFirestore().collection(CUSTOMERS_COLLECTION).doc(String(customerId)).get();
    if (!snap.exists) return null;
    const customer = snap.data() || {};
    if (preferredId && Array.isArray(customer.zohoAddresses)) {
      const match = customer.zohoAddresses.find(
        row => String(row?.addressId || '').trim() === preferredId && row?.formatted,
      );
      if (match?.formatted) return String(match.formatted).trim() || null;
    }
    return (
      (customer.zohoShippingAddress && String(customer.zohoShippingAddress).trim())
      || (customer.shippingAddress && String(customer.shippingAddress).trim())
      || formatZohoAddress(customer.zohoShippingAddressRaw)
      || (customer.zohoBillingAddress && String(customer.zohoBillingAddress).trim())
      || (customer.billingAddress && String(customer.billingAddress).trim())
      || formatZohoAddress(customer.zohoBillingAddressRaw)
      || null
    );
  } catch {
    return null;
  }
}

export async function readInvoiceDetailFromFirestore(customerId, invoiceId) {
  const snap = await invoicesCollection(String(customerId)).doc(String(invoiceId)).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (String(data.customerId ?? customerId) !== String(customerId)) return null;
  const detail = firestoreDocToDetail({ ...data, id: snap.id });
  let shippingAddress = detail.shippingAddress;
  if (!shippingAddress && detail.salesOrderId) {
    const mirrored = await shippingFromMirroredSalesOrder(detail.salesOrderId);
    shippingAddress = mirrored.shippingAddress;
  }
  if (!shippingAddress) {
    shippingAddress = await resolveInvoiceDisplayAddress(customerId, data);
  }

  const needsImages = detail.lineItems.some(item => !item.imageUrl && item.itemId);
  const withAddress = { ...detail, shippingAddress: shippingAddress || null };
  if (!needsImages) return withAddress;

  const itemIds = detail.lineItems.map(item => item.itemId).filter(Boolean);
  const catalogMap = await getCatalogMetaForItems(itemIds);
  return {
    ...withAddress,
    lineItems: detail.lineItems.map(item => ({
      ...item,
      imageUrl: item.imageUrl
        || (item.itemId ? catalogMap.get(String(item.itemId))?.imageUrl ?? null : null),
    })),
  };
}

function invoiceDocumentMeta(customerId, invoiceId, data, documentType) {
  if (documentType === 'invoice') {
    return {
      storagePath: data.pdfStoragePath ?? invoicePdfPath(customerId, invoiceId),
      filename: `${String(data.invoiceNumber || invoiceId).replace(/[^\w.-]+/g, '_')}.pdf`,
      zohoResource: 'invoices',
      zohoId: String(invoiceId),
      firestorePathField: 'pdfStoragePath',
    };
  }
  if (documentType === 'salesorder') {
    if (!data.salesOrderId) throw new Error('Sales order not found for this invoice.');
    const salesOrderId = String(data.salesOrderId);
    return {
      storagePath: data.salesOrderPdfStoragePath ?? salesOrderPdfPath(customerId, salesOrderId),
      filename: `${String(data.salesOrderNumber || salesOrderId).replace(/[^\w.-]+/g, '_')}.pdf`,
      zohoResource: 'salesorders',
      zohoId: salesOrderId,
      firestorePathField: 'salesOrderPdfStoragePath',
    };
  }
  throw new Error('Unsupported document type.');
}

/** Read cached PDF from Storage, or fetch from Zoho once and cache for later views. */
export async function ensureInvoiceDocumentPdf(secrets, orgId, customerId, invoiceId, documentType) {
  const snap = await invoicesCollection(String(customerId)).doc(String(invoiceId)).get();
  if (!snap.exists) throw new Error('Invoice not found.');
  const data = snap.data() ?? {};
  if (String(data.customerId ?? customerId) !== String(customerId)) {
    throw new Error('Invoice not found.');
  }

  const meta = invoiceDocumentMeta(customerId, invoiceId, data, documentType);
  let buffer = await readPdfFromStorage(meta.storagePath);

  if (!buffer) {
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, orgId);
    buffer = await fetchZohoPdf(accessToken, organizationId, meta.zohoResource, meta.zohoId);
    const savedPath = await uploadPdfToStorage(meta.storagePath, buffer);
    await invoicesCollection(String(customerId)).doc(String(invoiceId)).set(
      { [meta.firestorePathField]: savedPath },
      { merge: true },
    );
  }

  return {
    contentBase64: buffer.toString('base64'),
    filename: meta.filename,
    mimeType: 'application/pdf',
  };
}

export async function readInvoiceDocumentFromStorage(customerId, invoiceId, documentType) {
  const snap = await invoicesCollection(String(customerId)).doc(String(invoiceId)).get();
  if (!snap.exists) throw new Error('Invoice not found.');
  const data = snap.data() ?? {};
  if (String(data.customerId ?? customerId) !== String(customerId)) {
    throw new Error('Invoice not found.');
  }

  const meta = invoiceDocumentMeta(customerId, invoiceId, data, documentType);
  const buffer = await readPdfFromStorage(meta.storagePath);
  if (!buffer) {
    throw new Error('PDF not cached yet. Open the invoice to download it from Zoho.');
  }
  return {
    contentBase64: buffer.toString('base64'),
    filename: meta.filename,
    mimeType: 'application/pdf',
  };
}

function normalizeSignature(value) {
  return String(value ?? '').trim();
}

function signaturesMatch(received, calculated) {
  const a = normalizeSignature(received);
  const b = normalizeSignature(calculated);
  if (!a || !b) return false;
  if (a.length !== b.length) {
    if (a.toLowerCase() === b.toLowerCase()) return true;
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

export function verifyZohoWebhookSignature(req, secret) {
  if (!secret) return false;

  const received =
    req.get('X-ZB-Signature')
    ?? req.get('X-ZB-WebhookSignature')
    ?? req.get('X-Zoho-Webhook-Signature')
    ?? req.get('x-zb-signature');

  const rawBody = req.rawBody;
  if (!received || !rawBody) return false;

  const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (signaturesMatch(received, hex)) return true;

  const base64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  if (signaturesMatch(received, base64)) return true;

  return false;
}

export function extractInvoiceIdFromWebhook(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.invoice_id,
    body.invoice?.invoice_id,
    body.data?.invoice_id,
    body.payload?.invoice_id,
  ];
  for (const value of candidates) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

export function extractWebhookEvent(body) {
  if (!body || typeof body !== 'object') return 'update';
  const event = body.event_type ?? body.event ?? body.action ?? body.type;
  return String(event ?? 'update').toLowerCase();
}

export async function handleZohoInvoiceWebhook(secrets, orgId, req) {
  const body = req.body ?? {};
  const invoiceId = extractInvoiceIdFromWebhook(body);
  if (!invoiceId) {
    return { ok: false, status: 400, message: 'Missing invoice_id' };
  }

  const queryAction = String(req.query?.action ?? '').trim().toLowerCase();
  const event = queryAction || extractWebhookEvent(body);
  if (event.includes('delete')) {
    const customerId = body.customer_id ?? body.invoice?.customer_id;
    if (customerId) {
      await deleteInvoiceFromFirestore(String(customerId), invoiceId);
      return { ok: true, status: 200, action: 'deleted', invoiceId };
    }
    const indexSnap = await invoiceIndexRef(invoiceId).get();
    if (indexSnap.exists) {
      await deleteInvoiceFromFirestore(String(indexSnap.data()?.customerId), invoiceId);
      return { ok: true, status: 200, action: 'deleted', invoiceId };
    }
    return { ok: true, status: 200, action: 'ignored', invoiceId, reason: 'unknown customer' };
  }

  const result = await syncSingleInvoiceFromZoho(secrets, orgId, invoiceId, {
    source: 'webhook',
    skipPdfs: true,
  });
  return { ok: true, status: 200, action: 'synced', invoiceId, result };
}

export {
  fetchInvoicesListPage,
  fetchInvoiceRaw,
  invoiceDetailStillValid,
  invoicesCollection,
  customerInvoiceMetaRef,
  defaultInvoiceSyncOptions,
};
