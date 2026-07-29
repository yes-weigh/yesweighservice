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
  /** Fixed GATC fee per unit from Product settings (0 if without stamping). */
  gatcFeePerUnit: number;
  /** Selected GATC entry id; null/undefined = without stamping. */
  gatcStampingPriceId?: string | null;
  /** Snapshot of stamping range label for cart display. */
  gatcStampingRange?: string | null;
  unit: string;
  stockStatus: StockStatus;
  categoryName: string | null;
  hsn?: string | null;
  quantity: number;
}

export type AddCartItemOptions = {
  quantity?: number;
  /** null = without stamping; set to link a GATC fee into the unit rate. */
  gatcStampingPriceId?: string | null;
  gatcFeePerUnit?: number;
  gatcStampingRange?: string | null;
};

export function cartItemFromProduct(
  product: CatalogProduct,
  quantity = 1,
  options: Omit<AddCartItemOptions, 'quantity'> = {},
): CartItem {
  const baseRate = Math.round(Number(product.rate) * 100) / 100;
  const gatcFeePerUnit = Math.round(Number(options.gatcFeePerUnit ?? 0) * 100) / 100;
  const gatcStampingPriceId = options.gatcStampingPriceId?.trim() || null;
  return {
    cartLineId: newCartLineId(),
    productId: product.id,
    name: product.name,
    sku: product.sku,
    description: product.description?.trim() || null,
    imageUrl: product.imageUrl,
    baseRate,
    gatcFeePerUnit: gatcStampingPriceId ? gatcFeePerUnit : 0,
    gatcStampingPriceId,
    gatcStampingRange: gatcStampingPriceId
      ? (options.gatcStampingRange?.trim() || null)
      : null,
    rate: combinedCartRate(baseRate, gatcStampingPriceId ? gatcFeePerUnit : 0),
    unit: product.unit,
    stockStatus: effectiveCatalogStockStatus(product.stockStatus, product.hsn),
    categoryName: product.categoryName,
    hsn: product.hsn ?? null,
    quantity,
  };
}
