import { getFirestore } from 'firebase-admin/firestore';

export const RAISED_PO_QTY_COLLECTION = 'catalogMeta';
export const RAISED_PO_QTY_DOC = 'raisedPoQty';

const PORTAL_PURCHASE_ORDER_STATUS = 'draft';
const PURCHASE_ORDER_KEEP_AFTER_DATE = '2026-04-01';
const PURCHASE_ORDER_KEEP_NUMBERS = ['PO-00279', 'PO-00283'];
const PURCHASE_ORDER_HIDE_NUMBERS = ['PO-00307'];
const PO_PAGE_SIZE = 100;
const PO_MAX_DOCS = 5000;
const GR_PAGE_SIZE = 100;
const GR_MAX_DOCS = 5000;

function normalizePoNumber(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isKeptPurchaseOrderNumber(value) {
  return PURCHASE_ORDER_KEEP_NUMBERS.includes(normalizePoNumber(value));
}

function isHiddenPurchaseOrderNumber(value) {
  return PURCHASE_ORDER_HIDE_NUMBERS.includes(normalizePoNumber(value));
}

function purchaseOrderVisibleInPortal(row) {
  if (isHiddenPurchaseOrderNumber(row.purchaseOrderNumber)) return false;
  if (isKeptPurchaseOrderNumber(row.purchaseOrderNumber)) return true;
  return String(row.date ?? '').trim().slice(0, 10) >= PURCHASE_ORDER_KEEP_AFTER_DATE;
}

function hasDateValue(value) {
  if (value == null || value === false) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'object' && typeof value.toDate === 'function') return true;
  return true;
}

function isReceivedBillStatus(status) {
  const key = String(status ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  return key === 'open' || key === 'paid' || key === 'partially_paid' || key === 'overdue';
}

function lineQty(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const itemId = String(raw.itemId ?? raw.productId ?? '').trim();
  if (!itemId) return null;
  const quantity = Number(raw.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return {
    itemId,
    lineId: String(raw.id ?? '').trim(),
    quantity,
  };
}

function isPortalPurchaseOrder(data, poId) {
  const status = String(data.status ?? '').trim().toLowerCase();
  if (status !== PORTAL_PURCHASE_ORDER_STATUS) return false;
  return purchaseOrderVisibleInPortal({
    date: data.date ? String(data.date) : null,
    purchaseOrderNumber: String(data.purchaseOrderNumber ?? poId),
  });
}

function addPoLineQty(byItemId, poNumbers, data, poId) {
  if (!isPortalPurchaseOrder(data, poId)) return;
  const poNumber = normalizePoNumber(data.purchaseOrderNumber ?? poId);
  if (poNumber) poNumbers.add(poNumber);
  const poRef = normalizePoNumber(data.referenceNumber);
  if (poRef) poNumbers.add(poRef);
  const lines = Array.isArray(data.lineItems) ? data.lineItems : [];
  for (const raw of lines) {
    const line = lineQty(raw);
    if (!line) continue;
    byItemId.set(line.itemId, (byItemId.get(line.itemId) ?? 0) + line.quantity);
  }
}

function isGoodsReceiptMarkedReceived(data) {
  if (hasDateValue(data.opsReceivedAt) || hasDateValue(data.receivedDate)) return true;
  if (isReceivedBillStatus(typeof data.status === 'string' ? data.status : null)) return true;
  const check = data.receiveCheck;
  if (check && typeof check === 'object') {
    if (hasDateValue(check.postedAt) || check.hasPostedSnapshot === true) return true;
  }
  return false;
}

function grLinkedToPortalPo(data, poNumbers) {
  if (poNumbers.size === 0) return false;
  const refs = [
    normalizePoNumber(data.referenceNumber),
    normalizePoNumber(data.purchaseOrderNumber),
    normalizePoNumber(data.poNumber),
  ].filter(Boolean);
  for (const ref of refs) {
    if (poNumbers.has(ref)) return true;
    for (const poNumber of poNumbers) {
      if (ref.includes(poNumber)) return true;
    }
  }
  return false;
}

function receiveCheckedQty(data, lineId) {
  if (!lineId) return 0;
  const check = data.receiveCheck;
  if (!check || typeof check !== 'object') return 0;
  const lines = check.lines;
  if (lines && typeof lines === 'object') {
    const entry = lines[lineId];
    if (entry && typeof entry === 'object') {
      const qty = Number(entry.receivedQty);
      if (Number.isFinite(qty) && qty > 0) return qty;
    }
  }
  const byLineId = check.byLineId;
  if (byLineId && typeof byLineId === 'object') {
    const qty = Number(byLineId[lineId]);
    if (Number.isFinite(qty) && qty > 0) return qty;
  }
  return 0;
}

function addReceivedGrQty(byItemId, poNumbers, data) {
  if (!isGoodsReceiptMarkedReceived(data)) return;
  if (!grLinkedToPortalPo(data, poNumbers)) return;
  const lines = Array.isArray(data.lineItems) ? data.lineItems : [];
  for (const raw of lines) {
    const line = lineQty(raw);
    if (!line) continue;
    const checked = receiveCheckedQty(data, line.lineId);
    const qty = checked > 0 ? checked : line.quantity;
    byItemId.set(line.itemId, (byItemId.get(line.itemId) ?? 0) + qty);
  }
}

function subtractReceived(poQty, receivedQty) {
  const next = {};
  for (const [itemId, qty] of poQty) {
    const remaining = qty - (receivedQty.get(itemId) ?? 0);
    if (remaining > 0) next[itemId] = remaining;
  }
  return next;
}

async function scanPortalPurchaseOrders(db) {
  const poQty = new Map();
  const poNumbers = new Set();
  const seen = new Set();
  let cursor = null;
  let loaded = 0;

  while (true) {
    let query = db.collection('purchaseOrders')
      .where('status', '==', PORTAL_PURCHASE_ORDER_STATUS)
      .where('date', '>=', PURCHASE_ORDER_KEEP_AFTER_DATE)
      .orderBy('date', 'desc')
      .limit(PO_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (!snap.docs.length) break;

    for (const docSnap of snap.docs) {
      seen.add(docSnap.id);
      addPoLineQty(poQty, poNumbers, docSnap.data(), docSnap.id);
    }

    loaded += snap.docs.length;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.docs.length < PO_PAGE_SIZE || loaded >= PO_MAX_DOCS) break;
  }

  if (PURCHASE_ORDER_KEEP_NUMBERS.length) {
    const keptSnap = await db.collection('purchaseOrders')
      .where('purchaseOrderNumber', 'in', [...PURCHASE_ORDER_KEEP_NUMBERS])
      .get();
    for (const docSnap of keptSnap.docs) {
      if (seen.has(docSnap.id)) continue;
      addPoLineQty(poQty, poNumbers, docSnap.data(), docSnap.id);
    }
  }

  return { poQty, poNumbers };
}

async function scanReceivedGrQty(db, poNumbers) {
  const byItemId = new Map();
  if (poNumbers.size === 0) return byItemId;

  let cursor = null;
  let loaded = 0;

  while (true) {
    let query = db.collection('goodsReceipts')
      .where('date', '>=', PURCHASE_ORDER_KEEP_AFTER_DATE)
      .orderBy('date', 'desc')
      .limit(GR_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (!snap.docs.length) break;

    for (const docSnap of snap.docs) {
      addReceivedGrQty(byItemId, poNumbers, docSnap.data());
    }

    loaded += snap.docs.length;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.docs.length < GR_PAGE_SIZE || loaded >= GR_MAX_DOCS) break;
  }

  return byItemId;
}

export async function writeRaisedPoQtyMirror() {
  const db = getFirestore();
  const { poQty, poNumbers } = await scanPortalPurchaseOrders(db);
  let receivedQty = new Map();
  try {
    receivedQty = await scanReceivedGrQty(db, poNumbers);
  } catch (err) {
    console.error('Raised PO qty: goods receipts scan failed:', err?.message || err);
  }
  const byProductId = subtractReceived(poQty, receivedQty);
  const updatedAt = new Date().toISOString();
  await db.collection(RAISED_PO_QTY_COLLECTION).doc(RAISED_PO_QTY_DOC).set({
    byProductId,
    updatedAt,
    productCount: Object.keys(byProductId).length,
  });
  return { updatedAt, productCount: Object.keys(byProductId).length };
}
