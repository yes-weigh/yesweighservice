import type { CatalogProduct, StockStatus } from './catalog';

export interface CartItem {
  productId: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  rate: number;
  unit: string;
  stockStatus: StockStatus;
  categoryName: string | null;
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
    stockStatus: product.stockStatus,
    categoryName: product.categoryName,
    quantity,
  };
}
