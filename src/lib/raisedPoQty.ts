import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  PORTAL_PURCHASE_ORDER_STATUS,
  PURCHASE_ORDER_KEEP_AFTER_DATE,
  PURCHASE_ORDER_KEEP_NUMBERS,
  purchaseOrderVisibleInPortal,
} from './admin-purchase-orders';
import { isReceivedBillStatus } from './admin-goods-receipts';

const PO_PAGE_SIZE = 100;
const PO_MAX_DOCS = 5000;
const GR_PAGE_SIZE = 100;
const GR_MAX_DOCS = 5000;
const CACHE_MS = 60_000;

function normalizePoNumber(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function hasDateValue(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'object' && 'toDate' in (value as object)) return true;
  return true;
}

function lineQty(raw: unknown): { itemId: string; lineId: string; quantity: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const line = raw as Record<string, unknown>;
  const itemId = String(line.itemId ?? line.productId ?? '').trim();
  if (!itemId) return null;
  const quantity = Number(line.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return {
    itemId,
    lineId: String(line.id ?? '').trim(),
    quantity,
  };
}

function isYesOnePurchaseOrder(data: DocumentData, poId: string): boolean {
  const status = String(data.status ?? '').trim().toLowerCase();
  if (status !== PORTAL_PURCHASE_ORDER_STATUS) return false;
  return purchaseOrderVisibleInPortal({
    date: data.date ? String(data.date) : null,
    purchaseOrderNumber: String(data.purchaseOrderNumber ?? poId),
  });
}

function addPoLineQty(
  byItemId: Map<string, number>,
  poNumbers: Set<string>,
  data: DocumentData,
  poId: string,
): void {
  if (!isYesOnePurchaseOrder(data, poId)) return;
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

function isGoodsReceiptMarkedReceived(data: DocumentData): boolean {
  if (hasDateValue(data.opsReceivedAt) || hasDateValue(data.receivedDate)) return true;
  if (isReceivedBillStatus(typeof data.status === 'string' ? data.status : null)) return true;
  const check = data.receiveCheck;
  if (check && typeof check === 'object') {
    const row = check as Record<string, unknown>;
    if (hasDateValue(row.postedAt) || row.hasPostedSnapshot === true) return true;
  }
  return false;
}

function grLinkedToYesOnePo(data: DocumentData, poNumbers: Set<string>): boolean {
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

function receiveCheckedQty(data: DocumentData, lineId: string): number {
  if (!lineId) return 0;
  const check = data.receiveCheck;
  if (!check || typeof check !== 'object') return 0;
  const row = check as Record<string, unknown>;
  const lines = row.lines;
  if (lines && typeof lines === 'object') {
    const entry = (lines as Record<string, unknown>)[lineId];
    if (entry && typeof entry === 'object') {
      const qty = Number((entry as Record<string, unknown>).receivedQty);
      if (Number.isFinite(qty) && qty > 0) return qty;
    }
  }
  const byLineId = row.byLineId;
  if (byLineId && typeof byLineId === 'object') {
    const qty = Number((byLineId as Record<string, unknown>)[lineId]);
    if (Number.isFinite(qty) && qty > 0) return qty;
  }
  return 0;
}

function addReceivedGrQty(
  byItemId: Map<string, number>,
  poNumbers: Set<string>,
  data: DocumentData,
): void {
  if (!isGoodsReceiptMarkedReceived(data)) return;
  if (!grLinkedToYesOnePo(data, poNumbers)) return;
  const lines = Array.isArray(data.lineItems) ? data.lineItems : [];
  for (const raw of lines) {
    const line = lineQty(raw);
    if (!line) continue;
    const checked = receiveCheckedQty(data, line.lineId);
    const qty = checked > 0 ? checked : line.quantity;
    byItemId.set(line.itemId, (byItemId.get(line.itemId) ?? 0) + qty);
  }
}

let cache: { at: number; map: Map<string, number> } | null = null;
let inflight: Promise<Map<string, number>> | null = null;

/**
 * Sum line qty from YesOne Purchase order list docs (left-nav drafts),
 * minus qty already marked received on a linked goods receipt.
 */
export async function loadRaisedPoQtyByItemId(
  options?: { force?: boolean },
): Promise<Map<string, number>> {
  const now = Date.now();
  if (!options?.force && cache && now - cache.at < CACHE_MS) {
    return cache.map;
  }
  if (inflight) return inflight;

  inflight = scanRaisedPoQty()
    .then(map => {
      cache = { at: Date.now(), map };
      inflight = null;
      return map;
    })
    .catch(err => {
      inflight = null;
      throw err;
    });

  return inflight;
}

async function scanPortalPurchaseOrders(): Promise<{
  poQty: Map<string, number>;
  poNumbers: Set<string>;
}> {
  const poQty = new Map<string, number>();
  const poNumbers = new Set<string>();
  const seen = new Set<string>();
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  let loaded = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const constraints: QueryConstraint[] = [
      where('status', '==', PORTAL_PURCHASE_ORDER_STATUS),
      where('date', '>=', PURCHASE_ORDER_KEEP_AFTER_DATE),
      orderBy('date', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(PO_PAGE_SIZE),
    ];
    const snap = await getDocs(query(collection(db, 'purchaseOrders'), ...constraints));
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
    const keptSnap = await getDocs(
      query(
        collection(db, 'purchaseOrders'),
        where('purchaseOrderNumber', 'in', [...PURCHASE_ORDER_KEEP_NUMBERS]),
      ),
    );
    for (const docSnap of keptSnap.docs) {
      if (seen.has(docSnap.id)) continue;
      addPoLineQty(poQty, poNumbers, docSnap.data(), docSnap.id);
    }
  }

  return { poQty, poNumbers };
}

async function scanReceivedGrQty(poNumbers: Set<string>): Promise<Map<string, number>> {
  const byItemId = new Map<string, number>();
  if (poNumbers.size === 0) return byItemId;

  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  let loaded = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const constraints: QueryConstraint[] = [
      where('date', '>=', PURCHASE_ORDER_KEEP_AFTER_DATE),
      orderBy('date', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(GR_PAGE_SIZE),
    ];
    const snap = await getDocs(query(collection(db, 'goodsReceipts'), ...constraints));
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

function subtractReceived(
  poQty: Map<string, number>,
  receivedQty: Map<string, number>,
): Map<string, number> {
  const next = new Map<string, number>();
  for (const [itemId, qty] of poQty) {
    const remaining = qty - (receivedQty.get(itemId) ?? 0);
    if (remaining > 0) next.set(itemId, remaining);
  }
  return next;
}

async function scanRaisedPoQty(): Promise<Map<string, number>> {
  const { poQty, poNumbers } = await scanPortalPurchaseOrders();
  let receivedQty = new Map<string, number>();
  try {
    receivedQty = await scanReceivedGrQty(poNumbers);
  } catch {
    receivedQty = new Map();
  }
  return subtractReceived(poQty, receivedQty);
}
