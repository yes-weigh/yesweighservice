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
import {
  resolveSalespersonForCustomer,
  resolveSalespersonForStaff,
  resolveSalespersonById,
  resolveSpareInchargeSalesperson,
  resolveCloudChargesSalesperson,
} from './sales-order-salesperson.js';
import {
  classifyOrderLineSegment,
  groupLinesBySegment,
  segmentLabel,
  segmentToInvoiceCategory,
  staffCanAddOrderSegment,
  ORDER_SEGMENTS,
} from './sales-order-segments.js';
import { isFreightOrderLine, isFreightProductId, isFreightSku } from './freight-lines.js';
import { mirrorSalesOrderFromZoho } from './sales-order-sync.js';
import { initYesOneSalesOrderWorkflow } from './sales-order-workflow.js';
import { yesOneGatcPersistFields } from './gatc-report.js';
import { resolveShippingAddressId } from './zoho-contact-addresses.js';
import { isQuantityExcludedLineItem } from './invoice-category.js';
import { effectiveCatalogStockStatus, isSacHsn } from './sac-catalog.js';
import {
  loadGatcStampingPriceMap,
  mergeKeyForLine,
  resolveGatcFeeForProduct,
} from './gatc-stamping.js';

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

function isFullSuperAdmin(user) {
  return user.role === 'super_admin' && user.data?.superAdminAccess !== 'view_only';
}

function staffHasPermission(user, permission) {
  if (isFullSuperAdmin(user)) return true;
  if (user.role === 'super_admin') return false;
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
  if (isFullSuperAdmin(user)) return;
  if (user.role === 'staff' && staffHasPermission(user, 'orders.manage')) return;
  throw new HttpsError('permission-denied', 'You do not have permission to manage orders.');
}

function requireSuperAdmin(user) {
  if (!isFullSuperAdmin(user)) {
    throw new HttpsError(
      'permission-denied',
      user.role === 'super_admin'
        ? 'Your account is view-only and cannot make changes.'
        : 'Only super admin can run this action.',
    );
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
    description: data.description != null ? String(data.description).trim() || null : null,
    rate: Number(data.rate ?? 0),
    unit: String(data.unit ?? 'pcs'),
    stockStatus: effectiveCatalogStockStatus(
      data.stockStatus != null ? String(data.stockStatus) : null,
      data.hsn,
    ),
    categoryName: data.categoryName != null ? String(data.categoryName) : null,
    categoryId: data.categoryId != null ? String(data.categoryId) : null,
    taxPercentage: Number(data.taxPercentage ?? 0),
    hsn: data.hsn != null ? String(data.hsn) : null,
    status: String(data.status ?? 'active'),
    hiddenFromCatalog: Boolean(data.hiddenFromCatalog),
    gatcStampingPriceIds: Array.isArray(data.gatcStampingPriceIds)
      ? data.gatcStampingPriceIds.map(id => String(id ?? '').trim()).filter(Boolean)
      : [],
  };
}

function toOrderLine(product, quantity, finalRate, catalogBaseRate) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 0));
  const catalogRate = Number(catalogBaseRate ?? product.rate) || 0;
  const rate = Math.round(Number(finalRate) * 100) / 100;
  return {
    productId: product.productId,
    itemId: product.itemId,
    name: product.name,
    sku: product.sku,
    imageUrl: product.imageUrl,
    description: product.description,
    rate,
    catalogRate,
    unit: product.unit,
    quantity: qty,
    lineTotal: lineTotal(rate, qty),
    stockStatus: product.stockStatus,
    categoryName: product.categoryName,
    categoryId: product.categoryId,
    taxPercentage: product.taxPercentage,
    hsn: product.hsn,
  };
}

/**
 * @returns {{ lines: object[], priceChanges: object[] }}
 */
async function buildLinesFromInput(rawLines, { allowRateOverride = false } = {}) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new HttpsError('invalid-argument', 'Add at least one product.');
  }

  const gatcMap = await loadGatcStampingPriceMap();
  const merged = new Map();

  for (const row of rawLines) {
    const productId = String(row?.productId ?? '').trim();
    const quantity = Math.floor(Number(row?.quantity ?? 0));
    if (!productId || quantity < 1) {
      throw new HttpsError('invalid-argument', 'Each line needs a product and quantity ≥ 1.');
    }
    const gatcStampingPriceId = String(row?.gatcStampingPriceId ?? '').trim() || null;
    let baseOverride = null;
    if (allowRateOverride && row?.rate != null && row.rate !== '') {
      const parsed = Number(row.rate);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new HttpsError('invalid-argument', 'Each line rate must be a number ≥ 0.');
      }
      baseOverride = Math.round(parsed * 100) / 100;
    }

    // Tentative merge key uses override or placeholder; refined after product load.
    const tentativeBase = baseOverride != null ? baseOverride : '__catalog__';
    const key = mergeKeyForLine(productId, gatcStampingPriceId, tentativeBase);
    const prev = merged.get(key) || {
      productId,
      quantity: 0,
      gatcStampingPriceId,
      baseOverride,
    };
    merged.set(key, {
      ...prev,
      quantity: prev.quantity + quantity,
      baseOverride: baseOverride != null ? baseOverride : prev.baseOverride,
    });
  }

  const lines = [];
  const priceChanges = [];
  for (const entry of merged.values()) {
    const product = await loadCatalogProduct(entry.productId);
    const isFreight = isFreightProductId(product?.id) || isFreightSku(product?.sku)
      || isFreightOrderLine({ productId: entry.productId });
    if (!product || product.status === 'inactive' || (product.hiddenFromCatalog && !isFreight)) {
      throw new HttpsError('failed-precondition', `Product unavailable: ${entry.productId}`);
    }
    if (product.stockStatus === 'out_of_stock'
      && !isSacHsn(product.hsn)
      && !isFreight) {
      throw new HttpsError(
        'failed-precondition',
        `${product.name} is out of stock and cannot be ordered.`,
      );
    }

    const gatc = resolveGatcFeeForProduct(product, entry.gatcStampingPriceId, gatcMap);
    const catalogBase = Math.round((Number(product.rate) || 0) * 100) / 100;
    const baseRate = entry.baseOverride != null ? entry.baseOverride : catalogBase;
    const finalRate = Math.round((baseRate + gatc.gatcFeePerUnit) * 100) / 100;

    const line = toOrderLine(product, entry.quantity, finalRate, catalogBase);
    line.baseRate = baseRate;
    line.gatcStampingPriceId = gatc.gatcStampingPriceId;
    line.gatcFeePerUnit = gatc.gatcFeePerUnit;
    line.gatcStampingRange = gatc.gatcStampingRange;
    if (gatc.gatcStampingPriceId) {
      const stampNote = `Stamping: ${gatc.gatcStampingRange}`;
      line.description = line.description
        ? `${line.description}\n${stampNote}`
        : stampNote;
    }
    lines.push(line);

    // Audit customizes base only — not the fixed GATC fee.
    if (Math.round(baseRate * 100) !== Math.round(catalogBase * 100)) {
      priceChanges.push({
        productId: line.productId,
        itemId: line.itemId,
        name: line.name,
        sku: line.sku,
        catalogRate: catalogBase,
        rate: baseRate,
        quantity: line.quantity,
      });
    }
  }
  return { lines, priceChanges };
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

function isSpareSegmentLine(line) {
  return classifyOrderLineSegment(line) === 'spare';
}

/**
 * Resolve salespersons required by non-empty segment groups.
 * Product may be null for dealer path (KAM optional).
 * Spare / software throw if missing.
 */
async function resolveSegmentSalespersons(groups, {
  productResolver,
}) {
  const bySegment = {};
  if (groups.product.length > 0) {
    bySegment.product = await productResolver();
  }
  if (groups.spare.length > 0) {
    try {
      bySegment.spare = await resolveSpareInchargeSalesperson();
    } catch (err) {
      throw new HttpsError('failed-precondition', err?.message || 'Spare Incharge salesperson missing.');
    }
  }
  if (groups.software.length > 0) {
    try {
      bySegment.software = await resolveCloudChargesSalesperson();
    } catch (err) {
      throw new HttpsError('failed-precondition', err?.message || 'Cloud Charges salesperson missing.');
    }
  }
  return bySegment;
}

async function createSegmentSalesOrders({
  secrets,
  orgId,
  zohoCustomerId,
  shippingResolved,
  remarks,
  groups,
  salespersonsBySegment,
  orderNumberBase,
  workflowBase,
  pricedLineMapper = line => line,
}) {
  const created = [];
  const segmentOrder = ORDER_SEGMENTS.filter(segment => groups[segment].length > 0);

  for (let i = 0; i < segmentOrder.length; i += 1) {
    const segment = segmentOrder[i];
    const segmentLines = groups[segment].map(pricedLineMapper);
    const subtotal = sumSubtotal(segmentLines);
    const salesperson = salespersonsBySegment[segment] || null;
    const orderNumber = segmentOrder.length === 1
      ? orderNumberBase
      : `${orderNumberBase}-${segment === 'spare' ? 'SP' : segment === 'software' ? 'SW' : 'P'}`;

    const so = await createSalesOrderFromDealerOrder(secrets, orgId, {
      id: orderNumber,
      orderNumber,
      zohoCustomerId,
      lines: segmentLines,
      subtotal,
      remarks: segmentOrder.length === 1
        ? remarks
        : (remarks
          ? `${remarks}\n[${segmentLabel(segment)} order type]`
          : `[${segmentLabel(segment)} order type]`),
      shippingAddressId: shippingResolved.shippingAddressId,
      shippingAddressInline: shippingResolved.useInline ? shippingResolved.address : null,
      salespersonId: salesperson?.id || null,
    });

    const salesOrderId = so.salesOrderId;
    const salesOrderNumber = so.salesOrderNumber;
    const status = so.status || 'draft';

    const workflowExtras = {
      ...workflowBase,
      yesOneCartReference: orderNumber,
      yesOneOrderSegment: segment,
      salesOrderCategory: segmentToInvoiceCategory(segment),
      categories: [segmentToInvoiceCategory(segment)],
      categoryAmounts: { [segmentToInvoiceCategory(segment)]: subtotal },
      shippingAddressId: shippingResolved.shippingAddressId || null,
      shippingAddress: shippingResolved.address?.formatted || null,
      ...yesOneGatcPersistFields(segmentLines),
      ...(salesperson ? {
        salespersonId: salesperson.id,
        salespersonName: salesperson.name,
      } : {}),
      ...(workflowBase.yesOneStage === 'ready_for_payment'
        ? { paymentAmount: subtotal }
        : {}),
    };

    try {
      await mirrorSalesOrderFromZoho(secrets, orgId, salesOrderId, { orderSegment: segment });
      await initYesOneSalesOrderWorkflow(salesOrderId, workflowExtras);
    } catch (mirrorErr) {
      console.warn(
        `Order ${orderNumber}: could not mirror SO ${salesOrderId}:`,
        mirrorErr?.message ?? mirrorErr,
      );
      try {
        await initYesOneSalesOrderWorkflow(salesOrderId, workflowExtras);
      } catch {
        // Mirror may have failed entirely; workflow seed best-effort.
      }
    }

    created.push({
      segment,
      segmentLabel: segmentLabel(segment),
      orderNumber,
      zohoSalesOrderId: salesOrderId,
      zohoSalesOrderNumber: salesOrderNumber,
      status,
      subtotal,
      itemCount: sumItemCount(segmentLines),
      salespersonId: salesperson?.id || null,
      salespersonName: salesperson?.name || null,
    });
  }

  return created;
}

/**
 * Place cart as one or more Zoho Inventory Draft sales orders (split by segment).
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
  const { lines } = await buildLinesFromInput(payload.lines);

  if (lines.some(isFreightOrderLine)) {
    throw new HttpsError(
      'permission-denied',
      'Freight charges can only be added by staff. Place the order without freight.',
    );
  }

  if (profile.canBuySpares === false) {
    const spare = lines.find(isSpareSegmentLine);
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

  const shippingSel = payload.shipping || {};
  let shippingResolved;
  try {
    shippingResolved = await resolveShippingAddressId(secrets, orgId, zohoCustomerId, {
      addressId: shippingSel.addressId || null,
      kind: shippingSel.kind || null,
      newAddress: shippingSel.newAddress || null,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('invalid-argument', err?.message || 'Invalid shipping address.');
  }

  const remarks = String(payload.remarks ?? payload.notes ?? '').trim().slice(0, 2000);
  const groups = groupLinesBySegment(lines);
  const orderNumber = await nextOrderNumber();

  let salesOrders;
  try {
    const salespersonsBySegment = await resolveSegmentSalespersons(groups, {
      productResolver: async () => resolveSalespersonForCustomer(zohoCustomerId),
    });

    salesOrders = await createSegmentSalesOrders({
      secrets,
      orgId,
      zohoCustomerId,
      shippingResolved,
      remarks,
      groups,
      salespersonsBySegment,
      orderNumberBase: orderNumber,
      workflowBase: {
        yesOneCreatedFromCart: true,
      },
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    const message = err?.message || 'Could not create Zoho sales order.';
    throw new HttpsError('failed-precondition', message);
  }

  const primary = salesOrders[0] || null;
  return {
    zohoSalesOrderId: primary?.zohoSalesOrderId || null,
    zohoSalesOrderNumber: primary?.zohoSalesOrderNumber || null,
    orderNumber: primary?.orderNumber || orderNumber,
    status: primary?.status || 'draft',
    subtotal,
    itemCount: sumItemCount(lines),
    dealerId,
    zohoCustomerId,
    dealerName: profile.dealerName,
    createdByUid: uid,
    createdByName: displayName(user),
    salesOrders,
  };
}

/**
 * Staff/ops create one or more Zoho Draft SOs for a Zoho dealer (split by segment),
 * with optional per-line rate overrides and initial YesOne stage.
 */
export async function createStaffSalesOrder(uid, role, payload = {}, secrets, orgId) {
  const user = await loadUser(uid);
  requireOrdersManage(user);
  if (!secrets) {
    throw new HttpsError('failed-precondition', 'Zoho credentials are not configured.');
  }

  const zohoCustomerId = String(payload.zohoCustomerId ?? '').trim();
  if (!zohoCustomerId) {
    throw new HttpsError('invalid-argument', 'Select a dealer.');
  }

  const customerSnap = await getFirestore().doc(`${CUSTOMERS}/${zohoCustomerId}`).get();
  if (!customerSnap.exists) {
    throw new HttpsError('not-found', 'Dealer not found in Zoho customers.');
  }

  const stageTarget = String(payload.stage ?? 'review').trim() === 'ready_for_payment'
    ? 'ready_for_payment'
    : 'review';

  const profile = await loadDealerProfile(null, zohoCustomerId);
  const { lines, priceChanges } = await buildLinesFromInput(payload.lines, {
    allowRateOverride: true,
  });

  if (profile.canBuySpares === false) {
    const spare = lines.find(isSpareSegmentLine);
    if (spare) {
      throw new HttpsError(
        'failed-precondition',
        'This dealer account is not allowed to order spare parts.',
      );
    }
  }

  const fullSA = isFullSuperAdmin(user);
  const actorForSegments = {
    role: user.role,
    spareIncharge: user.data?.spareIncharge === true,
  };
  for (const line of lines) {
    if (isFreightOrderLine(line)) continue;
    const segment = classifyOrderLineSegment(line);
    if (!segment) continue;
    if (!staffCanAddOrderSegment(actorForSegments, segment, { isFullSuperAdmin: fullSA })) {
      throw new HttpsError(
        'permission-denied',
        segment === 'spare'
          ? 'Only super admins and Spare Incharge can add spare parts to a sales order.'
          : actorForSegments.spareIncharge
            ? 'Spare Incharge can only add spare parts to a sales order.'
            : `You are not allowed to add ${segmentLabel(segment).toLowerCase()} items.`,
      );
    }
  }

  const groups = groupLinesBySegment(lines);
  const freightLinesOnly = lines.filter(isFreightOrderLine);
  if (freightLinesOnly.length > 0) {
    const host = groups.product.length > 0 ? 'product' : (groups.spare.length > 0 ? 'spare' : null);
    if (!host) {
      throw new HttpsError(
        'failed-precondition',
        'Freight charges can only be added to product or spare sales orders — not software.',
      );
    }
  }
  const subtotal = sumSubtotal(lines);
  if (profile.maxOrderLimit != null && profile.maxOrderLimit > 0 && subtotal > profile.maxOrderLimit) {
    throw new HttpsError(
      'failed-precondition',
      `Order total exceeds this dealer’s limit of ₹${profile.maxOrderLimit.toLocaleString('en-IN')}.`,
    );
  }

  const shippingSel = payload.shipping || {};
  let shippingResolved;
  try {
    shippingResolved = await resolveShippingAddressId(secrets, orgId, zohoCustomerId, {
      addressId: shippingSel.addressId || null,
      kind: shippingSel.kind || null,
      newAddress: shippingSel.newAddress || null,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('invalid-argument', err?.message || 'Invalid shipping address.');
  }

  const remarks = String(payload.remarks ?? payload.notes ?? '').trim().slice(0, 2000);
  const orderNumber = await nextOrderNumber();
  const at = nowIso();
  const actorName = displayName(user);

  let salesOrders;
  try {
    const salespersonsBySegment = await resolveSegmentSalespersons(groups, {
      productResolver: async () => {
        if (fullSA) {
          const kam = await resolveSalespersonForCustomer(zohoCustomerId);
          if (kam) return kam;
          const picked = await resolveSalespersonById(payload.salespersonId, {
            staffUid: uid,
            staffName: actorName,
          });
          if (picked) return picked;
          throw new HttpsError(
            'failed-precondition',
            'Select a Zoho salesperson for the product sales order (no KAM linked on this dealer).',
          );
        }
        const linked = await resolveSalespersonForStaff(uid);
        if (linked) return linked;
        throw new HttpsError(
          'failed-precondition',
          'Link at least one Zoho salesperson to your staff account before creating product orders.',
        );
      },
    });

    const priceAudit = priceChanges.map(change => ({
      ...change,
      changedAt: at,
      changedByUid: uid,
      changedByName: actorName,
    }));

    salesOrders = await createSegmentSalesOrders({
      secrets,
      orgId,
      zohoCustomerId,
      shippingResolved,
      remarks,
      groups,
      salespersonsBySegment,
      orderNumberBase: orderNumber,
      pricedLineMapper: ({ catalogRate: _c, ...line }) => line,
      workflowBase: {
        yesOneCreatedByStaff: true,
        yesOneCreatedFromCart: false,
        yesOneCreatedByUid: uid,
        yesOneCreatedByName: actorName,
        yesOnePriceCustomized: priceAudit.length > 0,
        yesOnePriceChanges: priceAudit,
        ...(stageTarget === 'ready_for_payment'
          ? {
            yesOneStage: 'ready_for_payment',
            readyForPaymentAt: at,
            readyForPaymentByUid: uid,
            readyForPaymentByName: actorName,
          }
          : {}),
      },
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('failed-precondition', err?.message || 'Could not create Zoho sales order.');
  }

  const primary = salesOrders[0] || null;
  return {
    zohoSalesOrderId: primary?.zohoSalesOrderId || null,
    zohoSalesOrderNumber: primary?.zohoSalesOrderNumber || null,
    orderNumber: primary?.orderNumber || orderNumber,
    status: primary?.status || 'draft',
    yesOneStage: stageTarget,
    subtotal,
    itemCount: sumItemCount(lines),
    zohoCustomerId,
    dealerName: profile.dealerName,
    priceCustomized: priceChanges.length > 0,
    createdByUid: uid,
    createdByName: actorName,
    salesOrders,
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
