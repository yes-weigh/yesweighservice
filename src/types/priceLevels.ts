/**
 * Dealer price levels (Settings → Price level setting).
 * Stored at appSettings/priceLevels.
 *
 * Each level has:
 * - named tier (Directors / Agents / Dealers / anything the admin creates)
 * - assigned Zoho dealer contact ids
 * - per-catalog-category % discount or % price increment
 * - optional per-item overrides inside a category
 *   (except / special discount / hike / fixed custom ₹)
 */

export type PriceLevelRuleMode = 'discount' | 'increment';

/** Item override inside a category rule. */
export type PriceLevelItemRuleKind = 'except' | 'discount' | 'increment' | 'fixed';

export interface PriceLevelItemRule {
  productId: string;
  productName: string;
  sku: string | null;
  /**
   * except — charge list rate (ignore category %).
   * discount / increment — special % for this item only.
   * fixed — charge absolute customRate (₹).
   */
  kind: PriceLevelItemRuleKind;
  /** Used when kind is discount / increment. Ignored for except / fixed. */
  percent: number;
  /** Absolute unit price when kind === 'fixed'. */
  customRate: number | null;
}

export interface PriceLevelCategoryRule {
  /** Catalog category id (`catalogCategories` / Zoho category_id). */
  categoryId: string;
  categoryName: string;
  mode: PriceLevelRuleMode;
  /** Percent of list rate. 10 = 10% off (discount) or 10% hike (increment). */
  percent: number;
  /** Per-product overrides within this category. */
  itemRules: PriceLevelItemRule[];
}

export interface PriceLevel {
  id: string;
  name: string;
  /** Zoho Inventory contact / dealer ids. */
  dealerIds: string[];
  categoryRules: PriceLevelCategoryRule[];
  sortOrder: number;
  updatedAt: string | null;
}

export interface PriceLevelsDoc {
  levels: PriceLevel[];
  updatedAt: string | null;
  updatedByUid: string | null;
}

/** Resolved unit pricing for a dealer + product. */
export interface DealerUnitPrice {
  listRate: number;
  chargeRate: number;
  mode: 'none' | PriceLevelRuleMode | 'fixed';
  percent: number;
  levelId: string | null;
  levelName: string | null;
  categoryId: string | null;
  /** True when an item-level override decided the price. */
  itemOverride: boolean;
}
