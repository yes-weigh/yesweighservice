import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { CatalogProduct } from '../types/catalog';
import type {
  DealerUnitPrice,
  PriceLevel,
  PriceLevelCategoryRule,
  PriceLevelRuleMode,
  PriceLevelsDoc,
} from '../types/priceLevels';

export const PRICE_LEVELS_DOC_ID = 'priceLevels';

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

function normalizeRule(raw: unknown): PriceLevelCategoryRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const categoryId = String(row.categoryId ?? '').trim();
  if (!categoryId) return null;
  return {
    categoryId,
    categoryName: String(row.categoryName ?? '').trim() || categoryId,
    mode: normalizeMode(row.mode),
    percent: clampPercent(row.percent),
  };
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
    sortOrder,
    updatedAt: row.updatedAt != null ? String(row.updatedAt) : null,
  };
}

export function normalizePriceLevelsDoc(raw: unknown): PriceLevelsDoc {
  if (!raw || typeof raw !== 'object') return emptyPriceLevelsDoc();
  const row = raw as Record<string, unknown>;
  const levels = Array.isArray(row.levels)
    ? row.levels
      .map((level, i) => normalizeLevel(level, i))
      .filter((level): level is PriceLevel => Boolean(level))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    : [];
  return {
    levels,
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
    sortOrder,
    updatedAt: null,
  };
}

/** Ensure each dealer id appears in at most one level (keeps the first occurrence). */
export function enforceUniqueDealerAssignments(levels: PriceLevel[]): PriceLevel[] {
  const seen = new Set<string>();
  return levels.map(level => {
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
  return levels.find(level => level.dealerIds.includes(id)) ?? null;
}

export function resolveDealerUnitPrice(
  levels: PriceLevel[],
  dealerId: string | null | undefined,
  product: Pick<CatalogProduct, 'rate' | 'categoryId'>,
): DealerUnitPrice {
  const listRate = roundMoney(Number(product.rate) || 0);
  const level = findPriceLevelForDealer(levels, dealerId);
  const categoryId = String(product.categoryId ?? '').trim() || null;
  if (!level || !categoryId) {
    return {
      listRate,
      chargeRate: listRate,
      mode: 'none',
      percent: 0,
      levelId: level?.id ?? null,
      levelName: level?.name ?? null,
      categoryId,
    };
  }
  const rule = level.categoryRules.find(r => r.categoryId === categoryId);
  if (!rule || rule.percent <= 0) {
    return {
      listRate,
      chargeRate: listRate,
      mode: 'none',
      percent: 0,
      levelId: level.id,
      levelName: level.name,
      categoryId,
    };
  }
  const chargeRate = applyPriceLevelPercent(listRate, rule.mode, rule.percent);
  return {
    listRate,
    chargeRate,
    mode: rule.mode,
    percent: rule.percent,
    levelId: level.id,
    levelName: level.name,
    categoryId,
  };
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
