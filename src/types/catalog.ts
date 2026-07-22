import type { CatalogProductAuditSnapshot } from './catalog-product-audit';

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

/** Pieces-per-package and physical dimensions — stored in Firestore only (not synced to Zoho). */
export interface CatalogPackageCarton {
  quantity: number | null;
  weightKg: number | null;
  lengthCm: number | null;
  breadthCm: number | null;
  heightCm: number | null;
}

export interface CatalogPackageInfo {
  masterCarton: CatalogPackageCarton | null;
  singleBox: CatalogPackageCarton | null;
  updatedAt?: string | null;
  updatedByUid?: string | null;
  updatedByName?: string | null;
}

/** Extra Zoho gallery image cached in Firebase Storage (non-primary). */
export interface CatalogProductImageDoc {
  documentId: string;
  url: string;
  storagePath: string;
}

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
  /** Ordered gallery including primary; imageUrls[0] matches imageUrl when set. */
  imageUrls?: string[];
  /** Zoho document metadata for non-primary gallery images. */
  imageDocs?: CatalogProductImageDoc[];
  categoryId: string | null;
  categoryName: string | null;
  status: string;
  hsn: string | null;
  taxName: string | null;
  taxPercentage: number;
  reorderLevel?: number;
  syncedAt?: string;
  warehouses?: CatalogWarehouse[];
  /** Firestore-only packaging details (master carton + single box). */
  packageInfo?: CatalogPackageInfo | null;
  /** Latest recorded inventory audit snapshot (Firestore only). */
  auditSnapshot?: CatalogProductAuditSnapshot | null;
  /** Display order within category — Firestore only (not synced to Zoho). */
  displayOrder?: number;
  /**
   * Optional fixed MRP (incl. GST). When set, overrides Product settings equation
   * on share cards and product labels. Firestore only.
   */
  mrpOverride?: number | null;
  /** Selected model number (options from Product settings). Firestore only. */
  modelNumber?: string | null;
  /** Selected approval number (options from Product settings). Firestore only. */
  approvalNumber?: string | null;
  /** Spare group id (options from Product settings). Firestore only — spares only. */
  spareGroupId?: string | null;
  /** Set when SKU changes on Zoho — drives spare-rack yellow/green label status. Firestore only. */
  skuChangedAt?: string | null;
  /** Set when name changes on Zoho — drives spare-rack yellow/green label status. Firestore only. */
  nameChangedAt?: string | null;
  /** SKU on the last printed bin label. Firestore only. */
  binLabelPrintedSku?: string | null;
  /** Name on the last printed bin label. Firestore only. */
  binLabelPrintedName?: string | null;
  binLabelPrintedAt?: string | null;
  /** Super admin — excluded from dealer/public catalogue browse. Firestore only. */
  hiddenFromCatalog?: boolean;
}

export interface CatalogCategory {
  id: string;
  name: string;
  /** Items matching the current browse filters (or all items when no filters). */
  productCount: number;
  /** Unfiltered total — set when filters are active so the UI can show `12 Items (35)`. */
  totalProductCount?: number;
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
