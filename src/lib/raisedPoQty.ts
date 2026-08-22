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
  parsePurchaseOrderBl,
  parsePurchaseOrderTracking,
  purchaseOrderVisibleInPortal,
  type PurchaseOrderBl,
} from './admin-purchase-orders';
import { isReceivedBillStatus } from './admin-goods-receipts';

export type CatalogOnOrderShipment = {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  quantity: number;
  eta: string | null;
  etaPort: string | null;
  etd: string | null;
  etdPort: string | null;
  vesselName: string;
  containerNumber: string;
  bl: PurchaseOrderBl | null;
};

/** ETD (or vessel + ETA) means the cargo has sailed and can be tracked. */
export function catalogShipmentHasTracking(row: CatalogOnOrderShipment): boolean {
  const etd = String(row.etd ?? '').trim();
  if (etd) return true;
  const eta = String(row.eta ?? '').trim();
  const vessel = String(row.vesselName ?? '').trim();
  return Boolean(vessel && eta);
}

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

function addShipment(
  byItemId: Map<string, CatalogOnOrderShipment[]>,
  itemId: string,
  row: CatalogOnOrderShipment,
): void {
  const list = byItemId.get(itemId) ?? [];
  const existing = list.find(s => s.purchaseOrderId === row.purchaseOrderId);
  if (existing) {
    existing.quantity += row.quantity;
    return;
  }
  list.push(row);
  byItemId.set(itemId, list);
}

function addPoLineQty(
  byItemId: Map<string, number>,
  shipmentsByItemId: Map<string, CatalogOnOrderShipment[]>,
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
  const bl = parsePurchaseOrderBl(data);
  const tracking = parsePurchaseOrderTracking(data);
  for (const raw of lines) {
    const line = lineQty(raw);
    if (!line) continue;
    byItemId.set(line.itemId, (byItemId.get(line.itemId) ?? 0) + line.quantity);
    addShipment(shipmentsByItemId, line.itemId, {
      purchaseOrderId: poId,
      purchaseOrderNumber: String(data.purchaseOrderNumber ?? poId).trim() || poId,
      quantity: line.quantity,
      eta: tracking.arrivalDate,
      etaPort: tracking.etaPort || bl?.portOfDischarge || 'Cochin',
      etd: tracking.sailingDate,
      etdPort: tracking.etdPort || bl?.portOfLoading || null,
      vesselName: bl?.vesselName || '',
      containerNumber: bl?.containerNumber || '',
      bl,
    });
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

let cache: {
  at: number;
  map: Map<string, number>;
  shipments: Map<string, CatalogOnOrderShipment[]>;
} | null = null;
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
    .then(result => {
      cache = { at: Date.now(), map: result.map, shipments: result.shipments };
      inflight = null;
      return result.map;
    })
    .catch(err => {
      inflight = null;
      throw err;
    });

  return inflight;
}

async function scanPortalPurchaseOrders(): Promise<{
  poQty: Map<string, number>;
  shipments: Map<string, CatalogOnOrderShipment[]>;
  poNumbers: Set<string>;
}> {
  const poQty = new Map<string, number>();
  const shipments = new Map<string, CatalogOnOrderShipment[]>();
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
      addPoLineQty(poQty, shipments, poNumbers, docSnap.data(), docSnap.id);
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
      addPoLineQty(poQty, shipments, poNumbers, docSnap.data(), docSnap.id);
    }
  }

  return { poQty, shipments, poNumbers };
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

function sortShipments(rows: CatalogOnOrderShipment[]): CatalogOnOrderShipment[] {
  return [...rows].sort((a, b) => {
    const eta = (a.eta || '9999-12-31').localeCompare(b.eta || '9999-12-31');
    if (eta) return eta;
    return a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber);
  });
}

async function scanRaisedPoQty(): Promise<{
  map: Map<string, number>;
  shipments: Map<string, CatalogOnOrderShipment[]>;
}> {
  const { poQty, shipments, poNumbers } = await scanPortalPurchaseOrders();
  let receivedQty = new Map<string, number>();
  try {
    receivedQty = await scanReceivedGrQty(poNumbers);
  } catch {
    receivedQty = new Map();
  }
  const map = subtractReceived(poQty, receivedQty);
  const nextShipments = new Map<string, CatalogOnOrderShipment[]>();
  for (const [itemId, rows] of shipments) {
    if (!map.has(itemId)) continue;
    nextShipments.set(itemId, sortShipments(rows));
  }
  return { map, shipments: nextShipments };
}

/** Open POs still on the water for this catalog item (ETA / vessel / live map). */
export async function loadOnOrderShipmentsForItem(
  itemId: string,
): Promise<CatalogOnOrderShipment[]> {
  const id = itemId.trim();
  if (!id) return [];
  await loadRaisedPoQtyByItemId();
  return cache?.shipments.get(id) ?? [];
}
