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
  updateSalesOrderLines,
  voidSalesOrder,
} from './zoho-sales-orders.js';
import { mapSalesOrderDoc, mirrorSalesOrderFromZoho } from './sales-order-sync.js';
import { isQuantityExcludedLineItem } from './invoice-category.js';

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
    rate: Number(data.rate ?? 0),
    unit: String(data.unit ?? 'pcs'),
    stockStatus: data.stockStatus != null ? String(data.stockStatus) : null,
    categoryName: data.categoryName != null ? String(data.categoryName) : null,
    hsn: data.hsn != null ? String(data.hsn) : null,
    status: String(data.status ?? 'active'),
    hiddenFromCatalog: Boolean(data.hiddenFromCatalog),
  };
}

async function buildLinesFromInput(rawLines, { allowOutOfStock = true } = {}) {
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
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }

  const lines = [];
  for (const [productId, quantity] of merged) {
    const product = await loadCatalogProduct(productId);
    if (!product || product.hiddenFromCatalog || product.status === 'inactive') {
      throw new HttpsError('failed-precondition', `Product unavailable: ${productId}`);
    }
    if (!allowOutOfStock && product.stockStatus === 'out_of_stock') {
      throw new HttpsError(
        'failed-precondition',
        `${product.name} is out of stock and cannot be ordered.`,
      );
    }
    lines.push({
      productId: product.productId,
      itemId: product.itemId,
      name: product.name,
      sku: product.sku,
      rate: Number(product.rate) || 0,
      unit: product.unit,
      quantity,
      lineTotal: lineTotal(product.rate, quantity),
      categoryName: product.categoryName,
      hsn: product.hsn,
      stockStatus: product.stockStatus,
    });
  }
  return lines;
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
  const mapped = mapSalesOrderDoc(id, data);
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

  const lines = await buildLinesFromInput(payload.lines, { allowOutOfStock: true });
  await updateSalesOrderLines(secrets, orgId, id, lines);
  await mirrorSalesOrderFromZoho(secrets, orgId, id);

  // Keep YesOne stage (review or ready_for_payment).
  await ref.set({
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
  await assertDealerOwnsSo(user, data);

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
  await assertDealerOwnsSo(user, data);

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
 * Super admin: verify payment → Confirm Zoho SO → create Invoice → mark completed.
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

    let invoiceId = data.zohoInvoiceId || null;
    let invoiceNumber = data.zohoInvoiceNumber || null;
    if (!invoiceId) {
      const inv = await createInvoiceFromSalesOrder(secrets, orgId, {
        salesOrderId: id,
        customerId: data.customerId,
        referenceNumber: data.referenceNumber,
      });
      invoiceId = inv.invoiceId;
      invoiceNumber = inv.invoiceNumber;
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
