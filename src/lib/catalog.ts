import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { app, db } from '../firebase';
import { compressImageForUpload } from './compressImage';
import type {
  CatalogCategory,
  CatalogPackageCarton,
  CatalogPackageInfo,
  CatalogProduct,
  CatalogProductDetail,
  CatalogResponse,
  CatalogStats,
} from '../types/catalog';
import { mapAuditSnapshot } from './catalogProductAudit/data';
import { resolveAdjustedAuditDisplay } from './catalogProductAudit/display';

const functions = getFunctions(app, 'asia-south1');

export interface CatalogFilters {
  search?: string;
  category?: string;
  stockStatus?: string;
}

const HIDDEN_CATEGORY_NAMES = new Set(['stamping gj', 'stamping kl', 'software keys', 'inactive']);

/** Replaced product images keep the same Storage path with a long cache TTL — bust with syncedAt. */
export function withCatalogImageCacheBust(
  url: string | null | undefined,
  version?: string | number | null,
): string | null {
  if (!url) return null;
  const v = version ?? null;
  if (!v) return url;
  const qIndex = url.indexOf('?');
  const base = qIndex === -1 ? url : url.slice(0, qIndex);
  const params = new URLSearchParams(qIndex === -1 ? '' : url.slice(qIndex + 1));
  params.set('v', String(v));
  return `${base}?${params.toString()}`;
}

const SPARES_EXCLUDED_CATEGORY_NAMES = new Set(['software keys', 'sanoft']);

/** Categories excluded from the browse grid (still in catalog data). */
export function isHiddenCatalogCategory(category: Pick<CatalogCategory, 'name'>): boolean {
  return HIDDEN_CATEGORY_NAMES.has(category.name.trim().toLowerCase());
}

/** Products in hidden categories — excluded from dealer catalogue browse and search. */
export function isHiddenCatalogProduct(
  product: Pick<CatalogProduct, 'categoryId' | 'categoryName'>,
  categories: CatalogCategory[] = [],
): boolean {
  if (product.categoryName && isHiddenCatalogCategory({ name: product.categoryName })) {
    return true;
  }
  if (product.categoryId) {
    const cat = categories.find(c => c.id === product.categoryId);
    if (cat && isHiddenCatalogCategory(cat)) return true;
  }
  return false;
}

export function excludeHiddenCatalogProducts(
  products: CatalogProduct[],
  categories: CatalogCategory[] = [],
): CatalogProduct[] {
  return products.filter(p => !isHiddenCatalogProduct(p, categories));
}

/** Zoho category that holds generic spare parts (not shop product categories). */
export function isGenericSparePartsCategory(category: Pick<CatalogCategory, 'name'>): boolean {
  const name = category.name.trim().toLowerCase();
  return (
    name === 'generic spare parts'
    || name === 'generic spares'
    || name.includes('generic spare')
  );
}

/** True when a Zoho item belongs on the Spare parts tab (not shop Categories). */
export function isCatalogSparePartProduct(
  product: Pick<CatalogProduct, 'categoryId' | 'categoryName'>,
  categories: CatalogCategory[] = [],
): boolean {
  const genericCategoryIds = new Set(
    categories.filter(isGenericSparePartsCategory).map(c => c.id),
  );
  if (!hasCatalogCategory(product)) return true;
  if (product.categoryId && genericCategoryIds.has(product.categoryId)) return true;
  if (product.categoryName && isGenericSparePartsCategory({ name: product.categoryName })) {
    return true;
  }
  return false;
}

/** Spare parts tab — Generic spare parts category and uncategorized Zoho items only. */
export function getCatalogSparePartsPool(
  products: CatalogProduct[],
  categories: CatalogCategory[] = [],
): CatalogProduct[] {
  return excludeHiddenCatalogProducts(
    products.filter(product => isCatalogSparePartProduct(product, categories)),
    categories,
  );
}

/** Spare pool for product↔spare linking (uncategorized + generic spare parts). */
export function getSparesForSpareMapping(
  products: CatalogProduct[],
  categories: CatalogCategory[] = [],
): CatalogProduct[] {
  return getCatalogSparePartsPool(products, categories);
}

/** Finished-goods pool for product↔spare linking (shop products, excluding SANOFT etc.). */
export function getFinishedGoodsForSpareMapping(
  products: CatalogProduct[],
  categories: CatalogCategory[] = [],
): CatalogProduct[] {
  return getShopCatalogProducts(products, categories).filter(product => {
    const category = categories.find(cat => cat.id === product.categoryId);
    return !category || !isSparesExcludedCategory(category);
  });
}

/** Categories hidden on Spares → By product (software keys / SANOFT). */
export function isSparesExcludedCategory(category: Pick<CatalogCategory, 'name'>): boolean {
  return SPARES_EXCLUDED_CATEGORY_NAMES.has(category.name.trim().toLowerCase());
}

/** Product synced with a Zoho item category (has categoryId, excluding ROOT -1). */
export function hasCatalogCategory(product: Pick<CatalogProduct, 'categoryId'>): boolean {
  const id = product.categoryId?.trim();
  return Boolean(id && id !== '-1');
}

/** Active products assigned to a Zoho category — shown on Products. */
export function getCategorizedProducts(products: CatalogProduct[]): CatalogProduct[] {
  return products.filter(hasCatalogCategory);
}

/** Shop / Categories catalog — categorized items excluding the spare-parts pool. */
export function getShopCatalogProducts(
  products: CatalogProduct[],
  categories: CatalogCategory[] = [],
): CatalogProduct[] {
  return products.filter(
    p => hasCatalogCategory(p) && !isCatalogSparePartProduct(p, categories),
  );
}

export const SPARE_WAREHOUSE_LOCATION_FILTERS = [
  { key: 'cochin', label: 'Cochin', warehouseName: 'Cochin' },
  { key: 'headOffice', label: 'Head Office', warehouseName: 'Head Office' },
] as const;

export type SpareWarehouseLocationFilter = typeof SPARE_WAREHOUSE_LOCATION_FILTERS[number]['key'];

export const SPARE_AUDIT_STATUS_FILTERS = [
  { key: 'audited', label: 'Audited' },
  { key: 'notAudited', label: 'Not audited' },
  { key: 'zeroVariance', label: 'Matched' },
  { key: 'overage', label: 'More' },
  { key: 'shortage', label: 'Shortage' },
] as const;

export type SpareAuditStatusFilter = typeof SPARE_AUDIT_STATUS_FILTERS[number]['key'];

export const SPARE_STOCK_STATUS_FILTERS = [
  { key: 'withStock', label: 'With stock' },
  { key: 'zeroStock', label: 'Zero stock' },
  { key: 'negativeStock', label: 'Negative stock' },
] as const;

export type SpareStockStatusFilter = typeof SPARE_STOCK_STATUS_FILTERS[number]['key'];

export const SPARE_CATALOG_FILTERS = [
  { key: 'unmapped', label: 'Unmapped' },
  { key: 'mapped', label: 'Mapped' },
  { key: 'withImage', label: 'With image' },
  { key: 'missingImage', label: 'Missing image' },
] as const;

export type SpareCatalogFilter = typeof SPARE_CATALOG_FILTERS[number]['key'];

export const CATEGORIZED_PRODUCT_FILTERS = [
  { key: 'spareMapped', label: 'Spare mapped' },
  { key: 'spareNotMapped', label: 'Spare not mapped' },
  { key: 'withImage', label: 'Image' },
  { key: 'missingImage', label: 'Without' },
] as const;

export type CategorizedProductFilter = typeof CATEGORIZED_PRODUCT_FILTERS[number]['key'];

/** Media-role catalog filters (product image + Firebase media gallery). */
export const MEDIA_PRODUCT_FILTERS = [
  { key: 'withImage', label: 'Has product image' },
  { key: 'missingImage', label: 'Missing product image' },
  { key: 'withMedia', label: 'Has media files' },
  { key: 'missingMedia', label: 'Missing media files' },
] as const;

export type MediaProductFilter = typeof MEDIA_PRODUCT_FILTERS[number]['key'];

export function matchesMediaProductFilters(
  product: Pick<CatalogProduct, 'id' | 'imageUrl'>,
  filters: ReadonlySet<MediaProductFilter>,
  productIdsWithMedia: ReadonlySet<string>,
): boolean {
  if (filters.size === 0) return true;
  const hasImage = catalogProductHasImage(product);
  const hasMedia = productIdsWithMedia.has(product.id);
  if (filters.has('withImage') && !hasImage) return false;
  if (filters.has('missingImage') && hasImage) return false;
  if (filters.has('withMedia') && !hasMedia) return false;
  if (filters.has('missingMedia') && hasMedia) return false;
  return true;
}

export const NC_STATUS_FILTERS = [
  { key: 'hasNc', label: 'Has NC' },
  { key: 'noNc', label: 'No NC' },
] as const;

export type NcStatusFilter = typeof NC_STATUS_FILTERS[number]['key'];

export function matchesNcStatusFilters(
  product: Pick<CatalogProduct, 'id'>,
  filters: ReadonlySet<NcStatusFilter>,
  openNcQtyByProductId: ReadonlyMap<string, number>,
): boolean {
  if (filters.size === 0) return true;
  const qty = openNcQtyByProductId.get(product.id) ?? 0;
  const hasNc = qty > 0;
  return (
    (filters.has('hasNc') && hasNc)
    || (filters.has('noNc') && !hasNc)
  );
}

export function matchesSpareCatalogFilters(
  product: CatalogProduct,
  filters: ReadonlySet<SpareCatalogFilter>,
  linkedSpareIds: Set<string>,
): boolean {
  if (filters.size === 0) return true;
  if (filters.has('unmapped') && linkedSpareIds.has(product.id)) return false;
  if (filters.has('mapped') && !linkedSpareIds.has(product.id)) return false;
  if (filters.has('withImage') && !catalogProductHasImage(product)) return false;
  if (filters.has('missingImage') && catalogProductHasImage(product)) return false;
  return true;
}

export function matchesCategorizedProductFilters(
  product: CatalogProduct,
  filters: ReadonlySet<CategorizedProductFilter>,
  spareCountByProductId: ReadonlyMap<string, number>,
): boolean {
  if (filters.size === 0) return true;
  const spareCount = spareCountByProductId.get(product.id) ?? 0;
  const hasLinkedSpares = spareCount > 0;
  if (filters.has('spareMapped') && !hasLinkedSpares) return false;
  if (filters.has('spareNotMapped') && hasLinkedSpares) return false;
  if (filters.has('withImage') && !catalogProductHasImage(product)) return false;
  if (filters.has('missingImage') && catalogProductHasImage(product)) return false;
  return true;
}

export function matchesSpareLocationFilters(
  product: Pick<CatalogProduct, 'warehouses'>,
  filters: ReadonlySet<SpareWarehouseLocationFilter>,
): boolean {
  if (filters.size === 0) return true;
  return SPARE_WAREHOUSE_LOCATION_FILTERS.some(
    option => filters.has(option.key) && catalogProductHasWarehouseStock(product, option.warehouseName),
  );
}

export function catalogProductHasPositiveStock(product: Pick<CatalogProduct, 'stock'>): boolean {
  return product.stock > 0;
}

export function catalogProductHasZeroStock(product: Pick<CatalogProduct, 'stock'>): boolean {
  return product.stock === 0;
}

export function catalogProductHasNegativeStock(product: Pick<CatalogProduct, 'stock'>): boolean {
  return product.stock < 0;
}

export function matchesSpareStockStatusFilters(
  product: Pick<CatalogProduct, 'stock'>,
  filters: ReadonlySet<SpareStockStatusFilter>,
): boolean {
  if (filters.size === 0) return true;
  return (
    (filters.has('withStock') && catalogProductHasPositiveStock(product))
    || (filters.has('zeroStock') && catalogProductHasZeroStock(product))
    || (filters.has('negativeStock') && catalogProductHasNegativeStock(product))
  );
}

/** Head Office store-room audits — Yes Store bins linked to a catalog product. */
export function buildHeadOfficeAuditedCatalogProductIds(
  auditItems: ReadonlyArray<{ catalogProductId?: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const item of auditItems) {
    const id = item.catalogProductId?.trim();
    if (id) ids.add(id);
  }
  return ids;
}

/** @deprecated Prefer buildHeadOfficeAuditedCatalogProductIds */
export function buildAuditedCatalogProductIds(
  auditItems: ReadonlyArray<{ catalogProductId?: string | null }>,
): Set<string> {
  return buildHeadOfficeAuditedCatalogProductIds(auditItems);
}

/** Cochin warehouse audits — catalogSiteInventory records for site `cochin`. */
export function buildCochinAuditedCatalogProductIds(
  records: ReadonlyArray<{ catalogProductId?: string | null; site?: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    if (record.site && record.site !== 'cochin') continue;
    const id = record.catalogProductId?.trim();
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Audited means:
 * - Generic spare parts → Head Office store room (Yes Store bins)
 * - All other categorized products → Cochin warehouse (site inventory)
 */
export function catalogProductIsAudited(
  product: Pick<CatalogProduct, 'id' | 'categoryId' | 'categoryName'>,
  categories: CatalogCategory[],
  headOfficeAuditedIds: ReadonlySet<string>,
  cochinAuditedIds: ReadonlySet<string>,
): boolean {
  if (isCatalogSparePartProduct(product, categories)) {
    return headOfficeAuditedIds.has(product.id);
  }
  return cochinAuditedIds.has(product.id);
}

/** Audit vs book stock variance from the locked last-audit Diff. */
export function catalogProductAuditVariance(
  product: Pick<CatalogProduct, 'stock' | 'auditSnapshot'>,
): 'zero' | 'overage' | 'shortage' | null {
  const adjusted = resolveAdjustedAuditDisplay({
    currentZohoQty: product.stock,
    snapshot: product.auditSnapshot ?? null,
    livePhysicalQty: null,
  });
  if (!adjusted.hasAuditSnapshot || adjusted.displayDifference == null) return null;
  if (adjusted.displayDifference === 0) return 'zero';
  if (adjusted.displayDifference > 0) return 'overage';
  return 'shortage';
}

export function matchesSpareAuditStatusFilters(
  product: Pick<CatalogProduct, 'id' | 'categoryId' | 'categoryName' | 'stock' | 'auditSnapshot'>,
  filters: ReadonlySet<SpareAuditStatusFilter>,
  categories: CatalogCategory[],
  headOfficeAuditedIds: ReadonlySet<string>,
  cochinAuditedIds: ReadonlySet<string>,
): boolean {
  if (filters.size === 0) return true;
  const isAudited = catalogProductIsAudited(
    product,
    categories,
    headOfficeAuditedIds,
    cochinAuditedIds,
  );
  const variance = catalogProductAuditVariance(product);
  return (
    (filters.has('audited') && isAudited)
    || (filters.has('notAudited') && !isAudited)
    || (filters.has('zeroVariance') && variance === 'zero')
    || (filters.has('overage') && variance === 'overage')
    || (filters.has('shortage') && variance === 'shortage')
  );
}

export function catalogProductHasImage(product: Pick<CatalogProduct, 'imageUrl'>): boolean {
  return Boolean(product.imageUrl?.trim());
}

export function catalogProductWarehouseStock(
  product: Pick<CatalogProduct, 'warehouses'>,
  warehouseName: string,
): number {
  const target = warehouseName.trim().toLowerCase();
  const match = (product.warehouses ?? []).find(
    w => w.warehouseName.trim().toLowerCase() === target,
  );
  return match?.stock ?? 0;
}

export function catalogProductHasWarehouseStock(
  product: Pick<CatalogProduct, 'warehouses'>,
  warehouseName: string,
): boolean {
  return catalogProductWarehouseStock(product, warehouseName) > 0;
}

/** Zoho uncategorized items (no category_id) — shown on Spares. */
export function getUncategorizedProducts(products: CatalogProduct[]): CatalogProduct[] {
  return products.filter(p => !hasCatalogCategory(p));
}

/** Spare link data from catalogProductSpareMap. */
export interface SpareLinkIndex {
  linkedSpareIds: Set<string>;
  spareCountByProductId: Map<string, number>;
}

export async function fetchSpareLinkIndex(): Promise<SpareLinkIndex> {
  const snap = await getDocs(collection(db, 'catalogProductSpareMap'));
  const linkedSpareIds = new Set<string>();
  const spareCountByProductId = new Map<string, number>();
  for (const docSnap of snap.docs) {
    const spareIds = docSnap.data().spareIds;
    if (!Array.isArray(spareIds)) continue;
    const valid = spareIds.filter(id => id).map(String);
    spareCountByProductId.set(docSnap.id, valid.length);
    for (const id of valid) linkedSpareIds.add(id);
  }
  return { linkedSpareIds, spareCountByProductId };
}

/** Spare IDs referenced in any product spare map. */
export async function fetchLinkedSpareIds(): Promise<Set<string>> {
  const { linkedSpareIds } = await fetchSpareLinkIndex();
  return linkedSpareIds;
}

/** Spare-parts pool items not mapped to any finished good. */
export function getUnlinkedSpares(
  products: CatalogProduct[],
  linkedSpareIds: Set<string>,
  categories: CatalogCategory[] = [],
): CatalogProduct[] {
  return getCatalogSparePartsPool(products, categories).filter(
    p => !linkedSpareIds.has(p.id),
  );
}

export function getCategoriesForProducts(
  categories: CatalogCategory[],
  products: CatalogProduct[],
): CatalogCategory[] {
  const ids = new Set(products.map(p => p.categoryId).filter(Boolean) as string[]);
  return categories.filter(c => ids.has(c.id));
}

function countProductsByCategoryId(products: CatalogProduct[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const product of products) {
    if (!product.categoryId) continue;
    counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
  }
  return counts;
}

export interface ShopCatalogCategoryOptions {
  /** When set, category cards use these counts and keep unfiltered totals in brackets. */
  filteredShopProducts?: CatalogProduct[];
  filteredSpareProducts?: CatalogProduct[];
}

/** Categories grid for shop browse — includes Generic spare parts for staff catalog views. */
export function getShopCatalogCategories(
  categories: CatalogCategory[],
  shopProducts: CatalogProduct[],
  spareProducts: CatalogProduct[],
  options: ShopCatalogCategoryOptions = {},
): CatalogCategory[] {
  const filteredShop = options.filteredShopProducts ?? shopProducts;
  const filteredSpare = options.filteredSpareProducts ?? spareProducts;
  const filtersActive =
    options.filteredShopProducts != null
    || options.filteredSpareProducts != null;

  const totalShopCounts = countProductsByCategoryId(shopProducts);
  const filteredShopCounts = countProductsByCategoryId(filteredShop);

  const fromShop = getCategoriesForProducts(categories, shopProducts)
    .map(cat => {
      const totalProductCount = totalShopCounts.get(cat.id) ?? 0;
      const productCount = filteredShopCounts.get(cat.id) ?? 0;
      if (filtersActive && productCount <= 0) return null;
      return {
        ...cat,
        productCount,
        ...(filtersActive ? { totalProductCount } : {}),
      };
    })
    .filter((c): c is CatalogCategory => c !== null);
  const included = new Set(fromShop.map(c => c.id));

  // Categories tab: Generic Spare Parts card counts only items in that Zoho category
  // (uncategorized stay on the Spare parts tab, not here).
  const countGenericCategoryProducts = (list: CatalogProduct[], categoryId: string) =>
    list.filter(p => p.categoryId === categoryId).length;

  const genericSpareCategories = categories
    .filter(c => isGenericSparePartsCategory(c) && !included.has(c.id))
    .map(cat => {
      const totalProductCount = countGenericCategoryProducts(spareProducts, cat.id);
      const productCount = countGenericCategoryProducts(filteredSpare, cat.id);
      if (productCount <= 0) return null;
      return {
        ...cat,
        productCount,
        ...(filtersActive ? { totalProductCount } : {}),
      };
    })
    .filter((c): c is CatalogCategory => c !== null);

  return [...fromShop, ...genericSpareCategories];
}

/** Products shown when drilling into a category from the shop browse grid. */
export function getBrowseCatalogProducts(
  shopProducts: CatalogProduct[],
  spareProducts: CatalogProduct[],
  categories: CatalogCategory[],
  activeCategoryId: string,
): CatalogProduct[] {
  if (!activeCategoryId) return shopProducts;
  const activeCategory = categories.find(c => c.id === activeCategoryId);
  if (!activeCategory || !isGenericSparePartsCategory(activeCategory)) return shopProducts;
  // Categories tab: only items actually in the Generic Spare Parts Zoho category.
  return spareProducts.filter(p => p.categoryId === activeCategoryId);
}

function catalogErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = 'code' in err ? String((err as { code: string }).code) : '';
    const message = 'message' in err ? String((err as { message: string }).message).trim() : '';

    if (code === 'functions/deadline-exceeded' || message.includes('deadline-exceeded')) {
      return 'Catalog sync timed out. Deploy the latest functions and try again — sync should finish in under a minute.';
    }

    const isMissingFunction =
      code === 'functions/not-found'
      || /not[- ]found/i.test(message)
      || message.includes('Failed to fetch')
      || message.includes('CORS');

    if (isMissingFunction) {
      return 'Cloud Function not deployed yet. Run: firebase deploy --only functions';
    }

    if (message) return message;
  }
  return 'Unable to load product catalog.';
}

function mapWarehouse(data: unknown): CatalogProduct['warehouses'] {
  if (!Array.isArray(data)) return undefined;
  return data
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const warehouseName = String(row.warehouseName ?? '').trim();
      if (!warehouseName) return null;
      return {
        warehouseId: String(row.warehouseId ?? ''),
        warehouseName,
        stock: Number(row.stock ?? 0),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

function mapPackageCarton(data: unknown): CatalogPackageCarton | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const quantity = row.quantity != null ? Number(row.quantity) : null;
  const weightKg = row.weightKg != null ? Number(row.weightKg) : null;
  const lengthCm = row.lengthCm != null ? Number(row.lengthCm) : null;
  const breadthCm = row.breadthCm != null ? Number(row.breadthCm) : null;
  const heightCm = row.heightCm != null ? Number(row.heightCm) : null;
  const hasValue = [quantity, weightKg, lengthCm, breadthCm, heightCm].some(
    v => v != null && Number.isFinite(v),
  );
  if (!hasValue) return null;
  return {
    quantity: Number.isFinite(quantity) ? quantity : null,
    weightKg: Number.isFinite(weightKg) ? weightKg : null,
    lengthCm: Number.isFinite(lengthCm) ? lengthCm : null,
    breadthCm: Number.isFinite(breadthCm) ? breadthCm : null,
    heightCm: Number.isFinite(heightCm) ? heightCm : null,
  };
}

function mapPackageInfo(data: unknown): CatalogPackageInfo | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const masterCarton = mapPackageCarton(row.masterCarton);
  const singleBox = mapPackageCarton(row.singleBox);
  if (!masterCarton && !singleBox) return null;
  return {
    masterCarton,
    singleBox,
    updatedAt: (row.updatedAt as string | null) ?? null,
    updatedByUid: (row.updatedByUid as string | null) ?? null,
    updatedByName: (row.updatedByName as string | null) ?? null,
  };
}

function mapImageDocs(data: unknown): CatalogProduct['imageDocs'] {
  if (!Array.isArray(data)) return undefined;
  const docs = data
    .map(row => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const documentId = String(item.documentId ?? '').trim();
      const url = String(item.url ?? '').trim();
      const storagePath = String(item.storagePath ?? '').trim();
      if (!documentId || !url || !storagePath) return null;
      return { documentId, url, storagePath };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  return docs.length ? docs : undefined;
}

function mapProductImageUrls(
  data: Record<string, unknown>,
  primaryUrl: string | null,
  syncedAt: string | undefined,
): string[] | undefined {
  const docs = mapImageDocs(data.imageDocs);
  if (Array.isArray(data.imageUrls)) {
    const urls = data.imageUrls
      .map(url => withCatalogImageCacheBust(String(url ?? '').trim() || null, syncedAt))
      .filter((url): url is string => Boolean(url));
    if (urls.length) return urls;
  }
  if (primaryUrl) {
    const gallery = (docs ?? []).map(doc => withCatalogImageCacheBust(doc.url, syncedAt) ?? doc.url);
    return [primaryUrl, ...gallery.filter(url => url !== primaryUrl)];
  }
  if (docs?.length) {
    return docs.map(doc => withCatalogImageCacheBust(doc.url, syncedAt) ?? doc.url);
  }
  return undefined;
}

function mapProduct(data: Record<string, unknown>): CatalogProduct {
  const syncedAt = data.syncedAt as string | undefined;
  const rawImageUrl = (data.imageUrl as string | null) ?? null;
  const imageUrl = withCatalogImageCacheBust(rawImageUrl, syncedAt);
  const imageDocs = mapImageDocs(data.imageDocs);
  const imageUrls = mapProductImageUrls(data, imageUrl, syncedAt);
  const warehouses = mapWarehouse(data.warehouses);
  const packageInfo = mapPackageInfo(data.packageInfo);
  const auditSnapshot = mapAuditSnapshot(data.auditSnapshot);
  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    sku: (data.sku as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    unit: String(data.unit ?? 'pcs'),
    rate: Number(data.rate ?? 0),
    stock: Number(data.stock ?? 0),
    stockStatus: (data.stockStatus as CatalogProduct['stockStatus']) ?? 'out_of_stock',
    imageUrl,
    ...(imageUrls?.length ? { imageUrls } : {}),
    ...(imageDocs?.length ? { imageDocs } : {}),
    categoryId: (data.categoryId as string | null) ?? null,
    categoryName: (data.categoryName as string | null) ?? null,
    status: String(data.status ?? 'active'),
    hsn: (data.hsn as string | null) ?? null,
    taxName: (data.taxName as string | null) ?? null,
    taxPercentage: Number(data.taxPercentage ?? 0),
    reorderLevel: Number(data.reorderLevel ?? 0),
    syncedAt,
    ...(warehouses?.length ? { warehouses } : {}),
    ...(packageInfo ? { packageInfo } : {}),
    ...(auditSnapshot ? { auditSnapshot } : {}),
    displayOrder: Number.isFinite(Number(data.displayOrder))
      ? Number(data.displayOrder)
      : 999,
    ...(Number.isFinite(Number(data.mrpOverride)) && Number(data.mrpOverride) > 0
      ? { mrpOverride: Math.round(Number(data.mrpOverride) * 100) / 100 }
      : {}),
    ...(typeof data.modelNumber === 'string' && data.modelNumber.trim()
      ? { modelNumber: data.modelNumber.trim() }
      : {}),
    ...(typeof data.approvalNumber === 'string' && data.approvalNumber.trim()
      ? { approvalNumber: data.approvalNumber.trim() }
      : {}),
  };
}

/** Sort products within a category — custom order first, then name. */
export function compareCatalogProductsInCategory(
  a: CatalogProduct,
  b: CatalogProduct,
): number {
  const orderDiff = (a.displayOrder ?? 999) - (b.displayOrder ?? 999);
  if (orderDiff !== 0) return orderDiff;
  return a.name.localeCompare(b.name);
}

export function applyCategoryProductDisplayOrder(
  items: CatalogProduct[],
  categoryId: string,
  orderById: Map<string, number>,
): CatalogProduct[] {
  return items.map(item => {
    if (item.categoryId !== categoryId) return item;
    const order = orderById.get(item.id);
    return order !== undefined ? { ...item, displayOrder: order } : item;
  });
}

function mapCategory(data: Record<string, unknown>): CatalogCategory {
  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    productCount: Number(data.productCount ?? 0),
    displayOrder: Number(data.displayOrder ?? 999),
    thumbnailUrl: (data.thumbnailUrl as string | null) ?? null,
  };
}

function filterItems(items: CatalogProduct[], filters: CatalogFilters): CatalogProduct[] {
  let filtered = items;

  if (filters.search?.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter(item =>
      item.name.toLowerCase().includes(q)
      || (item.sku ?? '').toLowerCase().includes(q)
      || (item.categoryName ?? '').toLowerCase().includes(q),
    );
  }

  if (filters.category) {
    filtered = filtered.filter(item => item.categoryId === filters.category);
  }

  if (filters.stockStatus) {
    filtered = filtered.filter(item => item.stockStatus === filters.stockStatus);
  }

  return filtered;
}

function buildStats(items: CatalogProduct[], categories: CatalogCategory[]): CatalogStats {
  return {
    totalProducts: items.length,
    totalCategories: categories.length,
    inStock: items.filter(i => i.stockStatus === 'in_stock').length,
    lowStock: items.filter(i => i.stockStatus === 'low_stock').length,
    outOfStock: items.filter(i => i.stockStatus === 'out_of_stock').length,
  };
}

/** Build categories from product category fields when catalogCategories is empty or stale. */
function deriveCategoriesFromProducts(
  products: CatalogProduct[],
  stored: CatalogCategory[],
): CatalogCategory[] {
  const storedMap = new Map(stored.map(cat => [cat.id, cat]));
  const derived = new Map<string, CatalogCategory>();

  for (const product of products) {
    if (!hasCatalogCategory(product)) continue;
    const categoryId = product.categoryId as string;
    const existing = derived.get(categoryId);
    if (!existing) {
      derived.set(categoryId, {
        id: categoryId,
        name: product.categoryName || 'Category',
        productCount: 1,
        displayOrder: storedMap.get(categoryId)?.displayOrder ?? 999,
        thumbnailUrl: storedMap.get(categoryId)?.thumbnailUrl ?? null,
      });
    } else {
      existing.productCount += 1;
      if (product.categoryName) existing.name = product.categoryName;
    }
    const cat = derived.get(categoryId);
    if (cat && !cat.thumbnailUrl && product.imageUrl) {
      cat.thumbnailUrl = product.imageUrl;
    }
  }

  return [...derived.values()]
    .map(cat => {
      const prev = storedMap.get(cat.id);
      return {
        ...cat,
        thumbnailUrl: prev?.thumbnailUrl || cat.thumbnailUrl,
        displayOrder: prev?.displayOrder ?? cat.displayOrder,
      };
    })
    .filter(cat => cat.id && cat.productCount > 0)
    .sort((a, b) => {
      const orderDiff = a.displayOrder - b.displayOrder;
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });
}

/** Read cached catalog from Firestore (no Cloud Function — avoids callable/CORS issues). */
export async function fetchCatalog(filters: CatalogFilters = {}): Promise<CatalogResponse> {
  try {
    const [productsSnap, categoriesSnap, metaSnap] = await Promise.all([
      getDocs(query(collection(db, 'catalogProducts'), where('status', '==', 'active'))),
      getDocs(collection(db, 'catalogCategories')),
      getDoc(doc(db, 'catalogMeta', 'sync')),
    ]);

    const allItems = productsSnap.docs
      .map(snap => mapProduct(snap.data() as Record<string, unknown>))
      .sort((a, b) => a.name.localeCompare(b.name));

    const storedCategories = categoriesSnap.docs
      .map(snap => mapCategory(snap.data() as Record<string, unknown>))
      .filter(cat => cat.id);

    const categories = deriveCategoriesFromProducts(allItems, storedCategories);

    const items = filterItems(allItems, filters);
    const meta = metaSnap.exists() ? metaSnap.data() : null;

    return {
      items,
      categories,
      total: items.length,
      syncedAt: (meta?.lastSyncAt as string | null) ?? null,
      stats: buildStats(allItems, categories),
    };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** All synced Zoho items (active + inactive) for SKU audit / correction tools. */
export async function fetchAllCatalogProductsForSkuCorrection(): Promise<CatalogProduct[]> {
  try {
    const snap = await getDocs(collection(db, 'catalogProducts'));
    return snap.docs
      .map(docSnap => mapProduct(docSnap.data() as Record<string, unknown>))
      .sort((a, b) => {
        const skuA = (a.sku ?? '').localeCompare(b.sku ?? '', undefined, { sensitivity: 'base' });
        if (skuA !== 0) return skuA;
        return a.name.localeCompare(b.name);
      });
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** SKU has anything other than uppercase A–Z and digits 0–9 (incl. lowercase, spaces, symbols). */
export function skuHasNonUppercaseAlphanumericChars(sku: string | null | undefined): boolean {
  const value = String(sku ?? '');
  if (value === '') return false;
  return /[^0-9A-Z]/.test(value);
}

/** Uppercase and strip everything except 0-9 / A-Z. */
export function sanitizeSkuToUppercaseAlphanumeric(sku: string | null | undefined): string {
  return String(sku ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * Suggested corrected SKUs for invalid items: sanitize to 0-9A-Z, then append 2, 3, …
 * when the result would collide with an existing catalog SKU or another proposal.
 * Returns map of productId → proposed SKU.
 */
export function proposeCorrectedSkus(allProducts: CatalogProduct[]): Map<string, string> {
  const reserved = new Set<string>();
  for (const product of allProducts) {
    const sku = product.sku ?? '';
    if (sku) reserved.add(sku);
  }

  const invalid = allProducts
    .filter(product => skuHasNonUppercaseAlphanumericChars(product.sku))
    .sort((a, b) => {
      const skuCmp = (a.sku ?? '').localeCompare(b.sku ?? '', undefined, { sensitivity: 'base' });
      if (skuCmp !== 0) return skuCmp;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });

  const proposals = new Map<string, string>();
  for (const product of invalid) {
    const base = sanitizeSkuToUppercaseAlphanumeric(product.sku) || 'SKU';
    let candidate = base;
    if (reserved.has(candidate)) {
      let n = 2;
      while (reserved.has(`${base}${n}`)) n += 1;
      candidate = `${base}${n}`;
    }
    reserved.add(candidate);
    proposals.set(product.id, candidate);
  }
  return proposals;
}

/** @deprecated Use skuHasNonUppercaseAlphanumericChars */
export function skuHasSpaceOrHyphen(sku: string | null | undefined): boolean {
  return skuHasNonUppercaseAlphanumericChars(sku);
}

/** Groups products that share the same exact SKU string (blank SKUs grouped together). */
export function groupCatalogProductsByDuplicateSku(
  products: CatalogProduct[],
): Map<string, CatalogProduct[]> {
  const groups = new Map<string, CatalogProduct[]>();
  for (const product of products) {
    const key = product.sku ?? '';
    const list = groups.get(key);
    if (list) list.push(product);
    else groups.set(key, [product]);
  }
  for (const [key, list] of [...groups.entries()]) {
    if (list.length < 2) groups.delete(key);
  }
  return groups;
}

export interface CatalogSkuRepairResult {
  total: number;
  updatedCount: number;
  failedCount: number;
  skippedCount?: number;
  rateLimited?: boolean;
  updated: Array<{ productId: string; oldSku: string | null; newSku: string }>;
  failed: Array<{ productId: string; oldSku: string | null; newSku: string; error: string }>;
  skipped?: Array<{ productId: string; oldSku: string | null; newSku: string; error: string }>;
}

/** Apply all Invalid-chars SKU repairs on Zoho + Firestore (super admin). */
export async function applyCatalogSkuRepairs(): Promise<CatalogSkuRepairResult> {
  const callable = httpsCallable<Record<string, never>, CatalogSkuRepairResult>(
    functions,
    'applyCatalogSkuRepairs',
    { timeout: 540_000 },
  );
  try {
    const result = await callable({});
    return result.data;
  } catch (err) {
    if (err && typeof err === 'object') {
      const code = 'code' in err ? String((err as { code: string }).code) : '';
      const message = 'message' in err ? String((err as { message: string }).message) : '';
      if (code === 'functions/deadline-exceeded' || message.includes('deadline-exceeded')) {
        throw new Error(
          'SKU repair timed out. Wait a minute, refresh the list, then run Apply again for any remaining invalid SKUs.',
        );
      }
    }
    throw new Error(catalogErrorMessage(err));
  }
}

export async function fetchCatalogProductDetail(productId: string): Promise<CatalogProductDetail> {
  const callable = httpsCallable<{ productId: string }, CatalogProductDetail>(
    functions,
    'getCatalogProductDetail',
  );
  try {
    const result = await callable({ productId });
    const detail = result.data;
    return {
      ...detail,
      imageUrl: withCatalogImageCacheBust(detail.imageUrl, detail.syncedAt),
    };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

async function fileToBase64(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image must be 5 MB or smaller.');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read image file.'));
        return;
      }
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('Could not read image file.'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

export async function saveCatalogCategoryOrder(
  categories: Array<{ id: string; name: string; displayOrder: number }>,
): Promise<void> {
  const callable = httpsCallable<
    { categories: Array<{ id: string; name: string; displayOrder: number }> },
    { ok: boolean }
  >(functions, 'saveCatalogCategoryOrder');
  try {
    await callable({ categories });
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export async function saveCatalogCategoryProductOrder(
  categoryId: string,
  products: Array<{ id: string; displayOrder: number }>,
): Promise<void> {
  const callable = httpsCallable<
    { categoryId: string; products: Array<{ id: string; displayOrder: number }> },
    { ok: boolean }
  >(functions, 'saveCatalogCategoryProductOrder');
  try {
    await callable({ categoryId, products });
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export async function uploadCatalogCategoryThumbnail(
  categoryId: string,
  categoryName: string,
  file: File,
): Promise<string> {
  const callable = httpsCallable<
    { categoryId: string; categoryName: string; contentType: string; imageBase64: string },
    { thumbnailUrl: string }
  >(functions, 'uploadCatalogCategoryThumbnail', { timeout: 120_000 });

  try {
    const compressed = await compressImageForUpload(file);
    const imageBase64 = await fileToBase64(compressed);
    const result = await callable({
      categoryId,
      categoryName,
      contentType: compressed.type || 'image/jpeg',
      imageBase64,
    });
    return withCatalogImageCacheBust(result.data.thumbnailUrl, Date.now()) ?? result.data.thumbnailUrl;
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** Zoho + Firestore cache — replace primary or append gallery image. */
export async function uploadCatalogProductImage(
  productId: string,
  file: File,
  mode: 'replace' | 'add' = 'replace',
): Promise<{ imageUrl: string | null; imageUrls: string[]; imageDocs?: CatalogProduct['imageDocs'] }> {
  const callable = httpsCallable<
    { productId: string; contentType: string; imageBase64: string; mode: 'replace' | 'add' },
    { imageUrl: string | null; imageUrls?: string[]; imageDocs?: CatalogProduct['imageDocs'] }
  >(functions, 'uploadCatalogProductImage', { timeout: 120_000 });

  try {
    const compressed = await compressImageForUpload(file);
    const imageBase64 = await fileToBase64(compressed);
    const result = await callable({
      productId,
      contentType: compressed.type || 'image/jpeg',
      imageBase64,
      mode,
    });
    const syncedAt = Date.now();
    const imageUrl = withCatalogImageCacheBust(result.data.imageUrl, syncedAt) ?? result.data.imageUrl;
    const imageUrls = (result.data.imageUrls ?? (imageUrl ? [imageUrl] : []))
      .map(url => withCatalogImageCacheBust(url, syncedAt) ?? url)
      .filter(Boolean);
    const imageDocs = result.data.imageDocs?.map(doc => ({
      ...doc,
      url: withCatalogImageCacheBust(doc.url, syncedAt) ?? doc.url,
    }));
    return { imageUrl, imageUrls, imageDocs };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** Zoho + Firestore cache — remove primary or a gallery image. */
export async function deleteCatalogProductImage(
  productId: string,
  options: { documentId?: string } = {},
): Promise<{ imageUrl: string | null; imageUrls: string[]; imageDocs?: CatalogProduct['imageDocs'] }> {
  const callable = httpsCallable<
    { productId: string; documentId?: string },
    {
      ok: boolean;
      imageUrl?: string | null;
      imageUrls?: string[];
      imageDocs?: CatalogProduct['imageDocs'];
    }
  >(
    functions,
    'deleteCatalogProductImage',
    { timeout: 60_000 },
  );
  try {
    const result = await callable({
      productId,
      ...(options.documentId ? { documentId: options.documentId } : {}),
    });
    const syncedAt = Date.now();
    const imageUrl = withCatalogImageCacheBust(result.data.imageUrl ?? null, syncedAt)
      ?? result.data.imageUrl
      ?? null;
    const imageUrls = (result.data.imageUrls ?? (imageUrl ? [imageUrl] : []))
      .map(url => withCatalogImageCacheBust(url, syncedAt) ?? url)
      .filter(Boolean);
    return {
      imageUrl,
      imageUrls,
      imageDocs: result.data.imageDocs,
    };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

function sanitizeDownloadFilename(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'product';
}

function extensionFromMime(mime: string): string | null {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return null;
}

function extensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function downloadCatalogProductImage(
  imageUrl: string,
  opts: { productName?: string; sku?: string | null; productId?: string },
): Promise<void> {
  const baseName = sanitizeDownloadFilename(
    opts.sku?.trim() || opts.productName?.trim() || opts.productId || 'product',
  );

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error('Could not download image.');
    const blob = await response.blob();
    const ext = extensionFromMime(blob.type) || extensionFromUrl(imageUrl) || 'jpg';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}.${ext}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    const ext = extensionFromUrl(imageUrl) || 'jpg';
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `${baseName}.${ext}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  }
}

export async function syncCatalog(): Promise<{ syncedCount: number; syncedAt: string }> {
  const callable = httpsCallable<undefined, { syncedCount: number; syncedAt: string }>(
    functions,
    'syncZohoCatalog',
    { timeout: 600_000 },
  );
  try {
    const result = await callable();
    return result.data;
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** Zoho + Firestore cache — assigns category on Zoho before updating Firestore. */
export async function assignProductCategory(
  productId: string,
  categoryId: string,
  categoryName: string,
): Promise<void> {
  const callable = httpsCallable<
    { productId: string; categoryId: string; categoryName: string },
    { ok: boolean }
  >(functions, 'assignCatalogProductCategory');
  try {
    await callable({ productId, categoryId, categoryName });
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export type CatalogProductStatus = 'active' | 'inactive';

/** Zoho + Firestore cache — updates item status on Zoho before updating Firestore. */
export async function setCatalogProductStatus(
  productId: string,
  status: CatalogProductStatus,
): Promise<void> {
  const callable = httpsCallable<
    { productId: string; status: CatalogProductStatus },
    { ok: boolean; status: CatalogProductStatus }
  >(functions, 'setCatalogProductStatus');
  try {
    await callable({ productId, status });
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** Zoho + Firestore — pushes name/sku/rate to Zoho; MRP/model/approval stay Firestore-only. */
export async function updateCatalogProductDetails(
  productId: string,
  input: {
    name: string;
    sku: string;
    rate?: number;
    mrpOverride?: number | null;
    modelNumber?: string | null;
    approvalNumber?: string | null;
  },
): Promise<{
  name: string;
  sku: string;
  rate?: number;
  mrpOverride?: number | null;
  modelNumber?: string | null;
  approvalNumber?: string | null;
}> {
  const callable = httpsCallable<
    {
      productId: string;
      name: string;
      sku: string;
      rate?: number;
      mrpOverride?: number | null;
      modelNumber?: string | null;
      approvalNumber?: string | null;
    },
    {
      ok: boolean;
      name: string;
      sku: string;
      rate?: number;
      mrpOverride?: number | null;
      modelNumber?: string | null;
      approvalNumber?: string | null;
    }
  >(functions, 'updateCatalogProductDetails');
  try {
    const result = await callable({
      productId,
      name: input.name.trim(),
      sku: input.sku.trim(),
      ...(input.rate != null ? { rate: input.rate } : {}),
      ...('mrpOverride' in input ? { mrpOverride: input.mrpOverride ?? null } : {}),
      ...('modelNumber' in input ? { modelNumber: input.modelNumber ?? null } : {}),
      ...('approvalNumber' in input ? { approvalNumber: input.approvalNumber ?? null } : {}),
    });
    return {
      name: result.data.name,
      sku: result.data.sku,
      ...(result.data.rate != null ? { rate: result.data.rate } : {}),
      ...('mrpOverride' in result.data ? { mrpOverride: result.data.mrpOverride ?? null } : {}),
      ...('modelNumber' in result.data ? { modelNumber: result.data.modelNumber ?? null } : {}),
      ...('approvalNumber' in result.data
        ? { approvalNumber: result.data.approvalNumber ?? null }
        : {}),
    };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** Firestore-only model / approval — does not call Zoho. */
export async function updateCatalogProductOverlays(
  productId: string,
  input: {
    modelNumber?: string | null;
    approvalNumber?: string | null;
  },
): Promise<{
  modelNumber?: string | null;
  approvalNumber?: string | null;
}> {
  const callable = httpsCallable<
    {
      productId: string;
      modelNumber?: string | null;
      approvalNumber?: string | null;
    },
    {
      ok: boolean;
      modelNumber?: string | null;
      approvalNumber?: string | null;
    }
  >(functions, 'updateCatalogProductOverlays');
  try {
    const result = await callable({
      productId,
      ...('modelNumber' in input ? { modelNumber: input.modelNumber ?? null } : {}),
      ...('approvalNumber' in input ? { approvalNumber: input.approvalNumber ?? null } : {}),
    });
    return {
      ...('modelNumber' in result.data ? { modelNumber: result.data.modelNumber ?? null } : {}),
      ...('approvalNumber' in result.data
        ? { approvalNumber: result.data.approvalNumber ?? null }
        : {}),
    };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** Firestore only — package dimensions are never sent to Zoho. */
export async function updateCatalogProductPackageInfo(
  productId: string,
  input: {
    masterCarton: CatalogPackageCarton | null;
    singleBox: CatalogPackageCarton | null;
  },
): Promise<CatalogPackageInfo> {
  const callable = httpsCallable<
    {
      productId: string;
      masterCarton: CatalogPackageCarton | null;
      singleBox: CatalogPackageCarton | null;
    },
    { ok: boolean; packageInfo: CatalogPackageInfo }
  >(functions, 'updateCatalogProductPackageInfo');
  try {
    const result = await callable({
      productId,
      masterCarton: input.masterCarton,
      singleBox: input.singleBox,
    });
    return result.data.packageInfo;
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export type CatalogSpareLinkKind = 'spares' | 'products';

export interface CatalogSpareLinksResponse {
  kind: CatalogSpareLinkKind;
  items: CatalogProduct[];
}

export async function fetchCatalogSpareLinks(
  opts: { productId: string } | { spareId: string },
): Promise<CatalogSpareLinksResponse> {
  const callable = httpsCallable<
    { productId?: string; spareId?: string },
    CatalogSpareLinksResponse
  >(functions, 'getCatalogSpareLinks');
  try {
    const result = await callable(opts);
    return {
      kind: result.data.kind,
      items: result.data.items.map(item => ({
        ...item,
        imageUrl: withCatalogImageCacheBust(item.imageUrl, item.syncedAt),
      })),
    };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export async function saveCatalogProductSpareLinks(
  productId: string,
  spareIds: string[],
): Promise<void> {
  const callable = httpsCallable<
    { productId: string; spareIds: string[] },
    { ok: boolean }
  >(functions, 'saveCatalogSpareLinks');
  try {
    await callable({ productId, spareIds });
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export async function saveCatalogSpareProductLinks(
  spareId: string,
  productIds: string[],
): Promise<void> {
  const callable = httpsCallable<
    { spareId: string; productIds: string[] },
    { ok: boolean }
  >(functions, 'saveCatalogSpareLinks');
  try {
    await callable({ spareId, productIds });
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value);
}

/** Dealer price without paise — for compact product-detail display. */
export function formatCurrencyWhole(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function stockStatusLabel(status: string): string {
  if (status === 'in_stock') return 'In Stock';
  if (status === 'low_stock') return 'Low Stock';
  return 'Out of Stock';
}

export function formatStockQuantity(stock: number, unit = 'pcs'): string {
  const qty = Number.isFinite(stock) ? stock : 0;
  const formatted =
    qty % 1 === 0
      ? qty.toLocaleString('en-IN')
      : qty.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `${formatted} ${unit}`.trim();
}
