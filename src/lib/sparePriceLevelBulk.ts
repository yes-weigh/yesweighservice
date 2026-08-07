import {
  applyPriceLevelPercent,
  isDefaultDealerPriceLevel,
  roundMoney,
  SPARE_PRICE_LEVEL_CATEGORY_ID,
  SPARE_PRICE_LEVEL_CATEGORY_NAME,
} from './priceLevels';
import type { CatalogProduct } from '../types/catalog';
import type {
  PriceLevel,
  PriceLevelCategoryRule,
  PriceLevelRuleMode,
} from '../types/priceLevels';

export type SpareLevelBulkRow = {
  product: CatalogProduct;
  /** Current catalog / New sell (informational). */
  listRate: number;
  landingInr: number;
  /** Purchase cost amount in its currency (0 = skip bulk level pricing). */
  purchaseAmount: number;
};

/** Adjustment applied on top of dealer price (not on landing). */
export type SpareLevelAdjustDraft = {
  levelId: string;
  /** null = skip this level on apply */
  mode: PriceLevelRuleMode | null;
  percent: number | null;
};

/** Level discount/hike written to Spare parts category % on price levels. */
export type SpareLevelPriceAdjust = {
  levelId: string;
  levelName: string;
  mode: PriceLevelRuleMode;
  percent: number;
};

export type SpareLevelBulkPreview = {
  mode: PriceLevelRuleMode | 'list';
  percent: number;
  eligibleCount: number;
  skippedZeroPurchase: number;
};

/** Purchase amount must be > 0 — free / zero-cost lines are never bulk-applied. */
export function isEligibleForSpareLevelBulk(row: SpareLevelBulkRow): boolean {
  return (Number(row.purchaseAmount) || 0) > 0;
}

export function filterSpareLevelBulkRows(rows: SpareLevelBulkRow[]): {
  eligible: SpareLevelBulkRow[];
  skippedZeroPurchase: number;
} {
  const eligible: SpareLevelBulkRow[] = [];
  let skippedZeroPurchase = 0;
  for (const row of rows) {
    if (isEligibleForSpareLevelBulk(row)) eligible.push(row);
    else skippedZeroPurchase += 1;
  }
  return { eligible, skippedZeroPurchase };
}

function clampPercent(raw: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1000) * 100) / 100;
}

function clampDealerProfitPercent(raw: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(Math.max(n, 0), 1000) * 10) / 10;
}

/** Dealer / list price = landing × (1 + profit%/100). */
export function dealerPriceFromLanding(landingInr: number, dealerProfitPercent: number): number {
  const land = Number(landingInr) || 0;
  const pct = clampDealerProfitPercent(dealerProfitPercent);
  if (!(land > 0)) return 0;
  return roundMoney(land * (1 + pct / 100));
}

export function buildDealerListRates(
  rows: SpareLevelBulkRow[],
  dealerProfitPercent: number,
): Array<{ productId: string; rate: number }> {
  const { eligible } = filterSpareLevelBulkRows(rows);
  return eligible.map(row => ({
    productId: row.product.id,
    rate: dealerPriceFromLanding(row.landingInr, dealerProfitPercent),
  }));
}

export function averageDealerPrice(
  rows: SpareLevelBulkRow[],
  dealerProfitPercent: number,
): number {
  const { eligible } = filterSpareLevelBulkRows(rows);
  if (!eligible.length) return 0;
  let sum = 0;
  for (const row of eligible) {
    sum += dealerPriceFromLanding(row.landingInr, dealerProfitPercent);
  }
  return roundMoney(sum / eligible.length);
}

export function previewSpareLevelAdjust(
  rows: SpareLevelBulkRow[],
  mode: PriceLevelRuleMode | null,
  percent: number | null,
): SpareLevelBulkPreview | null {
  const { eligible, skippedZeroPurchase } = filterSpareLevelBulkRows(rows);
  if (mode == null || percent == null) return null;
  const pct = clampPercent(percent);
  return {
    mode: pct <= 0 ? 'list' : mode,
    percent: pct,
    eligibleCount: eligible.length,
    skippedZeroPurchase,
  };
}

export function formatSpareLevelSees(preview: SpareLevelBulkPreview | null): string {
  if (!preview) return '—';
  if (preview.mode === 'list' || preview.percent <= 0) {
    return `New sell (list) · ${preview.eligibleCount}`;
  }
  if (preview.mode === 'discount') {
    return `New sell −${preview.percent}% · ${preview.eligibleCount}`;
  }
  return `New sell +${preview.percent}% · ${preview.eligibleCount}`;
}

export function getSpareCategoryRule(level: PriceLevel): PriceLevelCategoryRule | undefined {
  return level.categoryRules.find(r => r.categoryId === SPARE_PRICE_LEVEL_CATEGORY_ID);
}

export function formatSpareRuleSummary(rule: PriceLevelCategoryRule | undefined): string {
  if (!rule) return 'No spare rule';
  const overrides = rule.itemRules.length;
  if (rule.percent > 0) {
    const sign = rule.mode === 'increment' ? '+' : '−';
    return overrides > 0
      ? `${sign}${rule.percent}% · ${overrides} item override${overrides === 1 ? '' : 's'}`
      : `${sign}${rule.percent}%`;
  }
  if (overrides > 0) {
    return `${overrides} item override${overrides === 1 ? '' : 's'}`;
  }
  return 'No spare rule';
}

/**
 * Set Spare parts category mode/percent. Preserves every item override
 * (Custom ₹ / slabs / except / %) — never floods item rules.
 */
export function setSpareCategoryPercent(
  level: PriceLevel,
  mode: PriceLevelRuleMode,
  percent: number,
): PriceLevel {
  const existing = getSpareCategoryRule(level);
  const pct = clampPercent(percent);
  const spareRule: PriceLevelCategoryRule = {
    categoryId: SPARE_PRICE_LEVEL_CATEGORY_ID,
    categoryName: SPARE_PRICE_LEVEL_CATEGORY_NAME,
    mode,
    percent: pct,
    itemRules: existing?.itemRules ?? [],
  };
  const otherRules = level.categoryRules.filter(
    r => r.categoryId !== SPARE_PRICE_LEVEL_CATEGORY_ID,
  );
  return {
    ...level,
    categoryRules: [...otherRules, spareRule],
  };
}

/**
 * Apply level discount/hike as Spare parts **category** % on each level.
 * Default Dealers stays list (0%). Item overrides (including fixed/slabs) are kept.
 */
export function applySpareCategoryPercentsToLevels(
  levels: PriceLevel[],
  adjusts: SpareLevelPriceAdjust[],
): PriceLevel[] {
  const adjustById = new Map(adjusts.map(a => [a.levelId, a]));
  return levels.map(level => {
    if (isDefaultDealerPriceLevel(level)) {
      return setSpareCategoryPercent(level, 'discount', 0);
    }
    const adjust = adjustById.get(level.id);
    if (!adjust) return level;
    if (adjust.percent <= 0) {
      return setSpareCategoryPercent(level, 'discount', 0);
    }
    return setSpareCategoryPercent(level, adjust.mode, adjust.percent);
  });
}

/** Seed bulk panel drafts from live spare category rules on price levels. */
export function spareCategoryAdjustsFromLevels(levels: PriceLevel[]): SpareLevelPriceAdjust[] {
  const out: SpareLevelPriceAdjust[] = [];
  for (const level of levels) {
    if (isDefaultDealerPriceLevel(level)) continue;
    const rule = getSpareCategoryRule(level);
    if (!rule || !(rule.percent > 0)) continue;
    out.push({
      levelId: level.id,
      levelName: level.name,
      mode: rule.mode,
      percent: rule.percent,
    });
  }
  return out;
}

export function isSpareLevelAdjustDraftActive(draft: SpareLevelAdjustDraft | undefined): boolean {
  return Boolean(
    draft
    && draft.mode != null
    && draft.percent != null
    && Number(draft.percent) >= 0,
  );
}

export type SpareLevelChargeSummary = {
  chargeRate: number;
  mode: 'none' | PriceLevelRuleMode | 'fixed';
  percent: number;
  /** True when this product has a spare item override or category %. */
  hasRule: boolean;
};

/** Effective charge under current spare category/item rules (qty 1). */
export function currentSpareChargeForProduct(
  level: PriceLevel,
  productId: string,
  listRate: number,
): SpareLevelChargeSummary {
  const list = roundMoney(listRate);
  const rule = getSpareCategoryRule(level);
  if (!rule) return { chargeRate: list, mode: 'none', percent: 0, hasRule: false };
  const item = rule.itemRules.find(r => r.productId === productId);
  if (item) {
    if (item.kind === 'except') {
      return { chargeRate: list, mode: 'none', percent: 0, hasRule: true };
    }
    if (item.kind === 'fixed') {
      return {
        chargeRate: roundMoney(Number(item.customRate) || 0),
        mode: 'fixed',
        percent: 0,
        hasRule: true,
      };
    }
    if (item.percent <= 0) {
      return { chargeRate: list, mode: 'none', percent: 0, hasRule: true };
    }
    return {
      chargeRate: applyPriceLevelPercent(list, item.kind, item.percent),
      mode: item.kind,
      percent: item.percent,
      hasRule: true,
    };
  }
  if (rule.percent <= 0) {
    return { chargeRate: list, mode: 'none', percent: 0, hasRule: false };
  }
  return {
    chargeRate: applyPriceLevelPercent(list, rule.mode, rule.percent),
    mode: rule.mode,
    percent: rule.percent,
    hasRule: true,
  };
}

export type ExistingSpareLevelPriceRow = {
  levelId: string;
  levelName: string;
  chargeRate: number;
  mode: 'none' | PriceLevelRuleMode | 'fixed';
  percent: number;
  isDefault: boolean;
};

/** Existing spare level rules for one product (saved price levels). */
export function existingSpareLevelPricingForProduct(
  levels: PriceLevel[],
  productId: string,
  listRate: number,
): ExistingSpareLevelPriceRow[] {
  const sorted = [...levels].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const out: ExistingSpareLevelPriceRow[] = [];
  for (const level of sorted) {
    const summary = currentSpareChargeForProduct(level, productId, listRate);
    const isDefault = isDefaultDealerPriceLevel(level);
    if (!isDefault && !summary.hasRule) continue;
    out.push({
      levelId: level.id,
      levelName: level.name,
      chargeRate: summary.chargeRate,
      mode: summary.mode,
      percent: summary.percent,
      isDefault,
    });
  }
  return out;
}

export function formatExistingSpareLevelMode(row: ExistingSpareLevelPriceRow): string {
  if (row.isDefault || row.mode === 'none') return 'list';
  if (row.mode === 'fixed') return 'fixed';
  if (row.mode === 'discount') return `−${row.percent}% discount`;
  return `+${row.percent}% hike`;
}

export { isDefaultDealerPriceLevel };
