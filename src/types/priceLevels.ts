/**
 * Dealer price levels (Dealers → Price level setting).
 * Stored at appSettings/priceLevels.
 *
 * Each level has:
 * - named tier (Directors / Agents / Dealers / anything the admin creates)
 * - assigned Zoho dealer contact ids
 * - per-catalog-category % discount or % price increment
 * - optional per-item overrides inside a category
 *   (except / special discount / hike / fixed custom ₹)
 * - synthetic Spare parts category (`SPARE_PRICE_LEVEL_CATEGORY_ID`) for the
 *   full spare pool (generic + uncategorized), same as catalogue Spares
 */

/** Virtual category id for spare-pool rules (not a Zoho category). */
export const SPARE_PRICE_LEVEL_CATEGORY_ID = '__spare_parts__';

export const SPARE_PRICE_LEVEL_CATEGORY_NAME = 'Spare parts';

/**
 * Built-in catch-all level: covers every Zoho dealer not assigned to another level.
 * Always present; dealerIds are ignored (membership is implicit).
 */
export const DEFAULT_DEALER_PRICE_LEVEL_ID = '__default_dealers__';

export const DEFAULT_DEALER_PRICE_LEVEL_NAME = 'Dealers';

export type PriceLevelRuleMode = 'discount' | 'increment';

/** Item override inside a category rule. */
export type PriceLevelItemRuleKind = 'except' | 'discount' | 'increment' | 'fixed';

/** Quantity tier for a fixed item override (unit ₹ from this qty upward). */
export interface PriceLevelQtySlab {
  /** Inclusive minimum order qty for this unit rate. */
  minQty: number;
  /** Unit price in ₹. */
  rate: number;
}

export interface PriceLevelItemRule {
  productId: string;
  productName: string;
  sku: string | null;
  /**
   * except — charge list rate (ignore category %).
   * discount / increment — special % for this item only.
   * fixed — charge absolute customRate (₹), optionally with qty slabs.
   */
  kind: PriceLevelItemRuleKind;
  /** Used when kind is discount / increment. Ignored for except / fixed. */
  percent: number;
  /**
   * Absolute unit price when kind === 'fixed' and slabs are empty.
   * When slabs exist, this mirrors the minQty=1 (or lowest) slab rate.
   */
  customRate: number | null;
  /**
   * Qty → unit ₹ tiers (fixed overrides). Empty = single customRate.
   * Example: [{ minQty: 1, rate: 1900 }, { minQty: 11, rate: 1800 }]
   */
  slabs: PriceLevelQtySlab[];
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
  /**
   * Catalog category ids (incl. spare synthetic id) hidden from dealers on this level.
   * Default empty = all categories permitted.
   */
  restrictedCategoryIds: string[];
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
  /** Qty slabs for dealer display (empty when none). chargeRate is for the requested qty. */
  slabs: PriceLevelQtySlab[];
}
