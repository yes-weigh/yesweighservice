import type { CatalogProduct, StockStatus } from './catalog';
import { effectiveCatalogStockStatus } from '../lib/sacCatalog';

export interface CartItem {
  productId: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  rate: number;
  unit: string;
  stockStatus: StockStatus;
  categoryName: string | null;
  hsn?: string | null;
  quantity: number;
}

export function cartItemFromProduct(product: CatalogProduct, quantity = 1): CartItem {
  return {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    imageUrl: product.imageUrl,
    rate: product.rate,
    unit: product.unit,
    stockStatus: effectiveCatalogStockStatus(product.stockStatus, product.hsn),
    categoryName: product.categoryName,
    hsn: product.hsn ?? null,
    quantity,
  };
}
