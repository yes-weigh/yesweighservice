export interface ZohoCatalogItem {
  id: string;
  name: string;
  sku: string;
  rate: number;
  status: string;
  unit: string;
  type: string;
  description: string;
  categoryId?: string;
  categoryName?: string;
}

export interface ZohoItemCategory {
  id: string;
  name: string;
  description: string;
  status: string;
  unit: string;
  itemCount: number;
  items: ZohoCatalogItem[];
}

export interface ZohoCatalogStats {
  totalItems: number;
  totalCategories: number;
  activeItems: number;
  activeCategories: number;
}

export interface ZohoCatalogResponse {
  organizationId: string;
  syncedAt: string;
  stats: ZohoCatalogStats;
  items: ZohoCatalogItem[];
  categories: ZohoItemCategory[];
}

/** @deprecated Use ZohoItemCategory */
export type ZohoItemGroup = ZohoItemCategory;
