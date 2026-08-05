/**
 * Dealer price levels (Settings → Price level setting).
 * Stored at appSettings/priceLevels.
 *
 * Each level has:
 * - named tier (Directors / Agents / Dealers / anything the admin creates)
 * - assigned Zoho dealer contact ids
 * - per-catalog-category % discount or % price increment
 */

export type PriceLevelRuleMode = 'discount' | 'increment';

export interface PriceLevelCategoryRule {
  /** Catalog category id (`catalogCategories` / Zoho category_id). */
  categoryId: string;
  categoryName: string;
  mode: PriceLevelRuleMode;
  /** Percent of list rate. 10 = 10% off (discount) or 10% hike (increment). */
  percent: number;
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
  mode: 'none' | PriceLevelRuleMode;
  percent: number;
  levelId: string | null;
  levelName: string | null;
  categoryId: string | null;
}
