/**
 * Dealer portal product orders: submit → staff review → payment → Zoho.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { resolveZohoCustomerIdForUser } from './zoho-invoices.js';
import {
  createSalesOrderFromDealerOrder,
  createInvoiceFromSalesOrder,
} from './zoho-sales-orders.js';
import { getDealerOrderPaymentUrl } from './dealer-order-upload.js';

const COLLECTION = 'dealerOrders';
const PRODUCTS = 'catalogProducts';
const CUSTOMERS = 'zohoCustomers';

const STATUSES = new Set([
  'pending_review',
  'waiting_for_payment',
  'payment_submitted',
  'processing',
  'completed',
  'rejected',
  'cancelled',
]);

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

const ADMIN_DEFAULT_PERMS = new Set([
  'orders.view',
  'orders.manage',
]);

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

function resolveDealerId(user) {
  if (user.role === 'dealer') return user.uid;
  if (user.role === 'dealer_staff') {
    return String(user.data?.dealerId ?? user.data?.directorId ?? user.uid);
  }
  return null;
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

function requireOrdersView(user) {
  if (user.role === 'super_admin') return;
  if (user.role === 'staff' && staffHasPermission(user, 'orders.view')) return;
  throw new HttpsError('permission-denied', 'You do not have access to orders.');
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

function assertDealerOrderAccess(user, order) {
  if (OPS_ROLES.has(user.role)) {
    requireOrdersView(user);
    return;
  }
  if (!DEALER_ROLES.has(user.role)) {
    throw new HttpsError('permission-denied', 'You do not have access to this order.');
  }
  const dealerId = resolveDealerId(user);
  if (!dealerId || String(order.dealerId) !== dealerId) {
    throw new HttpsError('permission-denied', 'You do not have access to this order.');
  }
}

function lineTotal(rate, qty) {
  return Math.round(Number(rate) * Number(qty) * 100) / 100;
}

function sumSubtotal(lines) {
  return Math.round(lines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0) * 100) / 100;
}

function sumItemCount(lines) {
  return lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
}

function statusEvent(status, user, note = null) {
  return {
    status,
    at: nowIso(),
    byUid: user?.uid ?? null,
    byName: user ? displayName(user) : null,
    note: note || null,
  };
}

async function nextOrderNumber() {
  const db = getFirestore();
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const counterRef = db.doc(`dealerOrderCounters/${day}`);
  const seq = await db.runTransaction(async tx => {
    const snap = await tx.get(counterRef);
    const next = Number(snap.exists ? snap.data()?.seq ?? 0 : 0) + 1;
    tx.set(counterRef, { seq: next, updatedAt: nowIso() }, { merge: true });
    return next;
  });
  return `YES-ORD-${day}-${String(seq).padStart(4, '0')}`;
}

async function loadCatalogProduct(productId) {
  const snap = await getFirestore().doc(`${PRODUCTS}/${productId}`).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    productId: snap.id,
    itemId: data.itemId != null ? String(data.itemId) : snap.id,
    name: String(data.name ?? 'Product'),
    sku: data.sku != null ? String(data.sku) : null,
    imageUrl: data.imageUrl != null ? String(data.imageUrl) : null,
    rate: Number(data.rate ?? 0),
    unit: String(data.unit ?? 'pcs'),
    stockStatus: data.stockStatus != null ? String(data.stockStatus) : null,
    categoryName: data.categoryName != null ? String(data.categoryName) : null,
    categoryId: data.categoryId != null ? String(data.categoryId) : null,
    taxPercentage: Number(data.taxPercentage ?? 0),
    hsn: data.hsn != null ? String(data.hsn) : null,
    status: String(data.status ?? 'active'),
    hiddenFromCatalog: Boolean(data.hiddenFromCatalog),
  };
}

function toOrderLine(product, quantity) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 0));
  return {
    productId: product.productId,
    itemId: product.itemId,
    name: product.name,
    sku: product.sku,
    imageUrl: product.imageUrl,
    rate: Number(product.rate) || 0,
    unit: product.unit,
    quantity: qty,
    lineTotal: lineTotal(product.rate, qty),
    stockStatus: product.stockStatus,
    categoryName: product.categoryName,
    taxPercentage: product.taxPercentage,
    hsn: product.hsn,
  };
}

async function buildLinesFromInput(rawLines, { allowOutOfStock = false } = {}) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new HttpsError('invalid-argument', 'Add at least one product.');
  }

  const merged = new Map();
  for (const row of rawLines) {
    const productId = String(row?.productId ?? '').trim();
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
    lines.push(toOrderLine(product, quantity));
  }
  return lines;
}

async function loadDealerProfile(dealerId, zohoCustomerId) {
  const db = getFirestore();
  let customer = null;
  if (zohoCustomerId) {
    const snap = await db.doc(`${CUSTOMERS}/${zohoCustomerId}`).get();
    if (snap.exists) customer = snap.data();
  }
  if (!customer && dealerId) {
    const q = await db.collection(CUSTOMERS)
      .where('portalUserId', '==', dealerId)
      .limit(1)
      .get();
    if (!q.empty) customer = q.docs[0].data();
  }
  return {
    dealerName: customer?.contactName || customer?.companyName || null,
    dealerCode: customer?.customerCode || customer?.cfDealerCode || null,
    canBuySpares: customer?.canBuySpares !== false,
    maxOrderLimit: customer?.maxOrderLimit != null ? Number(customer.maxOrderLimit) : null,
  };
}

function isSpareCategory(categoryName, categoryId) {
  const name = String(categoryName ?? '').toLowerCase();
  if (name.includes('spare')) return true;
  const id = String(categoryId ?? '').toLowerCase();
  return id.includes('spare');
}

function mapOrderDoc(id, data, paymentScreenshotUrl = null) {
  return {
    id,
    orderNumber: String(data.orderNumber ?? ''),
    dealerId: String(data.dealerId ?? ''),
    zohoCustomerId: String(data.zohoCustomerId ?? ''),
    dealerName: data.dealerName ?? null,
    dealerCode: data.dealerCode ?? null,
    createdByUid: String(data.createdByUid ?? ''),
    createdByName: data.createdByName ?? null,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
    status: STATUSES.has(String(data.status)) ? String(data.status) : 'pending_review',
    statusHistory: Array.isArray(data.statusHistory) ? data.statusHistory : [],
    rejectionReason: data.rejectionReason ?? null,
    lines: Array.isArray(data.lines) ? data.lines : [],
    submittedLines: Array.isArray(data.submittedLines) ? data.submittedLines : [],
    changes: Array.isArray(data.changes) ? data.changes : [],
    subtotal: Number(data.subtotal ?? 0),
    itemCount: Number(data.itemCount ?? 0),
    approvedAt: data.approvedAt ?? null,
    approvedByUid: data.approvedByUid ?? null,
    approvedByName: data.approvedByName ?? null,
    paymentAmount: data.paymentAmount != null ? Number(data.paymentAmount) : null,
    paymentUtr: data.paymentUtr ?? null,
    paymentScreenshotStoragePath: data.paymentScreenshotStoragePath ?? null,
    paymentScreenshotUrl,
    paymentSubmittedAt: data.paymentSubmittedAt ?? null,
    paymentVerifiedAt: data.paymentVerifiedAt ?? null,
    paymentVerifiedByUid: data.paymentVerifiedByUid ?? null,
    zohoSalesOrderId: data.zohoSalesOrderId ?? null,
    zohoSalesOrderNumber: data.zohoSalesOrderNumber ?? null,
    zohoInvoiceId: data.zohoInvoiceId ?? null,
    zohoInvoiceNumber: data.zohoInvoiceNumber ?? null,
    zohoSyncError: data.zohoSyncError ?? null,
  };
}

async function getOrderOrThrow(orderId) {
  const id = String(orderId ?? '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'Order id is required.');
  const snap = await getFirestore().doc(`${COLLECTION}/${id}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
  return { ref: snap.ref, id: snap.id, data: snap.data() || {} };
}

function buildChangeLog(prevLines, nextLines, user) {
  const prevMap = new Map(prevLines.map(line => [line.productId, line]));
  const nextMap = new Map(nextLines.map(line => [line.productId, line]));
  const changes = [];
  const at = nowIso();
  const byUid = user.uid;
  const byName = displayName(user);

  for (const [productId, next] of nextMap) {
    const prev = prevMap.get(productId);
    if (!prev) {
      changes.push({
        at, byUid, byName, type: 'added',
        productId, productName: next.name,
        fromQty: 0, toQty: next.quantity,
      });
      continue;
    }
    if (Number(prev.quantity) !== Number(next.quantity)) {
      changes.push({
        at, byUid, byName, type: 'qty_changed',
        productId, productName: next.name,
        fromQty: prev.quantity, toQty: next.quantity,
      });
    }
    if (Number(prev.rate) !== Number(next.rate)) {
      changes.push({
        at, byUid, byName, type: 'rate_changed',
        productId, productName: next.name,
        fromRate: prev.rate, toRate: next.rate,
        fromQty: prev.quantity, toQty: next.quantity,
      });
    }
  }

  for (const [productId, prev] of prevMap) {
    if (!nextMap.has(productId)) {
      changes.push({
        at, byUid, byName, type: 'removed',
        productId, productName: prev.name,
        fromQty: prev.quantity, toQty: 0,
      });
    }
  }

  return changes;
}

export async function submitDealerOrder(uid, role, payload = {}) {
  const user = await loadUser(uid);
  if (!DEALER_ROLES.has(user.role)) {
    throw new HttpsError('permission-denied', 'Only dealers can submit orders.');
  }

  const dealerId = resolveDealerId(user);
  const zohoCustomerId = await resolveZohoCustomerIdForUser(uid, user.role);
  const profile = await loadDealerProfile(dealerId, zohoCustomerId);

  const lines = await buildLinesFromInput(payload.lines, { allowOutOfStock: false });

  // Enforce spares flag
  if (profile.canBuySpares === false) {
    const spare = lines.find(line => isSpareCategory(line.categoryName, null));
    if (spare) {
      throw new HttpsError(
        'failed-precondition',
        'Your account is not allowed to order spare parts.',
      );
    }
  }

  const subtotal = sumSubtotal(lines);
  if (profile.maxOrderLimit != null && profile.maxOrderLimit > 0 && subtotal > profile.maxOrderLimit) {
    throw new HttpsError(
      'failed-precondition',
      `Order total exceeds your limit of ₹${profile.maxOrderLimit.toLocaleString('en-IN')}.`,
    );
  }

  const orderNumber = await nextOrderNumber();
  const createdAt = nowIso();
  const ref = getFirestore().collection(COLLECTION).doc();
  const status = 'pending_review';
  const doc = {
    orderNumber,
    dealerId,
    zohoCustomerId,
    dealerName: profile.dealerName,
    dealerCode: profile.dealerCode,
    createdByUid: uid,
    createdByName: displayName(user),
    createdAt,
    updatedAt: createdAt,
    status,
    statusHistory: [statusEvent(status, user)],
    rejectionReason: null,
    lines,
    submittedLines: lines.map(line => ({ ...line })),
    changes: [],
    subtotal,
    itemCount: sumItemCount(lines),
    approvedAt: null,
    approvedByUid: null,
    approvedByName: null,
    paymentAmount: null,
    paymentUtr: null,
    paymentScreenshotStoragePath: null,
    paymentSubmittedAt: null,
    paymentVerifiedAt: null,
    paymentVerifiedByUid: null,
    zohoSalesOrderId: null,
    zohoSalesOrderNumber: null,
    zohoInvoiceId: null,
    zohoInvoiceNumber: null,
    zohoSyncError: null,
  };

  await ref.set(doc);
  return mapOrderDoc(ref.id, doc);
}

export async function getDealerOrder(uid, role, orderId) {
  const user = await loadUser(uid);
  const { id, data } = await getOrderOrThrow(orderId);
  assertDealerOrderAccess(user, data);

  let paymentScreenshotUrl = null;
  if (data.paymentScreenshotStoragePath) {
    try {
      paymentScreenshotUrl = await getDealerOrderPaymentUrl(uid, data.paymentScreenshotStoragePath);
    } catch {
      paymentScreenshotUrl = null;
    }
  }
  return mapOrderDoc(id, data, paymentScreenshotUrl);
}

export async function listDealerOrders(uid, role, query = {}) {
  const user = await loadUser(uid);
  const db = getFirestore();
  const status = String(query.status ?? '').trim();
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200);
  const dealerFilter = String(query.dealerId ?? '').trim();

  let q;
  if (OPS_ROLES.has(user.role)) {
    requireOrdersView(user);
    q = db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(limit);
  } else if (DEALER_ROLES.has(user.role)) {
    const dealerId = resolveDealerId(user);
    q = db.collection(COLLECTION)
      .where('dealerId', '==', dealerId)
      .orderBy('createdAt', 'desc')
      .limit(limit);
  } else {
    throw new HttpsError('permission-denied', 'You do not have access to orders.');
  }

  const snap = await q.get();
  let rows = snap.docs.map(docSnap => mapOrderDoc(docSnap.id, docSnap.data()));

  if (OPS_ROLES.has(user.role) && dealerFilter) {
    rows = rows.filter(row => row.dealerId === dealerFilter || row.zohoCustomerId === dealerFilter);
  }
  if (status && STATUSES.has(status)) {
    rows = rows.filter(row => row.status === status);
  }
  return { data: rows };
}

export async function updateDealerOrderLines(uid, role, payload = {}) {
  const user = await loadUser(uid);
  requireOrdersManage(user);

  const { ref, data } = await getOrderOrThrow(payload.orderId);
  if (data.status !== 'pending_review') {
    throw new HttpsError('failed-precondition', 'Only pending orders can be edited.');
  }

  const nextLines = await buildLinesFromInput(payload.lines, { allowOutOfStock: true });
  const changes = buildChangeLog(data.lines || [], nextLines, user);
  const updatedAt = nowIso();

  const patch = {
    lines: nextLines,
    subtotal: sumSubtotal(nextLines),
    itemCount: sumItemCount(nextLines),
    updatedAt,
  };
  if (changes.length) {
    patch.changes = FieldValue.arrayUnion(...changes);
  }
  await ref.update(patch);

  const snap = await ref.get();
  return mapOrderDoc(snap.id, snap.data());
}

export async function approveDealerOrder(uid, role, orderId) {
  const user = await loadUser(uid);
  requireOrdersManage(user);

  const { ref, data } = await getOrderOrThrow(orderId);
  if (data.status !== 'pending_review') {
    throw new HttpsError('failed-precondition', 'Only pending orders can be approved.');
  }
  if (!Array.isArray(data.lines) || data.lines.length === 0) {
    throw new HttpsError('failed-precondition', 'Order has no line items.');
  }

  const updatedAt = nowIso();
  const status = 'waiting_for_payment';
  const subtotal = sumSubtotal(data.lines);

  await ref.update({
    status,
    statusHistory: FieldValue.arrayUnion(statusEvent(status, user)),
    approvedAt: updatedAt,
    approvedByUid: uid,
    approvedByName: displayName(user),
    paymentAmount: subtotal,
    subtotal,
    itemCount: sumItemCount(data.lines),
    rejectionReason: null,
    updatedAt,
  });

  const snap = await ref.get();
  return mapOrderDoc(snap.id, snap.data());
}

export async function rejectDealerOrder(uid, role, orderId, reason) {
  const user = await loadUser(uid);
  requireOrdersManage(user);

  const { ref, data } = await getOrderOrThrow(orderId);
  if (data.status !== 'pending_review') {
    throw new HttpsError('failed-precondition', 'Only pending orders can be rejected.');
  }

  const note = String(reason ?? '').trim();
  if (!note) throw new HttpsError('invalid-argument', 'Rejection reason is required.');

  const status = 'rejected';
  const updatedAt = nowIso();
  await ref.update({
    status,
    statusHistory: FieldValue.arrayUnion(statusEvent(status, user, note)),
    rejectionReason: note,
    updatedAt,
  });

  const snap = await ref.get();
  return mapOrderDoc(snap.id, snap.data());
}

export async function cancelDealerOrder(uid, role, orderId) {
  const user = await loadUser(uid);
  const { ref, data } = await getOrderOrThrow(orderId);
  assertDealerOrderAccess(user, data);

  const cancellable = new Set(['pending_review', 'waiting_for_payment']);
  if (!cancellable.has(data.status)) {
    throw new HttpsError('failed-precondition', 'This order can no longer be cancelled.');
  }

  if (OPS_ROLES.has(user.role)) requireOrdersManage(user);

  const status = 'cancelled';
  const updatedAt = nowIso();
  await ref.update({
    status,
    statusHistory: FieldValue.arrayUnion(statusEvent(status, user)),
    updatedAt,
  });

  const snap = await ref.get();
  return mapOrderDoc(snap.id, snap.data());
}

export async function submitDealerOrderPayment(uid, role, payload = {}) {
  const user = await loadUser(uid);
  if (!DEALER_ROLES.has(user.role)) {
    throw new HttpsError('permission-denied', 'Only dealers can submit payment proof.');
  }

  const { ref, data } = await getOrderOrThrow(payload.orderId);
  assertDealerOrderAccess(user, data);

  if (data.status !== 'waiting_for_payment' && data.status !== 'payment_submitted') {
    throw new HttpsError(
      'failed-precondition',
      'Payment can only be submitted when the order is waiting for payment.',
    );
  }

  const storagePath = String(payload.paymentScreenshotStoragePath ?? '').trim();
  if (!storagePath || !storagePath.startsWith(`dealer-orders/${ref.id}/`)) {
    throw new HttpsError('invalid-argument', 'Payment screenshot is required.');
  }

  const paymentUtr = String(payload.paymentUtr ?? '').trim() || null;
  const paymentAmount = Number(data.paymentAmount ?? data.subtotal ?? 0);
  const status = 'payment_submitted';
  const updatedAt = nowIso();

  await ref.update({
    status,
    statusHistory: FieldValue.arrayUnion(statusEvent(status, user)),
    paymentScreenshotStoragePath: storagePath,
    paymentUtr,
    paymentAmount,
    paymentSubmittedAt: updatedAt,
    updatedAt,
  });

  let paymentScreenshotUrl = null;
  try {
    paymentScreenshotUrl = await getDealerOrderPaymentUrl(uid, storagePath);
  } catch {
    paymentScreenshotUrl = null;
  }

  const snap = await ref.get();
  return mapOrderDoc(snap.id, snap.data(), paymentScreenshotUrl);
}

export async function verifyDealerOrderPayment(uid, role, orderId, secrets, orgId) {
  const user = await loadUser(uid);
  requireSuperAdmin(user);

  const { ref, data } = await getOrderOrThrow(orderId);
  if (data.status !== 'payment_submitted' && data.status !== 'processing') {
    throw new HttpsError(
      'failed-precondition',
      'Only payment-submitted orders can be verified.',
    );
  }
  if (!data.paymentScreenshotStoragePath) {
    throw new HttpsError('failed-precondition', 'Payment screenshot is missing.');
  }

  // Idempotent if already completed
  if (data.status === 'completed' && data.zohoInvoiceId) {
    return mapOrderDoc(ref.id, data);
  }

  const processingAt = nowIso();
  await ref.update({
    status: 'processing',
    statusHistory: FieldValue.arrayUnion(statusEvent('processing', user)),
    zohoSyncError: null,
    updatedAt: processingAt,
  });

  try {
    let salesOrderId = data.zohoSalesOrderId || null;
    let salesOrderNumber = data.zohoSalesOrderNumber || null;

    if (!salesOrderId) {
      const so = await createSalesOrderFromDealerOrder(secrets, orgId, {
        ...data,
        id: ref.id,
      });
      salesOrderId = so.salesOrderId;
      salesOrderNumber = so.salesOrderNumber;
      await ref.update({
        zohoSalesOrderId: salesOrderId,
        zohoSalesOrderNumber: salesOrderNumber,
        updatedAt: nowIso(),
      });
    }

    let invoiceId = data.zohoInvoiceId || null;
    let invoiceNumber = data.zohoInvoiceNumber || null;
    if (!invoiceId) {
      const inv = await createInvoiceFromSalesOrder(secrets, orgId, {
        salesOrderId,
        customerId: data.zohoCustomerId,
        referenceNumber: data.orderNumber,
      });
      invoiceId = inv.invoiceId;
      invoiceNumber = inv.invoiceNumber;
    }

    const completedAt = nowIso();
    await ref.update({
      status: 'completed',
      statusHistory: FieldValue.arrayUnion(statusEvent('completed', user)),
      paymentVerifiedAt: completedAt,
      paymentVerifiedByUid: uid,
      zohoSalesOrderId: salesOrderId,
      zohoSalesOrderNumber: salesOrderNumber,
      zohoInvoiceId: invoiceId,
      zohoInvoiceNumber: invoiceNumber,
      zohoSyncError: null,
      updatedAt: completedAt,
    });
  } catch (err) {
    const message = err?.message || 'Could not create Zoho sales order / invoice.';
    await ref.update({
      status: 'payment_submitted',
      zohoSyncError: message,
      updatedAt: nowIso(),
    });
    throw new HttpsError('internal', message);
  }

  const snap = await ref.get();
  let paymentScreenshotUrl = null;
  if (snap.data()?.paymentScreenshotStoragePath) {
    try {
      paymentScreenshotUrl = await getDealerOrderPaymentUrl(
        uid,
        snap.data().paymentScreenshotStoragePath,
      );
    } catch {
      paymentScreenshotUrl = null;
    }
  }
  return mapOrderDoc(snap.id, snap.data(), paymentScreenshotUrl);
}

export async function countPendingDealerOrders() {
  const snap = await getFirestore()
    .collection(COLLECTION)
    .where('status', '==', 'pending_review')
    .limit(500)
    .get();
  return snap.size;
}
