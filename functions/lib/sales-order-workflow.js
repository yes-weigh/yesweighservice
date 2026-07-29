/**
 * YesOne sales-order workflow on the Firestore salesOrders mirror.
 * Zoho stays Draft until payment is verified → then Confirm + Invoice.
 *
 * yesOneStage: review → ready_for_payment → payment_submitted → completed | void
 */
import { randomUUID } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';
import { resolveZohoCustomerIdForUser } from './zoho-invoices.js';
import {
  confirmSalesOrder,
  createInvoiceFromSalesOrder,
  deleteSalesOrder,
  pushInvoiceEinvoiceToIrp,
  setSalesOrderSalesperson,
  updateSalesOrderLines,
  updateSalesOrderShippingAddress,
  voidSalesOrder,
} from './zoho-sales-orders.js';
import { resolveSalespersonForCustomer } from './sales-order-salesperson.js';
import {
  mapSalesOrderDoc,
  mirrorSalesOrderFromZoho,
  withCatalogLineImages,
  withResolvedShippingAddress,
} from './sales-order-sync.js';
import { resolveShippingAddressId } from './zoho-contact-addresses.js';
import { isQuantityExcludedLineItem } from './invoice-category.js';
import { effectiveCatalogStockStatus, isSacHsn } from './sac-catalog.js';
import { getAccessToken, resolveOrganizationId } from './zoho.js';
import { fetchRawCustomerDetail } from './zoho-customers.js';
import { extractZohoListFields } from './zoho-contact-fields.js';

const SO_COLLECTION = 'salesOrders';
const PRODUCTS = 'catalogProducts';

const DEALER_ROLES = new Set(['dealer', 'dealer_staff']);
const OPS_ROLES = new Set(['staff', 'super_admin']);

const LOGISTICS_DEFAULT_PERMS = new Set([
  'orders.view',
  'orders.manage',
  'support.view',
  'support.return',
  'invoices.view',
  'logistics.view',
  'loyalty.view',
  'catalog.view',
]);

const ADMIN_DEFAULT_PERMS = new Set(['orders.view', 'orders.manage']);

const STAGES = new Set([
  'review',
  'ready_for_payment',
  'payment_submitted',
  'completed',
  'void',
]);

/**
 * Zoho e-invoice (Push to IRP) is only for GST-registered businesses.
 * In our dealer mirror that is `zohoGstTreatment === 'business_gst'`.
 * (Business without GST / consumer / individual cannot be pushed.)
 */
export function isZohoCustomerEinvoicePushEligible(customer) {
  if (!customer || typeof customer !== 'object') return false;
  const treatment = String(
    customer.zohoGstTreatment ?? customer.gst_treatment ?? '',
  ).trim().toLowerCase();
  if (treatment === 'business_gst') return true;

  // Fallback when GST treatment was not synced but GSTIN + business subtype are present.
  const subType = String(
    customer.zohoCustomerSubType ?? customer.customer_sub_type ?? '',
  ).trim().toLowerCase();
  const gstNo = String(customer.zohoGstNo ?? customer.gst_no ?? '').trim();
  return subType === 'business' && gstNo.length >= 15;
}

async function resolveCustomerForEinvoice(secrets, orgId, customerId) {
  const id = String(customerId ?? '').trim();
  if (!id) return null;

  const ref = getFirestore().collection('zohoCustomers').doc(id);
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() || {};
    if (data.zohoGstTreatment || data.zohoCustomerSubType || data.zohoGstNo) {
      return data;
    }
  }

  try {
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, orgId);
    const contact = await fetchRawCustomerDetail(accessToken, organizationId, id);
    return extractZohoListFields(contact);
  } catch (err) {
    console.warn('Could not load Zoho customer for e-invoice eligibility:', id, err?.message || err);
    return snap.exists ? (snap.data() || {}) : null;
  }
}

const MISSING_SALESPERSON_MESSAGE = (
  'Assign a sales staff with a linked Zoho salesperson to this dealer, then use “Apply salesperson from dealer” before verifying payment.'
);

/**
 * Verify requires salesperson already on the SO (from create or Apply from dealer).
 */
function requireSalespersonOnSalesOrder(data) {
  const salespersonId = data.salespersonId ? String(data.salespersonId).trim() : '';
  if (!salespersonId) {
    throw new HttpsError('failed-precondition', MISSING_SALESPERSON_MESSAGE);
  }
  const salespersonName = data.salespersonName
    ? String(data.salespersonName).trim() || null
    : null;
  return { salespersonId, salespersonName };
}

/**
 * Admin action: copy dealer assigned staff → Zoho salesperson onto this SO.
 */
export async function applySalesOrderSalespersonFromDealer(
  uid,
  role,
  salesOrderId,
  secrets,
  orgId,
) {
  const user = await loadUser(uid);
  requireOrdersManage(user);

  const { ref, id, data } = await loadSoOrThrow(salesOrderId);
  const stage = yesOneStageOf(data);
  if (stage === 'completed' || stage === 'void') {
    throw new HttpsError(
      'failed-precondition',
      'Salesperson cannot be changed after the order is completed or voided.',
    );
  }

  const resolved = await resolveSalespersonForCustomer(data.customerId);
  if (!resolved?.id) {
    throw new HttpsError('failed-precondition', MISSING_SALESPERSON_MESSAGE);
  }

  try {
    await setSalesOrderSalesperson(secrets, orgId, id, {
      salespersonId: resolved.id,
      salespersonName: resolved.name,
    });
    await mirrorSalesOrderFromZoho(secrets, orgId, id);
    await ref.set({
      salespersonId: resolved.id,
      salespersonName: resolved.name,
      yesOneUpdatedAt: nowIso(),
      yesOneLastEditedAt: nowIso(),
      yesOneLastEditedByUid: uid,
      yesOneLastEditedByName: displayName(user),
    }, { merge: true });
  } catch (err) {
    const message = err?.message || 'Could not set salesperson on the sales order.';
    throw new HttpsError('internal', message);
  }

  const snap = await ref.get();
  return detailPayload(snap.id, snap.data() || {}, { includePaymentUrl: true });
}

const MAX_PAYMENT_BYTES = 8 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function normalizeRole(role) {
  if (role === 'admin') return 'super_admin';
  if (role === 'director') return 'dealer';
  if (role === 'director_staff') return 'dealer_staff';
  return role;
}

async function loadUser(uid) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await getFirestore().doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User profile not found.');
  const data = snap.data() || {};
  if (data.active === false) throw new HttpsError('permission-denied', 'Your account is inactive.');
  return { uid, role: normalizeRole(String(data.role ?? '')), data };
}

function displayName(user) {
  return String(
    user.data?.displayName
    || user.data?.loginId
    || user.data?.email
    || 'User',
  ).trim();
}

function staffHasPermission(user, permission) {
  if (user.role === 'super_admin') return true;
  if (user.role !== 'staff') return false;
  const mode = String(user.data?.staffAccessMode ?? 'role');
  const perms = Array.isArray(user.data?.staffPermissions)
    ? user.data.staffPermissions.map(String)
    : [];
  if ((mode === 'custom' || mode === 'role') && perms.length > 0) {
    return perms.includes(permission);
  }
  const dept = String(user.data?.staffDepartment ?? 'admin');
  if (dept === 'admin') return true;
  if (dept === 'logistics') return LOGISTICS_DEFAULT_PERMS.has(permission);
  return ADMIN_DEFAULT_PERMS.has(permission);
}

function requireOrdersManage(user) {
  if (user.role === 'super_admin') return;
  if (user.role === 'staff' && staffHasPermission(user, 'orders.manage')) return;
  throw new HttpsError('permission-denied', 'You do not have permission to manage orders.');
}

function requireSuperAdmin(user) {
  if (user.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only super admin can verify payment.');
  }
}

function soRef(salesOrderId) {
  const id = String(salesOrderId ?? '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'Sales order id is required.');
  return getFirestore().doc(`${SO_COLLECTION}/${id}`);
}

async function loadSoOrThrow(salesOrderId) {
  const ref = soRef(salesOrderId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Sales order not found.');
  return { ref, id: snap.id, data: snap.data() || {} };
}

function normalizeZohoStatus(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '_');
}

function yesOneStageOf(data) {
  const stage = String(data.yesOneStage || '').trim();
  return STAGES.has(stage) ? stage : 'review';
}

async function assertDealerOwnsSo(user, data) {
  if (!DEALER_ROLES.has(user.role)) {
    throw new HttpsError('permission-denied', 'Only dealers can perform this action.');
  }
  const customerId = await resolveZohoCustomerIdForUser(user.uid, user.role);
  if (!customerId || String(data.customerId || '') !== String(customerId)) {
    throw new HttpsError('permission-denied', 'You do not have access to this sales order.');
  }
}

/** Dealer owner, or staff/super_admin with orders.manage (phone-order payment proof). */
async function assertCanSubmitPayment(user, data) {
  if (OPS_ROLES.has(user.role)) {
    requireOrdersManage(user);
    return;
  }
  await assertDealerOwnsSo(user, data);
}

function lineTotal(rate, qty) {
  return Math.round(Number(rate) * Number(qty) * 100) / 100;
}

async function loadCatalogProduct(productId) {
  const db = getFirestore();
  let snap = await db.doc(`${PRODUCTS}/${productId}`).get();
  if (!snap.exists) {
    const byItem = await db.collection(PRODUCTS)
      .where('itemId', '==', String(productId))
      .limit(1)
      .get();
    if (!byItem.empty) snap = byItem.docs[0];
  }
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    productId: snap.id,
    itemId: data.itemId != null ? String(data.itemId) : snap.id,
    name: String(data.name ?? 'Product'),
    sku: data.sku != null ? String(data.sku) : null,
    description: data.description != null ? String(data.description).trim() || null : null,
    rate: Number(data.rate ?? 0),
    unit: String(data.unit ?? 'pcs'),
    stockStatus: effectiveCatalogStockStatus(
      data.stockStatus != null ? String(data.stockStatus) : null,
      data.hsn,
    ),
    categoryName: data.categoryName != null ? String(data.categoryName) : null,
    hsn: data.hsn != null ? String(data.hsn) : null,
    status: String(data.status ?? 'active'),
    hiddenFromCatalog: Boolean(data.hiddenFromCatalog),
  };
}

async function buildLinesFromInput(rawLines, { allowOutOfStock = true, allowRateOverride = true } = {}) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new HttpsError('invalid-argument', 'Add at least one product.');
  }

  const merged = new Map();
  for (const row of rawLines) {
    const productId = String(row?.productId ?? row?.itemId ?? '').trim();
    const quantity = Math.floor(Number(row?.quantity ?? 0));
    if (!productId || quantity < 1) {
      throw new HttpsError('invalid-argument', 'Each line needs a product and quantity ≥ 1.');
    }
    let rateOverride = null;
    if (allowRateOverride && row?.rate != null && row.rate !== '') {
      const parsed = Number(row.rate);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new HttpsError('invalid-argument', 'Each line rate must be a number ≥ 0.');
      }
      rateOverride = parsed;
    }
    const prev = merged.get(productId) || { quantity: 0, rateOverride: null };
    merged.set(productId, {
      quantity: prev.quantity + quantity,
      rateOverride: rateOverride != null ? rateOverride : prev.rateOverride,
    });
  }

  const lines = [];
  const priceChanges = [];
  for (const [productId, entry] of merged) {
    const product = await loadCatalogProduct(productId);
    if (!product || product.hiddenFromCatalog || product.status === 'inactive') {
      throw new HttpsError('failed-precondition', `Product unavailable: ${productId}`);
    }
    if (!allowOutOfStock && product.stockStatus === 'out_of_stock' && !isSacHsn(product.hsn)) {
      throw new HttpsError(
        'failed-precondition',
        `${product.name} is out of stock and cannot be ordered.`,
      );
    }
    const catalogRate = Number(product.rate) || 0;
    const rate = entry.rateOverride != null
      ? Math.round(entry.rateOverride * 100) / 100
      : catalogRate;
    lines.push({
      productId: product.productId,
      itemId: product.itemId,
      name: product.name,
      sku: product.sku,
      description: product.description,
      rate,
      unit: product.unit,
      quantity: entry.quantity,
      lineTotal: lineTotal(rate, entry.quantity),
      categoryName: product.categoryName,
      hsn: product.hsn,
      stockStatus: product.stockStatus,
    });
    if (Math.round(rate * 100) !== Math.round(catalogRate * 100)) {
      priceChanges.push({
        productId: product.productId,
        itemId: product.itemId,
        name: product.name,
        sku: product.sku,
        catalogRate,
        rate,
        quantity: entry.quantity,
      });
    }
  }
  return { lines, priceChanges };
}

function firebaseDownloadUrl(bucketName, storagePath, token) {
  const encoded = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media&token=${token}`;
}

async function durableReadUrl(storagePath) {
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'Payment screenshot not found.');
  const [metadata] = await file.getMetadata();
  let token = metadata?.metadata?.firebaseStorageDownloadTokens;
  if (Array.isArray(token)) token = token[0];
  if (typeof token === 'string' && token.includes(',')) {
    token = token.split(',')[0].trim();
  }
  if (!token) {
    token = randomUUID();
    await file.setMetadata({
      metadata: {
        ...(metadata.metadata || {}),
        firebaseStorageDownloadTokens: token,
      },
    });
  }
  return firebaseDownloadUrl(bucket.name, storagePath, token);
}

function extFromContentType(type, fileName) {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
  const lower = String(fileName ?? '').toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.webp')) return 'webp';
  return 'jpg';
}

async function detailPayload(id, data, { includePaymentUrl = false } = {}) {
  const mapped = await withCatalogLineImages(
    await withResolvedShippingAddress(mapSalesOrderDoc(id, data)),
  );
  let paymentScreenshotUrl = null;
  if (includePaymentUrl && data.paymentScreenshotStoragePath) {
    try {
      paymentScreenshotUrl = await durableReadUrl(String(data.paymentScreenshotStoragePath));
    } catch {
      paymentScreenshotUrl = null;
    }
  }
  return {
    ...mapped,
    yesOneStage: yesOneStageOf(data),
    yesOnePriceCustomized: Boolean(data.yesOnePriceCustomized),
    yesOnePriceChanges: Array.isArray(data.yesOnePriceChanges) ? data.yesOnePriceChanges : [],
    yesOneCreatedByStaff: Boolean(data.yesOneCreatedByStaff),
    yesOneCreatedByName: data.yesOneCreatedByName ? String(data.yesOneCreatedByName) : null,
    paymentAmount: data.paymentAmount != null ? Number(data.paymentAmount) : null,
    paymentUtr: data.paymentUtr ?? null,
    paymentScreenshotStoragePath: data.paymentScreenshotStoragePath ?? null,
    paymentScreenshotUrl,
    paymentSubmittedAt: data.paymentSubmittedAt ?? null,
    paymentVerifiedAt: data.paymentVerifiedAt ?? null,
    readyForPaymentAt: data.readyForPaymentAt ?? null,
    readyForPaymentByName: data.readyForPaymentByName ?? null,
    zohoInvoiceId: data.zohoInvoiceId ?? null,
    zohoInvoiceNumber: data.zohoInvoiceNumber ?? null,
  };
}

/** Seed YesOne workflow after cart creates a Draft SO. */
export async function initYesOneSalesOrderWorkflow(salesOrderId, extras = {}) {
  const id = String(salesOrderId || '').trim();
  if (!id) return;
  await soRef(id).set({
    yesOneStage: 'review',
    yesOneUpdatedAt: nowIso(),
    ...extras,
  }, { merge: true });
}

export async function updateDraftSalesOrderLines(uid, role, payload = {}, secrets, orgId) {
  const user = await loadUser(uid);
  requireOrdersManage(user);

  const { ref, id, data } = await loadSoOrThrow(payload.salesOrderId);
  const zohoStatus = normalizeZohoStatus(data.status);
  if (zohoStatus !== 'draft' && zohoStatus !== 'pending') {
    throw new HttpsError('failed-precondition', 'Only Draft sales orders can be edited.');
  }
  const stage = yesOneStageOf(data);
  if (stage === 'payment_submitted' || stage === 'completed' || stage === 'void') {
    throw new HttpsError(
      'failed-precondition',
      'This sales order can no longer be edited.',
    );
  }

  const { lines, priceChanges } = await buildLinesFromInput(payload.lines, {
    allowOutOfStock: true,
    allowRateOverride: true,
  });
  await updateSalesOrderLines(secrets, orgId, id, lines);
  await mirrorSalesOrderFromZoho(secrets, orgId, id);

  const at = nowIso();
  const actorName = displayName(user);
  const nextChanges = priceChanges.map(change => ({
    ...change,
    changedAt: at,
    changedByUid: uid,
    changedByName: actorName,
  }));

  // Keep YesOne stage (review or ready_for_payment).
  await ref.set({
    yesOneUpdatedAt: at,
    yesOneLastEditedAt: at,
    yesOneLastEditedByUid: uid,
    yesOneLastEditedByName: actorName,
    yesOnePriceCustomized: nextChanges.length > 0,
    yesOnePriceChanges: nextChanges,
    ...(stage === 'ready_for_payment'
      ? {
        paymentAmount: Math.round(
          lines.reduce((s, l) => s + Number(l.lineTotal || 0), 0) * 100,
        ) / 100,
      }
      : {}),
  }, { merge: true });

  const snap = await ref.get();
  return detailPayload(snap.id, snap.data() || {}, { includePaymentUrl: true });
}

/** Staff/super admin: change shipping address on a Draft SO (Zoho + mirror). */
export async function updateDraftSalesOrderShipping(uid, role, payload = {}, secrets, orgId) {
  const user = await loadUser(uid);
  requireOrdersManage(user);

  const { ref, id, data } = await loadSoOrThrow(payload.salesOrderId);
  const zohoStatus = normalizeZohoStatus(data.status);
  if (zohoStatus !== 'draft' && zohoStatus !== 'pending') {
    throw new HttpsError('failed-precondition', 'Only Draft sales orders can change shipping address.');
  }
  const stage = yesOneStageOf(data);
  if (stage === 'payment_submitted' || stage === 'completed' || stage === 'void') {
    throw new HttpsError('failed-precondition', 'This sales order can no longer change shipping address.');
  }

  const customerId = String(data.customerId || '').trim();
  if (!customerId) {
    throw new HttpsError('failed-precondition', 'Sales order has no customer.');
  }

  const shippingSel = payload.shipping || {};
  const resolved = await resolveShippingAddressId(secrets, orgId, customerId, {
    addressId: shippingSel.addressId || null,
    kind: shippingSel.kind || null,
    newAddress: shippingSel.newAddress || null,
  });

  await updateSalesOrderShippingAddress(secrets, orgId, id, {
    shippingAddressId: resolved.shippingAddressId,
    shippingAddressInline: resolved.useInline ? resolved.address : null,
  });
  await mirrorSalesOrderFromZoho(secrets, orgId, id);

  await ref.set({
    shippingAddressId: resolved.shippingAddressId || null,
    shippingAddress: resolved.address?.formatted || null,
    yesOneUpdatedAt: nowIso(),
    yesOneLastEditedAt: nowIso(),
    yesOneLastEditedByUid: uid,
    yesOneLastEditedByName: displayName(user),
  }, { merge: true });

  const snap = await ref.get();
  return detailPayload(snap.id, snap.data() || {}, { includePaymentUrl: true });
}

export async function markSalesOrderReadyForPayment(uid, role, salesOrderId) {
  const user = await loadUser(uid);
  requireOrdersManage(user);

  const { ref, data } = await loadSoOrThrow(salesOrderId);
  const zohoStatus = normalizeZohoStatus(data.status);
  if (zohoStatus === 'void' || zohoStatus === 'cancelled' || zohoStatus === 'canceled') {
    throw new HttpsError('failed-precondition', 'Cannot mark a voided sales order ready for payment.');
  }
  const stage = yesOneStageOf(data);
  if (stage === 'completed' || stage === 'void') {
    throw new HttpsError('failed-precondition', 'This sales order is already closed.');
  }
  if (stage === 'payment_submitted') {
    throw new HttpsError('failed-precondition', 'Payment is already submitted for this order.');
  }

  const lines = Array.isArray(data.lineItems) ? data.lineItems : [];
  if (!lines.length) {
    throw new HttpsError('failed-precondition', 'Add at least one line item before requesting payment.');
  }

  const at = nowIso();
  await ref.set({
    yesOneStage: 'ready_for_payment',
    readyForPaymentAt: at,
    readyForPaymentByUid: uid,
    readyForPaymentByName: displayName(user),
    paymentAmount: Number(data.total ?? data.subtotal ?? 0),
    yesOneUpdatedAt: at,
  }, { merge: true });

  const snap = await ref.get();
  return detailPayload(snap.id, snap.data() || {}, { includePaymentUrl: true });
}

export async function uploadSalesOrderPaymentScreenshot(uid, input = {}) {
  const user = await loadUser(uid);
  const { id, data } = await loadSoOrThrow(input.salesOrderId);
  await assertCanSubmitPayment(user, data);

  const stage = yesOneStageOf(data);
  if (stage !== 'ready_for_payment' && stage !== 'payment_submitted') {
    throw new HttpsError(
      'failed-precondition',
      'Payment can only be uploaded after the order is ready for payment.',
    );
  }

  const contentType = String(input.contentType || 'image/jpeg').trim();
  if (!contentType.startsWith('image/')) {
    throw new HttpsError('invalid-argument', 'Payment screenshot must be an image.');
  }
  const dataBase64 = String(input.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!dataBase64) throw new HttpsError('invalid-argument', 'Image data is required.');
  const buffer = Buffer.from(dataBase64, 'base64');
  if (!buffer.length) throw new HttpsError('invalid-argument', 'Image data is empty.');
  if (buffer.length > MAX_PAYMENT_BYTES) {
    throw new HttpsError('invalid-argument', 'Image must be 8 MB or smaller.');
  }

  const ext = extFromContentType(contentType, input.fileName);
  const token = randomUUID();
  const storagePath = `sales-order-payments/${id}/${Date.now()}_${token.slice(0, 8)}.${ext}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    resumable: false,
    contentType,
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
        uploadedByUid: uid,
        salesOrderId: id,
      },
    },
  });

  const url = firebaseDownloadUrl(bucket.name, storagePath, token);
  return { storagePath, url };
}

export async function submitSalesOrderPayment(uid, role, payload = {}) {
  const user = await loadUser(uid);
  const { ref, id, data } = await loadSoOrThrow(payload.salesOrderId);
  await assertCanSubmitPayment(user, data);

  const stage = yesOneStageOf(data);
  if (stage !== 'ready_for_payment' && stage !== 'payment_submitted') {
    throw new HttpsError(
      'failed-precondition',
      'This sales order is not awaiting payment.',
    );
  }

  const storagePath = String(payload.paymentScreenshotStoragePath || '').trim();
  if (!storagePath.startsWith(`sales-order-payments/${id}/`)) {
    throw new HttpsError('invalid-argument', 'Invalid payment screenshot path.');
  }
  const utr = String(payload.paymentUtr || '').trim().slice(0, 80);
  const at = nowIso();
  let paymentScreenshotUrl = null;
  try {
    paymentScreenshotUrl = await durableReadUrl(storagePath);
  } catch {
    paymentScreenshotUrl = null;
  }

  await ref.set({
    yesOneStage: 'payment_submitted',
    paymentScreenshotStoragePath: storagePath,
    paymentScreenshotUrl,
    paymentUtr: utr || null,
    paymentAmount: Number(data.total ?? data.paymentAmount ?? 0),
    paymentSubmittedAt: at,
    paymentSubmittedByUid: uid,
    paymentSubmittedByName: displayName(user),
    yesOneUpdatedAt: at,
  }, { merge: true });

  const snap = await ref.get();
  return detailPayload(snap.id, snap.data() || {}, { includePaymentUrl: false });
}

/**
 * Super admin: verify payment → Confirm Zoho SO → create Invoice
 * → (B2B only) push e-invoice to IRP → mark completed.
 */
export async function verifySalesOrderPayment(uid, role, salesOrderId, secrets, orgId) {
  const user = await loadUser(uid);
  requireSuperAdmin(user);

  const { ref, id, data } = await loadSoOrThrow(salesOrderId);
  if (yesOneStageOf(data) !== 'payment_submitted') {
    throw new HttpsError(
      'failed-precondition',
      'Payment must be submitted before verification.',
    );
  }
  if (!data.paymentScreenshotStoragePath) {
    throw new HttpsError('failed-precondition', 'Payment screenshot is missing.');
  }

  const zohoStatus = normalizeZohoStatus(data.status);
  if (zohoStatus === 'void' || zohoStatus === 'cancelled' || zohoStatus === 'canceled') {
    throw new HttpsError('failed-precondition', 'Cannot verify payment on a voided sales order.');
  }

  try {
    if (zohoStatus === 'draft' || zohoStatus === 'pending') {
      await confirmSalesOrder(secrets, orgId, id);
    }

    const { salespersonId } = requireSalespersonOnSalesOrder(data);

    let invoiceId = data.zohoInvoiceId || null;
    let invoiceNumber = data.zohoInvoiceNumber || null;
    if (!invoiceId) {
      const inv = await createInvoiceFromSalesOrder(secrets, orgId, {
        salesOrderId: id,
        customerId: data.customerId,
        referenceNumber: data.referenceNumber,
        salespersonId,
      });
      invoiceId = inv.invoiceId;
      invoiceNumber = inv.invoiceNumber;
    }

    let einvoicePushStatus = 'skipped_not_b2b';
    let einvoicePushError = null;
    const customer = await resolveCustomerForEinvoice(secrets, orgId, data.customerId);
    if (isZohoCustomerEinvoicePushEligible(customer)) {
      try {
        await pushInvoiceEinvoiceToIrp(secrets, orgId, invoiceId);
        einvoicePushStatus = 'pushed';
      } catch (pushErr) {
        einvoicePushStatus = 'failed';
        einvoicePushError = String(pushErr?.message || 'E-invoice push failed.');
        console.warn(
          `E-invoice push failed for invoice ${invoiceId} (SO ${id}):`,
          einvoicePushError,
        );
      }
    }

    await mirrorSalesOrderFromZoho(secrets, orgId, id);

    const at = nowIso();
    await ref.set({
      yesOneStage: 'completed',
      paymentVerifiedAt: at,
      paymentVerifiedByUid: uid,
      paymentVerifiedByName: displayName(user),
      zohoInvoiceId: invoiceId,
      zohoInvoiceNumber: invoiceNumber,
      einvoicePushStatus,
      einvoicePushError,
      einvoicePushedAt: einvoicePushStatus === 'pushed' ? at : null,
      yesOneUpdatedAt: at,
      yesOneSyncError: null,
    }, { merge: true });
  } catch (err) {
    const message = err?.message || 'Could not complete sales order in Zoho.';
    await ref.set({
      yesOneSyncError: message,
      yesOneUpdatedAt: nowIso(),
    }, { merge: true });
    throw new HttpsError('internal', message);
  }

  const snap = await ref.get();
  return detailPayload(snap.id, snap.data() || {}, { includePaymentUrl: true });
}

/** Void Zoho SO and mark YesOne workflow void. */
export async function voidSalesOrderWithWorkflow(uid, role, salesOrderId, reason, secrets, orgId) {
  const user = await loadUser(uid);
  requireOrdersManage(user);

  const { ref, id } = await loadSoOrThrow(salesOrderId);
  await voidSalesOrder(secrets, orgId, id, reason);
  await mirrorSalesOrderFromZoho(secrets, orgId, id);
  await ref.set({
    yesOneStage: 'void',
    yesOneUpdatedAt: nowIso(),
    voidedAt: nowIso(),
    voidedByUid: uid,
    voidedByName: displayName(user),
    voidReason: String(reason || '').trim().slice(0, 500) || null,
  }, { merge: true });

  const snap = await ref.get();
  return detailPayload(snap.id, snap.data() || {}, { includePaymentUrl: true });
}

/**
 * Delete a Draft Zoho SO (Zoho DELETE) and remove the Firestore mirror.
 * Staff/super_admin with orders.manage, or the owning dealer.
 */
export async function deleteDraftSalesOrder(uid, role, salesOrderId, secrets, orgId) {
  const user = await loadUser(uid);
  const { ref, id, data } = await loadSoOrThrow(salesOrderId);

  if (OPS_ROLES.has(user.role)) {
    requireOrdersManage(user);
  } else if (DEALER_ROLES.has(user.role)) {
    await assertDealerOwnsSo(user, data);
  } else {
    throw new HttpsError('permission-denied', 'You cannot delete this sales order.');
  }

  const zohoStatus = normalizeZohoStatus(data.status);
  if (zohoStatus !== 'draft' && zohoStatus !== 'pending') {
    throw new HttpsError(
      'failed-precondition',
      'Only Draft sales orders can be deleted. Use Void for confirmed orders.',
    );
  }
  const stage = yesOneStageOf(data);
  if (stage === 'payment_submitted' || stage === 'completed' || stage === 'void') {
    throw new HttpsError(
      'failed-precondition',
      'This sales order can no longer be deleted.',
    );
  }

  try {
    await deleteSalesOrder(secrets, orgId, id);
  } catch (err) {
    const message = String(err?.message || err || '');
    // Already gone in Zoho — still clear the portal mirror.
    if (!/not found|does not exist|invalid|404/i.test(message)) {
      throw new HttpsError('internal', message || 'Could not delete sales order in Zoho.');
    }
  }

  await ref.delete();
  return { salesOrderId: id, deleted: true };
}

export async function getSalesOrderWorkflowDetail(uid, role, salesOrderId) {
  const user = await loadUser(uid);
  const { id, data } = await loadSoOrThrow(salesOrderId);

  if (OPS_ROLES.has(user.role)) {
    if (user.role === 'staff' && !staffHasPermission(user, 'orders.view')) {
      throw new HttpsError('permission-denied', 'You do not have access to orders.');
    }
    return detailPayload(id, data, { includePaymentUrl: true });
  }

  await assertDealerOwnsSo(user, data);
  return detailPayload(id, data, { includePaymentUrl: false });
}

export function sumWorkflowItemCount(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => {
    if (isQuantityExcludedLineItem(line?.name, line?.sku, line?.hsn)) return sum;
    return sum + Number(line?.quantity || 0);
  }, 0);
}
