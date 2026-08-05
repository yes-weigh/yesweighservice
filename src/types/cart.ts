import type { CatalogProduct, StockStatus } from './catalog';
import { combinedCartRate, newCartLineId } from '../lib/gatcCart';
import { effectiveCatalogStockStatus } from '../lib/sacCatalog';

export interface CartItem {
  /** Stable row id — same product can appear twice (with / without stamping). */
  cartLineId: string;
  productId: string;
  name: string;
  sku: string | null;
  /** Zoho item description — same “spec writing” as SO / invoice lines. */
  description: string | null;
  imageUrl: string | null;
  /**
   * Unit rate charged on the SO line = baseRate + gatcFeePerUnit.
   * (Accounting: stamping is rolled into product price, not a separate line.)
   */
  rate: number;
  /** Catalog / staff-editable product rate before stamping fee. */
  baseRate: number;
  /**
   * Catalog list rate when a price-level discount applies (dealer portal).
   * Null/undefined for list pricing or price-hike levels (hike hides list).
   */
  listRate?: number | null;
  /** Price-level mode applied to baseRate, if any. */
  priceLevelMode?: 'none' | 'discount' | 'increment' | 'fixed' | null;
  /** Fixed GATC fee per unit from Product settings (0 if without stamping). */
  gatcFeePerUnit: number;
  /** Selected GATC entry id; null/undefined = without stamping. */
  gatcStampingPriceId?: string | null;
  /** Snapshot of stamping range label for cart display. */
  gatcStampingRange?: string | null;
  unit: string;
  stockStatus: StockStatus;
  categoryName: string | null;
  categoryId?: string | null;
  hsn?: string | null;
  quantity: number;
}

export type AddCartItemOptions = {
  quantity?: number;
  /** null = without stamping; set to link a GATC fee into the unit rate. */
  gatcStampingPriceId?: string | null;
  gatcFeePerUnit?: number;
  gatcStampingRange?: string | null;
  /** When set, insert the new line immediately after this cart line (sibling stamping). */
  insertAfterCartLineId?: string | null;
  /** Override catalog rate (e.g. dealer price level charge rate). */
  baseRateOverride?: number | null;
  /** List rate to show alongside a discount charge rate. */
  listRate?: number | null;
  priceLevelMode?: 'none' | 'discount' | 'increment' | 'fixed' | null;
};

export function cartItemFromProduct(
  product: CatalogProduct,
  quantity = 1,
  options: Omit<AddCartItemOptions, 'quantity'> = {},
): CartItem {
  const catalogRate = Math.round(Number(product.rate) * 100) / 100;
  const baseRate = options.baseRateOverride != null && Number.isFinite(Number(options.baseRateOverride))
    ? Math.round(Number(options.baseRateOverride) * 100) / 100
    : catalogRate;
  const gatcFeePerUnit = Math.round(Number(options.gatcFeePerUnit ?? 0) * 100) / 100;
  const gatcStampingPriceId = options.gatcStampingPriceId?.trim() || null;
  const priceLevelMode = options.priceLevelMode ?? null;
  const listRate = options.listRate != null && Number.isFinite(Number(options.listRate))
    ? Math.round(Number(options.listRate) * 100) / 100
    : null;
  return {
    cartLineId: newCartLineId(),
    productId: product.id,
    name: product.name,
    sku: product.sku,
    description: product.description?.trim() || null,
    imageUrl: product.imageUrl,
    baseRate,
    listRate,
    priceLevelMode,
    gatcFeePerUnit: gatcStampingPriceId ? gatcFeePerUnit : 0,
    gatcStampingPriceId,
    gatcStampingRange: gatcStampingPriceId
      ? (options.gatcStampingRange?.trim() || null)
      : null,
    rate: combinedCartRate(baseRate, gatcStampingPriceId ? gatcFeePerUnit : 0),
    unit: product.unit,
    stockStatus: effectiveCatalogStockStatus(product.stockStatus, product.hsn),
    categoryName: product.categoryName,
    categoryId: product.categoryId ?? null,
    hsn: product.hsn ?? null,
    quantity,
  };
}
