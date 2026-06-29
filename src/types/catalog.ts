export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface CatalogProduct {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string;
  rate: number;
  stock: number;
  stockStatus: StockStatus;
  imageUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: string;
  hsn: string | null;
  taxName: string | null;
  taxPercentage: number;
  reorderLevel?: number;
  syncedAt?: string;
}

export interface CatalogCategory {
  id: string;
  name: string;
  productCount: number;
  displayOrder: number;
  thumbnailUrl: string | null;
}

export interface CatalogStats {
  totalProducts: number;
  totalCategories: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
}

export interface CatalogResponse {
  items: CatalogProduct[];
  categories: CatalogCategory[];
  total: number;
  syncedAt: string | null;
  stats: CatalogStats;
}

export interface CatalogWarehouse {
  warehouseId: string;
  warehouseName: string;
  stock: number;
}

export interface CatalogProductDetail extends CatalogProduct {
  preferredVendor: string | null;
  warehouses: CatalogWarehouse[];
}
