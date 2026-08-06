import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { SPARE_PRICING_LIVE_SAVE_MS } from '../constants/sparePricing';

export const SPARE_PURCHASE_COSTS_COLLECTION = 'sparePurchaseCosts';
export { SPARE_PRICING_LIVE_SAVE_MS as SPARE_PURCHASE_COST_LIVE_SAVE_MS };

const PO_PAGE_SIZE = 100;
const PO_MAX_DOCS = 5000;

export type PurchaseItemCost = {
  amount: number;
  currencyCode: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  date: string | null;
  syncedAt: string | null;
};

export type SparePurchaseCostOverride = {
  productId: string;
  amount: number;
  currencyCode: string;
  updatedAt: string | null;
  updatedByUid: string | null;
};

function clampMoney(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10000) / 10000;
}

function normalizeCurrency(raw: unknown): string {
  const code = String(raw ?? '').trim().toUpperCase();
  return code || 'INR';
}

function poSortKey(date: string | null, syncedAt: string | null): string {
  // Lexicographic YYYY-MM-DD / ISO works for "latest wins".
  return `${date ?? ''}\t${syncedAt ?? ''}`;
}

function isNewerPo(
  nextDate: string | null,
  nextSyncedAt: string | null,
  prev: PurchaseItemCost | undefined,
): boolean {
  if (!prev) return true;
  return poSortKey(nextDate, nextSyncedAt) > poSortKey(prev.date, prev.syncedAt);
}

/**
 * Scan all mirrored purchase orders and keep the latest unit rate per Zoho item id.
 * Currency comes from the PO header (never converted).
 */
export async function loadLatestPurchaseCostsByItemId(): Promise<Map<string, PurchaseItemCost>> {
  const byItemId = new Map<string, PurchaseItemCost>();
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  let loaded = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const constraints: QueryConstraint[] = [
      orderBy('date', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(PO_PAGE_SIZE),
    ];
    const snap: QuerySnapshot<DocumentData> = await getDocs(
      query(collection(db, 'purchaseOrders'), ...constraints),
    );
    if (!snap.docs.length) break;

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const currencyCode = normalizeCurrency(data.currencyCode);
      const date = data.date ? String(data.date) : null;
      const syncedAt = data.syncedAt
        ? (typeof data.syncedAt === 'string'
          ? data.syncedAt
          : (data.syncedAt && typeof data.syncedAt === 'object' && 'toDate' in data.syncedAt
            ? (data.syncedAt as { toDate: () => Date }).toDate().toISOString()
            : null))
        : null;
      const purchaseOrderNumber = String(data.purchaseOrderNumber ?? docSnap.id);
      const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];

      for (const raw of lineItems) {
        if (!raw || typeof raw !== 'object') continue;
        const line = raw as Record<string, unknown>;
        const itemId = String(line.itemId ?? '').trim();
        if (!itemId) continue;
        const amount = clampMoney(line.rate);
        const prev = byItemId.get(itemId);
        if (!isNewerPo(date, syncedAt, prev)) continue;
        byItemId.set(itemId, {
          amount,
          currencyCode,
          purchaseOrderId: docSnap.id,
          purchaseOrderNumber,
          date,
          syncedAt,
        });
      }
    }

    loaded += snap.docs.length;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.docs.length < PO_PAGE_SIZE || loaded >= PO_MAX_DOCS) break;
  }

  return byItemId;
}

export function normalizeSparePurchaseCostOverride(
  productId: string,
  raw: unknown,
): SparePurchaseCostOverride {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    productId,
    amount: clampMoney(data.amount ?? data.purchaseCost ?? data.rate),
    currencyCode: normalizeCurrency(data.currencyCode ?? data.currency),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    updatedByUid: typeof data.updatedByUid === 'string' ? data.updatedByUid : null,
  };
}

export async function loadSparePurchaseCostOverrides(): Promise<Map<string, SparePurchaseCostOverride>> {
  const snap = await getDocs(collection(db, SPARE_PURCHASE_COSTS_COLLECTION));
  const map = new Map<string, SparePurchaseCostOverride>();
  for (const docSnap of snap.docs) {
    map.set(docSnap.id, normalizeSparePurchaseCostOverride(docSnap.id, docSnap.data()));
  }
  return map;
}

export async function saveSparePurchaseCostOverride(
  productId: string,
  amount: number,
  currencyCode: string,
  updatedByUid: string | null,
): Promise<SparePurchaseCostOverride> {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');
  const payload: SparePurchaseCostOverride = {
    productId: id,
    amount: clampMoney(amount),
    currencyCode: normalizeCurrency(currencyCode),
    updatedAt: new Date().toISOString(),
    updatedByUid: updatedByUid?.trim() || null,
  };
  await setDoc(doc(db, SPARE_PURCHASE_COSTS_COLLECTION, id), payload, { merge: true });
  return payload;
}

export function currencyPrefix(currencyCode: string): string {
  const code = normalizeCurrency(currencyCode);
  if (code === 'USD') return '$';
  if (code === 'INR') return '₹';
  return `${code} `;
}

export type ResolvedPurchaseCost = {
  amount: number;
  currencyCode: string;
  source: 'override' | 'purchase_order' | 'none';
};

export function resolvePurchaseCost(
  _productId: string,
  override: SparePurchaseCostOverride | undefined,
  fromPo: PurchaseItemCost | undefined,
): ResolvedPurchaseCost {
  if (override) {
    return {
      amount: override.amount,
      currencyCode: override.currencyCode,
      source: 'override',
    };
  }
  if (fromPo) {
    return {
      amount: fromPo.amount,
      currencyCode: fromPo.currencyCode,
      source: 'purchase_order',
    };
  }
  return { amount: 0, currencyCode: 'INR', source: 'none' };
}
