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

/** Latest PO line + highest INR/USD lines for one catalog item. */
export type PurchaseItemCostSet = {
  latest: PurchaseItemCost | null;
  highestInr: PurchaseItemCost | null;
  highestUsd: PurchaseItemCost | null;
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

function readPoSyncedAt(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw !== null && 'toDate' in raw) {
    try {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function isNewerPo(
  nextDate: string | null,
  nextSyncedAt: string | null,
  prev: PurchaseItemCost | null | undefined,
): boolean {
  if (!prev) return true;
  return poSortKey(nextDate, nextSyncedAt) > poSortKey(prev.date, prev.syncedAt);
}

function isHigherAmount(
  next: PurchaseItemCost,
  prev: PurchaseItemCost | null | undefined,
): boolean {
  if (!prev) return true;
  if (next.amount !== prev.amount) return next.amount > prev.amount;
  // Tie-break: newer PO preferred when amounts match.
  return isNewerPo(next.date, next.syncedAt, prev);
}

export function purchaseCostToInr(cost: Pick<PurchaseItemCost, 'amount' | 'currencyCode'>, usdToInrRate: number): number {
  const amount = Number(cost.amount) || 0;
  if (normalizeCurrency(cost.currencyCode) === 'USD') {
    return amount * (Number(usdToInrRate) || 0);
  }
  return amount;
}

export function pickHighestPurchaseCost(
  set: PurchaseItemCostSet | undefined,
  usdToInrRate: number,
): PurchaseItemCost | null {
  if (!set) return null;
  const candidates = [set.highestInr, set.highestUsd].filter(
    (row): row is PurchaseItemCost => Boolean(row),
  );
  if (!candidates.length) return set.latest;
  return candidates.reduce((best, row) => (
    purchaseCostToInr(row, usdToInrRate) > purchaseCostToInr(best, usdToInrRate) ? row : best
  ));
}

/**
 * Scan mirrored purchase orders and keep, per Zoho item id:
 * - latest line (by PO date / syncedAt)
 * - highest INR line amount
 * - highest USD line amount
 */
export async function loadLatestPurchaseCostsByItemId(): Promise<Map<string, PurchaseItemCostSet>> {
  const byItemId = new Map<string, PurchaseItemCostSet>();
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
      const syncedAt = readPoSyncedAt(data.syncedAt);
      const purchaseOrderNumber = String(data.purchaseOrderNumber ?? docSnap.id);
      const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];

      for (const raw of lineItems) {
        if (!raw || typeof raw !== 'object') continue;
        const line = raw as Record<string, unknown>;
        const itemId = String(line.itemId ?? '').trim();
        if (!itemId) continue;
        const amount = clampMoney(line.rate);
        const entry: PurchaseItemCost = {
          amount,
          currencyCode,
          purchaseOrderId: docSnap.id,
          purchaseOrderNumber,
          date,
          syncedAt,
        };

        const prev = byItemId.get(itemId) ?? {
          latest: null,
          highestInr: null,
          highestUsd: null,
        };

        if (isNewerPo(date, syncedAt, prev.latest)) {
          prev.latest = entry;
        }
        if (currencyCode === 'USD') {
          if (isHigherAmount(entry, prev.highestUsd)) prev.highestUsd = entry;
        } else if (isHigherAmount(entry, prev.highestInr)) {
          prev.highestInr = entry;
        }

        byItemId.set(itemId, prev);
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
  /** True when PO-derived cost is the highest historical buy, not the latest PO rate. */
  notFromLatest: boolean;
  latestAmount: number | null;
  latestCurrencyCode: string | null;
  purchaseOrderNumber: string | null;
};

export function resolvePurchaseCost(
  _productId: string,
  override: SparePurchaseCostOverride | undefined,
  fromPo: PurchaseItemCostSet | undefined,
  usdToInrRate = 0,
): ResolvedPurchaseCost {
  if (override) {
    const amount = Number(override.amount) || 0;
    return {
      amount,
      // Zero purchase defaults to USD ($0) so landing stays clear of INR markup path.
      currencyCode: amount <= 0 ? 'USD' : override.currencyCode,
      source: 'override',
      notFromLatest: false,
      latestAmount: fromPo?.latest?.amount ?? null,
      latestCurrencyCode: fromPo?.latest?.currencyCode ?? null,
      purchaseOrderNumber: null,
    };
  }

  const highest = pickHighestPurchaseCost(fromPo, usdToInrRate);
  if (highest) {
    const latest = fromPo?.latest ?? null;
    const amount = Number(highest.amount) || 0;
    const notFromLatest = !latest
      || highest.amount !== latest.amount
      || normalizeCurrency(highest.currencyCode) !== normalizeCurrency(latest.currencyCode);
    return {
      amount,
      currencyCode: amount <= 0 ? 'USD' : highest.currencyCode,
      source: 'purchase_order',
      notFromLatest,
      latestAmount: latest?.amount ?? null,
      latestCurrencyCode: latest?.currencyCode ?? null,
      purchaseOrderNumber: highest.purchaseOrderNumber,
    };
  }

  return {
    amount: 0,
    currencyCode: 'USD',
    source: 'none',
    notFromLatest: false,
    latestAmount: null,
    latestCurrencyCode: null,
    purchaseOrderNumber: null,
  };
}
