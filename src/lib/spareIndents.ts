import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { PURCHASE_ORDER_KEEP_AFTER_DATE } from './admin-purchase-orders';

export const SPARE_INDENTS_COLLECTION = 'spareIndents';

export type SpareIndentStatus = 'open' | 'converted';

export type SpareIndentSupplier = {
  vendorId: string | null;
  vendorName: string | null;
  purchaseOrderId: string | null;
  rate: number | null;
  currencyCode: string | null;
};

export type SpareIndent = {
  id: string;
  catalogProductId: string;
  sku: string | null;
  name: string;
  imageUrl: string | null;
  qty: number;
  vendorId: string | null;
  vendorName: string | null;
  lastPurchaseOrderId: string | null;
  lastPurchaseRate: number | null;
  lastPurchaseCurrency: string | null;
  status: SpareIndentStatus;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
  updatedAt: string | null;
};

export type SpareIndentPoPrefill = {
  indentIds: string[];
  vendorId: string | null;
  lines: Array<{
    productId: string;
    quantity: number;
    name: string;
    rate: number | null;
  }>;
};

const PAGE_SIZE = 40;
const MAX_SCAN_DOCS = 800;

function nowIso(): string {
  return new Date().toISOString();
}

function clampQty(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 0;
  return n;
}

function asTrimmed(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  return value || null;
}

function mapIndent(id: string, data: DocumentData): SpareIndent {
  const status = data.status === 'converted' ? 'converted' : 'open';
  return {
    id,
    catalogProductId: String(data.catalogProductId ?? ''),
    sku: asTrimmed(data.sku),
    name: String(data.name ?? '').trim() || 'Spare',
    imageUrl: asTrimmed(data.imageUrl),
    qty: clampQty(data.qty) || 0,
    vendorId: asTrimmed(data.vendorId),
    vendorName: asTrimmed(data.vendorName),
    lastPurchaseOrderId: asTrimmed(data.lastPurchaseOrderId),
    lastPurchaseRate: Number.isFinite(Number(data.lastPurchaseRate))
      ? Number(data.lastPurchaseRate)
      : null,
    lastPurchaseCurrency: asTrimmed(data.lastPurchaseCurrency),
    status,
    purchaseOrderId: asTrimmed(data.purchaseOrderId),
    purchaseOrderNumber: asTrimmed(data.purchaseOrderNumber),
    createdAt: String(data.createdAt ?? ''),
    createdByUid: String(data.createdByUid ?? ''),
    createdByName: String(data.createdByName ?? '').trim() || '—',
    updatedAt: asTrimmed(data.updatedAt),
  };
}

function lineMatchesItem(raw: unknown, itemId: string): { rate: number | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const line = raw as Record<string, unknown>;
  const id = String(line.itemId ?? line.productId ?? '').trim();
  if (id !== itemId) return null;
  const rate = Number(line.rate);
  return { rate: Number.isFinite(rate) ? rate : null };
}

async function scanPurchasesForItem(
  collectionName: 'purchaseOrders' | 'goodsReceipts',
  itemId: string,
): Promise<SpareIndentSupplier | null> {
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  let loaded = 0;
  while (loaded < MAX_SCAN_DOCS) {
    const constraints: QueryConstraint[] = collectionName === 'purchaseOrders'
      ? [
          where('date', '>=', PURCHASE_ORDER_KEEP_AFTER_DATE),
          orderBy('date', 'desc'),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(PAGE_SIZE),
        ]
      : [
          orderBy('date', 'desc'),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(PAGE_SIZE),
        ];
    const snap = await getDocs(query(collection(db, collectionName), ...constraints));
    if (!snap.docs.length) break;
    for (const docSnap of snap.docs) {
      loaded += 1;
      const data = docSnap.data();
      const lines = Array.isArray(data.lineItems) ? data.lineItems : [];
      for (const line of lines) {
        const match = lineMatchesItem(line, itemId);
        if (!match) continue;
        return {
          vendorId: asTrimmed(data.vendorId),
          vendorName: asTrimmed(data.vendorName),
          purchaseOrderId: collectionName === 'purchaseOrders' ? docSnap.id : null,
          rate: match.rate,
          currencyCode: asTrimmed(data.currencyCode),
        };
      }
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE_SIZE) break;
  }
  return null;
}

/** Last PO vendor, then last goods-receipt vendor. */
export async function loadLatestSupplierForItemId(itemId: string): Promise<SpareIndentSupplier | null> {
  const id = itemId.trim();
  if (!id) return null;
  try {
    const fromPo = await scanPurchasesForItem('purchaseOrders', id);
    if (fromPo) return fromPo;
  } catch {
    // Fall through to goods receipts if PO scan is denied.
  }
  try {
    return await scanPurchasesForItem('goodsReceipts', id);
  } catch {
    return null;
  }
}

export async function listSpareIndents(): Promise<SpareIndent[]> {
  const snap = await getDocs(collection(db, SPARE_INDENTS_COLLECTION));
  return snap.docs
    .map(row => mapIndent(row.id, row.data()))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listSpareIndentsForProduct(catalogProductId: string): Promise<SpareIndent[]> {
  const snap = await getDocs(
    query(
      collection(db, SPARE_INDENTS_COLLECTION),
      where('catalogProductId', '==', catalogProductId),
    ),
  );
  return snap.docs
    .map(row => mapIndent(row.id, row.data()))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function createSpareIndent(input: {
  catalogProductId: string;
  sku: string | null;
  name: string;
  imageUrl: string | null;
  qty: number;
  createdByUid: string;
  createdByName: string;
}): Promise<SpareIndent> {
  const qty = clampQty(input.qty);
  if (qty < 1) throw new Error('Enter how many spares to order.');
  const supplier = await loadLatestSupplierForItemId(input.catalogProductId);
  const createdAt = nowIso();
  const payload = {
    catalogProductId: input.catalogProductId,
    sku: input.sku,
    name: input.name.trim() || 'Spare',
    imageUrl: input.imageUrl,
    qty,
    vendorId: supplier?.vendorId ?? null,
    vendorName: supplier?.vendorName ?? null,
    lastPurchaseOrderId: supplier?.purchaseOrderId ?? null,
    lastPurchaseRate: supplier?.rate ?? null,
    lastPurchaseCurrency: supplier?.currencyCode ?? null,
    status: 'open' as const,
    purchaseOrderId: null,
    purchaseOrderNumber: null,
    createdAt,
    createdByUid: input.createdByUid,
    createdByName: input.createdByName.trim() || 'Staff',
    updatedAt: createdAt,
  };
  const ref = await addDoc(collection(db, SPARE_INDENTS_COLLECTION), payload);
  return mapIndent(ref.id, payload);
}

export async function updateSpareIndentQty(input: {
  id: string;
  qty: number;
  vendorName?: string | null;
  updatedByUid: string;
  updatedByName: string;
}): Promise<void> {
  const qty = clampQty(input.qty);
  if (qty < 1) throw new Error('Quantity must be at least 1.');
  const patch: Record<string, unknown> = {
    qty,
    updatedAt: nowIso(),
    updatedByUid: input.updatedByUid,
    updatedByName: input.updatedByName,
  };
  if (input.vendorName !== undefined) {
    const name = input.vendorName?.trim() || null;
    patch.vendorName = name;
  }
  await updateDoc(doc(db, SPARE_INDENTS_COLLECTION, input.id), patch);
}

export async function deleteSpareIndent(id: string): Promise<void> {
  await deleteDoc(doc(db, SPARE_INDENTS_COLLECTION, id));
}

export async function markSpareIndentsConverted(input: {
  indentIds: string[];
  purchaseOrderId: string;
  purchaseOrderNumber: string;
}): Promise<void> {
  const convertedAt = nowIso();
  await Promise.all(input.indentIds.map(id => (
    updateDoc(doc(db, SPARE_INDENTS_COLLECTION, id), {
      status: 'converted',
      purchaseOrderId: input.purchaseOrderId,
      purchaseOrderNumber: input.purchaseOrderNumber || null,
      updatedAt: convertedAt,
    })
  )));
}

export function spareIndentPoPrefill(rows: SpareIndent[]): SpareIndentPoPrefill {
  const open = rows.filter(row => row.status === 'open' && row.qty > 0);
  const vendorId = open.find(row => row.vendorId)?.vendorId ?? null;
  const byProduct = new Map<string, { quantity: number; name: string; rate: number | null }>();
  for (const row of open) {
    const prev = byProduct.get(row.catalogProductId);
    if (prev) {
      prev.quantity += row.qty;
      if (prev.rate == null && row.lastPurchaseRate != null) prev.rate = row.lastPurchaseRate;
      continue;
    }
    byProduct.set(row.catalogProductId, {
      quantity: row.qty,
      name: row.name,
      rate: row.lastPurchaseRate,
    });
  }
  return {
    indentIds: open.map(row => row.id),
    vendorId,
    lines: [...byProduct.entries()].map(([productId, line]) => ({
      productId,
      quantity: line.quantity,
      name: line.name,
      rate: line.rate,
    })),
  };
}
