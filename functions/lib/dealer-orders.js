/**
 * Dealer cart → Zoho Inventory sales order (Draft) → confirm/void in Zoho.
 * No portal dealerOrders lifecycle — Firestore dealerOrders is deprecated and purgeable.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { resolveZohoCustomerIdForUser } from './zoho-invoices.js';
import {
  confirmSalesOrder,
  createSalesOrderFromDealerOrder,
  voidSalesOrder,
} from './zoho-sales-orders.js';
import { mirrorSalesOrderFromZoho } from './sales-order-sync.js';
import { isQuantityExcludedLineItem } from './invoice-category.js';

const PRODUCTS = 'catalogProducts';
const CUSTOMERS = 'zohoCustomers';
const LEGACY_COLLECTION = 'dealerOrders';

const DEALER_ROLES = new Set(['dealer', 'dealer_staff']);

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

function requireOrdersManage(user) {
  if (user.role === 'super_admin') return;
  if (user.role === 'staff' && staffHasPermission(user, 'orders.manage')) return;
  throw new HttpsError('permission-denied', 'You do not have permission to manage orders.');
}

function requireSuperAdmin(user) {
  if (user.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only super admin can run this action.');
  }
}

function lineTotal(rate, qty) {
  return Math.round(Number(rate) * Number(qty) * 100) / 100;
}

function sumSubtotal(lines) {
  return Math.round(lines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0) * 100) / 100;
}

function sumItemCount(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => {
    if (isQuantityExcludedLineItem(line?.name, line?.sku, line?.hsn)) return sum;
    return sum + Number(line?.quantity || 0);
  }, 0);
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

async function buildLinesFromInput(rawLines) {
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
    if (product.stockStatus === 'out_of_stock') {
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

/**
 * Place cart as a Zoho Inventory Draft sales order and mirror it locally.
 * Does not write a portal dealerOrders document.
 */
export async function submitDealerOrder(uid, role, payload = {}, secrets, orgId) {
  const user = await loadUser(uid);
  if (!DEALER_ROLES.has(user.role)) {
    throw new HttpsError('permission-denied', 'Only dealers can submit orders.');
  }
  if (!secrets) {
    throw new HttpsError('failed-precondition', 'Zoho credentials are not configured.');
  }

  const dealerId = resolveDealerId(user);
  const zohoCustomerId = await resolveZohoCustomerIdForUser(uid, user.role);
  if (!zohoCustomerId) {
    throw new HttpsError(
      'failed-precondition',
      'Your account is not linked to a Zoho customer. Contact support.',
    );
  }
  const profile = await loadDealerProfile(dealerId, zohoCustomerId);
  const lines = await buildLinesFromInput(payload.lines);

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
  let salesOrderId = null;
  let salesOrderNumber = null;
  let status = 'draft';

  try {
    const so = await createSalesOrderFromDealerOrder(secrets, orgId, {
      id: orderNumber,
      orderNumber,
      zohoCustomerId,
      lines,
      subtotal,
    });
    salesOrderId = so.salesOrderId;
    salesOrderNumber = so.salesOrderNumber;
    status = so.status || 'draft';
    try {
      await mirrorSalesOrderFromZoho(secrets, orgId, salesOrderId);
    } catch (mirrorErr) {
      console.warn(
        `Submit order ${orderNumber}: could not mirror SO ${salesOrderId}:`,
        mirrorErr?.message ?? mirrorErr,
      );
    }
  } catch (err) {
    const message = err?.message || 'Could not create Zoho sales order.';
    throw new HttpsError('failed-precondition', message);
  }

  return {
    zohoSalesOrderId: salesOrderId,
    zohoSalesOrderNumber: salesOrderNumber,
    orderNumber,
    status,
    subtotal,
    itemCount: sumItemCount(lines),
    dealerId,
    zohoCustomerId,
    dealerName: profile.dealerName,
    createdByUid: uid,
    createdByName: displayName(user),
  };
}

/** Confirm a mirrored Zoho SO (staff/admin). */
export async function confirmMirroredSalesOrder(uid, role, salesOrderId, secrets, orgId) {
  const user = await loadUser(uid);
  requireOrdersManage(user);
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new HttpsError('invalid-argument', 'Sales order id is required.');
  await confirmSalesOrder(secrets, orgId, soId);
  const mirrored = await mirrorSalesOrderFromZoho(secrets, orgId, soId);
  return {
    salesOrderId: soId,
    status: mirrored?.status || 'confirmed',
    salesOrderNumber: mirrored?.salesOrderNumber || null,
  };
}

/** Void a mirrored Zoho SO (staff/admin). */
export async function voidMirroredSalesOrder(uid, role, salesOrderId, reason, secrets, orgId) {
  const user = await loadUser(uid);
  requireOrdersManage(user);
  const soId = String(salesOrderId || '').trim();
  if (!soId) throw new HttpsError('invalid-argument', 'Sales order id is required.');
  await voidSalesOrder(secrets, orgId, soId, reason);
  const mirrored = await mirrorSalesOrderFromZoho(secrets, orgId, soId);
  return {
    salesOrderId: soId,
    status: mirrored?.status || 'void',
    salesOrderNumber: mirrored?.salesOrderNumber || null,
  };
}

/**
 * Delete all legacy portal dealerOrders documents (batch). Super admin only.
 * Does not delete Zoho sales orders.
 */
export async function purgeAllDealerOrders(uid) {
  const user = await loadUser(uid);
  requireSuperAdmin(user);

  const db = getFirestore();
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await db.collection(LEGACY_COLLECTION).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const docSnap of snap.docs) {
      batch.delete(docSnap.ref);
    }
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 400) break;
  }

  return { deleted, collection: LEGACY_COLLECTION };
}
