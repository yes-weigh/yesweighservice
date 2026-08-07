import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { isGenericSparePartsCategory } from './catalog';
import type { CatalogProduct } from '../types/catalog';
import type {
  DealerUnitPrice,
  PriceLevel,
  PriceLevelCategoryRule,
  PriceLevelItemRule,
  PriceLevelItemRuleKind,
  PriceLevelQtySlab,
  PriceLevelRuleMode,
  PriceLevelsDoc,
} from '../types/priceLevels';
import {
  DEFAULT_DEALER_PRICE_LEVEL_ID,
  DEFAULT_DEALER_PRICE_LEVEL_NAME,
  SPARE_PRICE_LEVEL_CATEGORY_ID,
  SPARE_PRICE_LEVEL_CATEGORY_NAME,
} from '../types/priceLevels';

export const PRICE_LEVELS_DOC_ID = 'priceLevels';
export {
  DEFAULT_DEALER_PRICE_LEVEL_ID,
  DEFAULT_DEALER_PRICE_LEVEL_NAME,
  SPARE_PRICE_LEVEL_CATEGORY_ID,
  SPARE_PRICE_LEVEL_CATEGORY_NAME,
};

export function isSparePriceLevelCategoryId(id: string | null | undefined): boolean {
  return String(id ?? '').trim() === SPARE_PRICE_LEVEL_CATEGORY_ID;
}

export function isDefaultDealerPriceLevel(
  level: Pick<PriceLevel, 'id'> | string | null | undefined,
): boolean {
  const id = typeof level === 'string' || level == null
    ? String(level ?? '').trim()
    : String(level.id ?? '').trim();
  return id === DEFAULT_DEALER_PRICE_LEVEL_ID;
}

export function createDefaultDealerPriceLevel(sortOrder = 9999): PriceLevel {
  return {
    id: DEFAULT_DEALER_PRICE_LEVEL_ID,
    name: DEFAULT_DEALER_PRICE_LEVEL_NAME,
    dealerIds: [],
    categoryRules: [],
    restrictedCategoryIds: [],
    sortOrder,
    updatedAt: null,
  };
}

/**
 * Ensure the catch-all "Dealers" level always exists.
 * Promotes a legacy level named "Dealers" when the built-in id is missing.
 */
export function ensureDefaultDealerPriceLevel(levels: PriceLevel[]): PriceLevel[] {
  const list = [...levels];
  const byDefaultId = list.findIndex(l => isDefaultDealerPriceLevel(l));
  if (byDefaultId >= 0) {
    const current = list[byDefaultId];
    list[byDefaultId] = {
      ...current,
      id: DEFAULT_DEALER_PRICE_LEVEL_ID,
      name: DEFAULT_DEALER_PRICE_LEVEL_NAME,
      dealerIds: [],
    };
  } else {
    const legacyIdx = list.findIndex(
      l => l.name.trim().toLowerCase() === DEFAULT_DEALER_PRICE_LEVEL_NAME.toLowerCase(),
    );
    if (legacyIdx >= 0) {
      const legacy = list[legacyIdx];
      list[legacyIdx] = {
        ...legacy,
        id: DEFAULT_DEALER_PRICE_LEVEL_ID,
        name: DEFAULT_DEALER_PRICE_LEVEL_NAME,
        dealerIds: [],
      };
    } else {
      const maxOrder = list.reduce((max, l) => Math.max(max, l.sortOrder), -1);
      list.push(createDefaultDealerPriceLevel(maxOrder + 1));
    }
  }

  // Keep catch-all last in the list for UI; other levels keep relative order.
  const defaultLevel = list.find(isDefaultDealerPriceLevel)!;
  const others = list
    .filter(l => !isDefaultDealerPriceLevel(l))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((level, index) => ({ ...level, sortOrder: index }));
  return [
    ...others,
    { ...defaultLevel, sortOrder: others.length },
  ];
}

/** Uncategorized or Generic Spare Parts — uses the synthetic spare price-level bucket. */
export function productUsesSparePriceLevel(
  product: Pick<CatalogProduct, 'categoryId' | 'categoryName'>,
): boolean {
  const catId = String(product.categoryId ?? '').trim();
  if (!catId) return true;
  const name = String(product.categoryName ?? '').trim();
  return Boolean(name && isGenericSparePartsCategory({ name }));
}

const LIVE_SAVE_MS = 450;

export function priceLevelsLiveSaveMs(): number {
  return LIVE_SAVE_MS;
}

export function emptyPriceLevelsDoc(): PriceLevelsDoc {
  return { levels: [], updatedAt: null, updatedByUid: null };
}

function clampPercent(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1000) * 100) / 100;
}

function normalizeMode(raw: unknown): PriceLevelRuleMode {
  return raw === 'increment' ? 'increment' : 'discount';
}

function clampMoney(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeItemKind(raw: unknown): PriceLevelItemRuleKind {
  if (raw === 'except' || raw === 'increment' || raw === 'fixed') return raw;
  return 'discount';
}

function clampQty(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1_000_000);
}

/** Normalize + sort qty slabs; dedupe by minQty (last wins). */
export function normalizePriceLevelSlabs(raw: unknown): PriceLevelQtySlab[] {
  if (!Array.isArray(raw)) return [];
  const byQty = new Map<number, number>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const minQty = clampQty(item.minQty ?? item.qty ?? item.fromQty);
    const rate = clampMoney(item.rate ?? item.customRate ?? item.price);
    byQty.set(minQty, rate);
  }
  return [...byQty.entries()]
    .map(([minQty, rate]) => ({ minQty, rate }))
    .sort((a, b) => a.minQty - b.minQty);
}

/** Unit ₹ for qty from sorted slabs (highest minQty ≤ qty). */
export function resolveSlabUnitRate(
  slabs: PriceLevelQtySlab[],
  quantity: number,
  fallbackRate: number,
): number {
  const list = normalizePriceLevelSlabs(slabs);
  if (!list.length) return roundMoney(Number(fallbackRate) || 0);
  const qty = clampQty(quantity);
  let rate = list[0].rate;
  for (const slab of list) {
    if (qty >= slab.minQty) rate = slab.rate;
    else break;
  }
  return roundMoney(rate);
}

/** Dealer-facing labels for qty slabs (e.g. Qty 1–10, Qty 11+). */
export function formatPriceLevelSlabLabels(
  slabs: PriceLevelQtySlab[],
): Array<{ minQty: number; maxQty: number | null; label: string; rate: number }> {
  const list = normalizePriceLevelSlabs(slabs);
  return list.map((slab, index) => {
    const next = list[index + 1];
    const maxQty = next ? next.minQty - 1 : null;
    const label = maxQty != null && maxQty >= slab.minQty
      ? `Qty ${slab.minQty}–${maxQty}`
      : `Qty ${slab.minQty}+`;
    return {
      minQty: slab.minQty,
      maxQty,
      label,
      rate: slab.rate,
    };
  });
}

function normalizeItemRule(raw: unknown): PriceLevelItemRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const productId = String(row.productId ?? '').trim();
  if (!productId) return null;
  const kind = normalizeItemKind(row.kind);
  const customRaw = row.customRate ?? row.fixedRate;
  const slabs = kind === 'fixed' ? normalizePriceLevelSlabs(row.slabs) : [];
  let customRate: number | null = null;
  if (kind === 'fixed') {
    customRate = slabs.length > 0
      ? slabs[0].rate
      : clampMoney(customRaw);
  }
  return {
    productId,
    productName: String(row.productName ?? '').trim() || productId,
    sku: row.sku != null && String(row.sku).trim() ? String(row.sku).trim() : null,
    kind,
    percent: kind === 'except' || kind === 'fixed' ? 0 : clampPercent(row.percent),
    customRate,
    slabs,
  };
}

function normalizeRule(raw: unknown): PriceLevelCategoryRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const categoryId = String(row.categoryId ?? '').trim();
  if (!categoryId) return null;
  const itemRules = Array.isArray(row.itemRules)
    ? row.itemRules.map(normalizeItemRule).filter((r): r is PriceLevelItemRule => Boolean(r))
    : [];
  // Deduplicate by productId (last wins).
  const byProduct = new Map<string, PriceLevelItemRule>();
  for (const item of itemRules) byProduct.set(item.productId, item);
  return {
    categoryId,
    categoryName: String(row.categoryName ?? '').trim() || categoryId,
    mode: normalizeMode(row.mode),
    percent: clampPercent(row.percent),
    itemRules: [...byProduct.values()],
  };
}

function normalizeRestrictedCategoryIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))];
}

function normalizeLevel(raw: unknown, index: number): PriceLevel | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? '').trim();
  if (!id) return null;
  const dealerIds = Array.isArray(row.dealerIds)
    ? [...new Set(row.dealerIds.map(v => String(v ?? '').trim()).filter(Boolean))]
    : [];
  const categoryRules = Array.isArray(row.categoryRules)
    ? row.categoryRules.map(normalizeRule).filter((r): r is PriceLevelCategoryRule => Boolean(r))
    : [];
  const sortOrder = Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index;
  return {
    id,
    name: String(row.name ?? '').trim() || 'Untitled level',
    dealerIds,
    categoryRules,
    restrictedCategoryIds: normalizeRestrictedCategoryIds(
      row.restrictedCategoryIds ?? row.hiddenCategoryIds ?? row.restrictedCategories,
    ),
    sortOrder,
    updatedAt: row.updatedAt != null ? String(row.updatedAt) : null,
  };
}

export function normalizePriceLevelsDoc(raw: unknown): PriceLevelsDoc {
  if (!raw || typeof raw !== 'object') {
    return {
      ...emptyPriceLevelsDoc(),
      levels: ensureDefaultDealerPriceLevel([]),
    };
  }
  const row = raw as Record<string, unknown>;
  const levels = Array.isArray(row.levels)
    ? row.levels
      .map((level, i) => normalizeLevel(level, i))
      .filter((level): level is PriceLevel => Boolean(level))
    : [];
  return {
    levels: ensureDefaultDealerPriceLevel(levels),
    updatedAt: row.updatedAt != null ? String(row.updatedAt) : null,
    updatedByUid: row.updatedByUid != null ? String(row.updatedByUid) : null,
  };
}

export function newPriceLevelId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyPriceLevel(name = 'New level', sortOrder = 0): PriceLevel {
  return {
    id: newPriceLevelId(),
    name: name.trim() || 'New level',
    dealerIds: [],
    categoryRules: [],
    restrictedCategoryIds: [],
    sortOrder,
    updatedAt: null,
  };
}

export function isCategoryRestrictedOnLevel(
  level: PriceLevel | null | undefined,
  categoryId: string | null | undefined,
): boolean {
  const id = String(categoryId ?? '').trim();
  if (!level || !id) return false;
  return level.restrictedCategoryIds.includes(id);
}

/** Category ids dealers on this level must not see (incl. spare synthetic id). */
export function restrictedCategoryIdsForDealer(
  levels: PriceLevel[],
  dealerId: string | null | undefined,
): Set<string> {
  const level = findPriceLevelForDealer(levels, dealerId);
  if (!level) return new Set();
  return new Set(level.restrictedCategoryIds);
}

/**
 * Whether a product is visible to a dealer on the given level.
 * Spare-pool products follow the synthetic spare category restriction.
 */
export function isProductVisibleOnPriceLevel(
  level: PriceLevel | null | undefined,
  product: Pick<CatalogProduct, 'categoryId' | 'categoryName'>,
): boolean {
  if (!level) return true;
  if (productUsesSparePriceLevel(product)) {
    return !isCategoryRestrictedOnLevel(level, SPARE_PRICE_LEVEL_CATEGORY_ID);
  }
  const catId = String(product.categoryId ?? '').trim();
  if (!catId) return true;
  return !isCategoryRestrictedOnLevel(level, catId);
}

export function toggleRestrictedCategoryId(
  level: PriceLevel,
  categoryId: string,
  restricted: boolean,
): PriceLevel {
  const id = String(categoryId ?? '').trim();
  if (!id) return level;
  const set = new Set(level.restrictedCategoryIds);
  if (restricted) set.add(id);
  else set.delete(id);
  return { ...level, restrictedCategoryIds: [...set] };
}

export function emptyCategoryRule(
  categoryId: string,
  categoryName: string,
): PriceLevelCategoryRule {
  return {
    categoryId,
    categoryName,
    mode: 'discount',
    percent: 0,
    itemRules: [],
  };
}

/** Category has a usable default % or at least one item override. */
export function categoryRuleHasEffect(rule: PriceLevelCategoryRule): boolean {
  if (rule.percent > 0) return true;
  return rule.itemRules.some(item => (
    item.kind === 'except'
    || item.kind === 'fixed'
    || item.slabs.length > 0
    || item.percent > 0
  ));
}

/** Ensure each dealer id appears in at most one level (keeps the first occurrence). */
export function enforceUniqueDealerAssignments(levels: PriceLevel[]): PriceLevel[] {
  const seen = new Set<string>();
  return ensureDefaultDealerPriceLevel(levels).map(level => {
    // Catch-all never stores explicit dealer ids.
    if (isDefaultDealerPriceLevel(level)) {
      return { ...level, dealerIds: [] };
    }
    const dealerIds: string[] = [];
    for (const id of level.dealerIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      dealerIds.push(id);
    }
    return { ...level, dealerIds };
  });
}

export function roundMoney(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

export function applyPriceLevelPercent(
  listRate: number,
  mode: PriceLevelRuleMode,
  percent: number,
): number {
  const list = Number(listRate) || 0;
  const pct = clampPercent(percent);
  if (pct <= 0) return roundMoney(list);
  if (mode === 'increment') {
    return roundMoney(list * (1 + pct / 100));
  }
  return roundMoney(list * (1 - pct / 100));
}

export function findPriceLevelForDealer(
  levels: PriceLevel[],
  dealerId: string | null | undefined,
): PriceLevel | null {
  const id = String(dealerId ?? '').trim();
  if (!id) return null;
  const assigned = levels.find(
    level => !isDefaultDealerPriceLevel(level) && level.dealerIds.includes(id),
  );
  if (assigned) return assigned;
  return levels.find(isDefaultDealerPriceLevel) ?? null;
}

function nonePrice(
  listRate: number,
  level: PriceLevel | null,
  categoryId: string | null,
  itemOverride = false,
): DealerUnitPrice {
  return {
    listRate,
    chargeRate: listRate,
    mode: 'none',
    percent: 0,
    levelId: level?.id ?? null,
    levelName: level?.name ?? null,
    categoryId,
    itemOverride,
    slabs: [],
  };
}

function applyItemOrCategoryRule(
  listRate: number,
  level: PriceLevel,
  rule: PriceLevelCategoryRule,
  productId: string,
  reportCategoryId: string | null,
  quantity: number,
): DealerUnitPrice {
  const itemRule = productId
    ? rule.itemRules.find(r => r.productId === productId)
    : undefined;

  if (itemRule) {
    if (itemRule.kind === 'except') {
      return nonePrice(listRate, level, reportCategoryId, true);
    }
    if (itemRule.kind === 'fixed') {
      const slabs = normalizePriceLevelSlabs(itemRule.slabs);
      const fallback = roundMoney(Number(itemRule.customRate) || 0);
      const chargeRate = slabs.length > 0
        ? resolveSlabUnitRate(slabs, quantity, fallback)
        : fallback;
      return {
        listRate,
        chargeRate,
        mode: 'fixed',
        percent: 0,
        levelId: level.id,
        levelName: level.name,
        categoryId: reportCategoryId,
        itemOverride: true,
        slabs,
      };
    }
    if (itemRule.percent <= 0) {
      return nonePrice(listRate, level, reportCategoryId, true);
    }
    return {
      listRate,
      chargeRate: applyPriceLevelPercent(listRate, itemRule.kind, itemRule.percent),
      mode: itemRule.kind,
      percent: itemRule.percent,
      levelId: level.id,
      levelName: level.name,
      categoryId: reportCategoryId,
      itemOverride: true,
      slabs: [],
    };
  }

  if (rule.percent <= 0) {
    return nonePrice(listRate, level, reportCategoryId);
  }
  return {
    listRate,
    chargeRate: applyPriceLevelPercent(listRate, rule.mode, rule.percent),
    mode: rule.mode,
    percent: rule.percent,
    levelId: level.id,
    levelName: level.name,
    categoryId: reportCategoryId,
    itemOverride: false,
    slabs: [],
  };
}

export function resolveDealerUnitPrice(
  levels: PriceLevel[],
  dealerId: string | null | undefined,
  product: Pick<CatalogProduct, 'id' | 'rate' | 'categoryId' | 'categoryName'>,
  quantity = 1,
): DealerUnitPrice {
  const listRate = roundMoney(Number(product.rate) || 0);
  const level = findPriceLevelForDealer(levels, dealerId);
  const categoryId = String(product.categoryId ?? '').trim() || null;
  const productId = String(product.id ?? '').trim();
  const qty = clampQty(quantity);
  if (!level) {
    return nonePrice(listRate, null, categoryId);
  }

  const spareRule = level.categoryRules.find(r => r.categoryId === SPARE_PRICE_LEVEL_CATEGORY_ID);
  const categoryRule = categoryId
    ? level.categoryRules.find(r => r.categoryId === categoryId)
    : undefined;
  const useSpareBucket = productUsesSparePriceLevel(product);

  if (useSpareBucket && spareRule) {
    const priced = applyItemOrCategoryRule(
      listRate,
      level,
      spareRule,
      productId,
      SPARE_PRICE_LEVEL_CATEGORY_ID,
      qty,
    );
    // Spare bucket decided a non-list charge, or an explicit item override.
    if (priced.itemOverride || priced.mode !== 'none') {
      return priced;
    }
  }

  // Legacy: rules stored on the Zoho Generic Spare Parts category id.
  if (useSpareBucket && categoryRule && categoryId) {
    return applyItemOrCategoryRule(listRate, level, categoryRule, productId, categoryId, qty);
  }

  if (!useSpareBucket && categoryRule && categoryId) {
    return applyItemOrCategoryRule(listRate, level, categoryRule, productId, categoryId, qty);
  }

  return nonePrice(listRate, level, categoryId);
}

export async function loadPriceLevels(): Promise<PriceLevelsDoc> {
  const snap = await getDoc(doc(db, 'appSettings', PRICE_LEVELS_DOC_ID));
  if (!snap.exists()) return emptyPriceLevelsDoc();
  return normalizePriceLevelsDoc(snap.data());
}

export async function savePriceLevels(
  levels: PriceLevel[],
  updatedByUid: string | null,
): Promise<PriceLevelsDoc> {
  const normalized = normalizePriceLevelsDoc({
    levels: enforceUniqueDealerAssignments(levels),
  });
  const updatedAt = new Date().toISOString();
  const payload: PriceLevelsDoc = {
    levels: normalized.levels.map((level, index) => ({
      ...level,
      sortOrder: index,
      updatedAt,
    })),
    updatedAt,
    updatedByUid: updatedByUid?.trim() || null,
  };
  await setDoc(doc(db, 'appSettings', PRICE_LEVELS_DOC_ID), payload, { merge: true });
  return payload;
}

export function subscribePriceLevels(
  onData: (docData: PriceLevelsDoc) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, 'appSettings', PRICE_LEVELS_DOC_ID),
    snap => {
      onData(snap.exists() ? normalizePriceLevelsDoc(snap.data()) : emptyPriceLevelsDoc());
    },
    err => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  );
}

export function priceLevelsEqual(a: PriceLevel[], b: PriceLevel[]): boolean {
  return JSON.stringify(normalizePriceLevelsDoc({ levels: a }).levels)
    === JSON.stringify(normalizePriceLevelsDoc({ levels: b }).levels);
}
