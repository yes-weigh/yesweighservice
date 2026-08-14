import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { WhatsAppShare } from 'whatsapp-share';
import { app, db } from '../firebase';
import { isFreightProductId, isFreightSku } from '../constants/freightLines';
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
import { effectiveCatalogStockStatus, isSacHsn } from './sacCatalog';
import {
  clearCatalogCache,
  getCatalogInflight,
  peekCatalogCache,
  peekCatalogCacheStale,
  setCatalogCache,
  setCatalogInflight,
  touchCatalogCache,
  type CatalogCachePayload,
} from './catalog-cache';

const functions = getFunctions(app, 'asia-south1');

export interface CatalogFilters {
  search?: string;
  category?: string;
  stockStatus?: string;
}

export interface FetchCatalogOptions {
  /** Bypass cache and reload from Firestore. */
  force?: boolean;
}

const HIDDEN_CATEGORY_NAMES = new Set(['stamping gj', 'stamping kl', 'inactive']);

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

/** Products in hidden categories or explicitly hidden — excluded from dealer catalogue browse and search. */
export function isHiddenCatalogProduct(
  product: Pick<CatalogProduct, 'categoryId' | 'categoryName' | 'hiddenFromCatalog'>,
  categories: CatalogCategory[] = [],
): boolean {
  if (product.hiddenFromCatalog === true) return true;
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

/** Freight charge Zoho lines — never shown as catalogue spare parts. */
export function isCatalogFreightChargeProduct(product: {
  id?: string | null;
  sku?: string | null;
}): boolean {
  return isFreightProductId(product.id) || isFreightSku(product.sku);
}

/** True when a Zoho item belongs on the Spare parts tab (not shop Categories). */
export function isCatalogSparePartProduct(
  product: Pick<CatalogProduct, 'categoryId' | 'categoryName'> & Partial<Pick<CatalogProduct, 'id' | 'sku'>>,
  categories: CatalogCategory[] = [],
): boolean {
  if (isCatalogFreightChargeProduct(product)) return false;
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

/**
 * Spare parts tab / Spare pricing — same visible pool:
 * generic spare parts + uncategorized Zoho items, excluding hidden-from-catalogue
 * and hardcoded freight charge SKUs.
 */
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

export function isSoftwareKeysCategory(category: Pick<CatalogCategory, 'name'>): boolean {
  return category.name.trim().toLowerCase() === 'software keys';
}

/** Cart UI hint — SAC / Software Keys are never shown as out of stock. */
export function cartLineIsOutOfStock(line: {
  stockStatus?: string | null;
  hsn?: string | null;
  categoryName?: string | null;
}): boolean {
  if (isSacHsn(line.hsn)) return false;
  if (line.categoryName && isSoftwareKeysCategory({ name: line.categoryName })) return false;
  return line.stockStatus === 'out_of_stock';
}

export {
  isSoftwareKeysLedgerStockProduct,
  normalizeCatalogHsn,
  SOFTWARE_KEYS_LEDGER_HSN,
} from './softwareKeysLedgerStock';

/**
 * Package dimensions are only expected for finished shop products.
 * Uncategorized, generic spare parts, and software keys skip the missing-package flag.
 */
export function expectsCatalogPackageInfo(
  product: Pick<CatalogProduct, 'categoryId' | 'categoryName'>,
  categories: CatalogCategory[] = [],
): boolean {
  if (!hasCatalogCategory(product)) return false;
  if (isHiddenCatalogProduct(product, categories)) return false;
  if (isCatalogSparePartProduct(product, categories)) return false;
  if (product.categoryName && isSoftwareKeysCategory({ name: product.categoryName })) {
    return false;
  }
  if (product.categoryId) {
    const cat = categories.find(c => c.id === product.categoryId);
    if (cat && isSoftwareKeysCategory(cat)) return false;
  }
  return true;
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
  { key: 'needsCountThisCycle', label: 'Needs count' },
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

/**
 * Same rule as the browse-grid package icon: only single-box data counts.
 * Master carton alone is not enough.
 */
export function catalogProductHasSingleBoxPackageInfo(
  product: Pick<CatalogProduct, 'packageInfo'>,
): boolean {
  return (product.packageInfo?.singleBox?.length ?? 0) > 0;
}

/** True when at least one single box has weight + L × B × H all > 0. */
export function catalogProductHasCompleteSingleBoxPackageInfo(
  product: Pick<CatalogProduct, 'packageInfo'>,
): boolean {
  const boxes = product.packageInfo?.singleBox ?? [];
  return boxes.some(carton => (
    [carton.weightKg, carton.lengthCm, carton.breadthCm, carton.heightCm]
      .every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)
  ));
}

export const PACKAGE_INFO_FILTERS = [
  { key: 'hasPackaging', label: 'Has packaging' },
  { key: 'missingPackaging', label: 'Missing packaging' },
] as const;

export type PackageInfoFilter = typeof PACKAGE_INFO_FILTERS[number]['key'];

export function matchesPackageInfoFilters(
  product: Pick<CatalogProduct, 'packageInfo'>,
  filters: ReadonlySet<PackageInfoFilter>,
): boolean {
  if (filters.size === 0) return true;
  const hasPackaging = catalogProductHasSingleBoxPackageInfo(product);
  return (
    (filters.has('hasPackaging') && hasPackaging)
    || (filters.has('missingPackaging') && !hasPackaging)
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

/**
 * Head Office store-room audits — Yes Store bins linked to a catalog product,
 * plus head_office site-inventory docs (including zero-stock / no-location audits).
 */
export function buildHeadOfficeAuditedCatalogProductIds(
  auditItems: ReadonlyArray<{ catalogProductId?: string | null }>,
  headOfficeSiteInventory: ReadonlyArray<{
    catalogProductId?: string | null;
    site?: string | null;
  }> = [],
): Set<string> {
  const ids = new Set<string>();
  for (const item of auditItems) {
    const id = item.catalogProductId?.trim();
    if (id) ids.add(id);
  }
  for (const record of headOfficeSiteInventory) {
    if (record.site && record.site !== 'head_office') continue;
    const id = record.catalogProductId?.trim();
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

/** Audit vs book stock variance: remaining Diff after sales / inbound catch-up. */
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

/** True when there is an open cycle and this SKU has no physical count in it yet. */
export function catalogProductNeedsCountThisCycle(
  product: Pick<CatalogProduct, 'auditSnapshot'>,
  openCycleId: string | null | undefined,
  site?: 'head_office' | 'cochin',
): boolean {
  if (!openCycleId) return false;
  const snap = product.auditSnapshot;
  if (!snap) return true;
  if (site === 'head_office') {
    return (snap.lastHeadOfficeAuditCycleId ?? snap.lastAuditCycleId ?? null) !== openCycleId;
  }
  if (site === 'cochin') {
    return (snap.lastCochinAuditCycleId ?? snap.lastAuditCycleId ?? null) !== openCycleId;
  }
  return (snap.lastAuditCycleId ?? null) !== openCycleId;
}

export function matchesSpareAuditStatusFilters(
  product: Pick<CatalogProduct, 'id' | 'categoryId' | 'categoryName' | 'stock' | 'auditSnapshot'>,
  filters: ReadonlySet<SpareAuditStatusFilter>,
  categories: CatalogCategory[],
  headOfficeAuditedIds: ReadonlySet<string>,
  cochinAuditedIds: ReadonlySet<string>,
  openCycleId?: string | null,
  site?: 'head_office' | 'cochin',
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
    || (filters.has('needsCountThisCycle') && catalogProductNeedsCountThisCycle(product, openCycleId, site))
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

/** Categories grid for shop browse — finished goods + Generic Spare Parts card. */
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

  // Categories tab: show Generic Spare Parts card (Zoho category items only).
  // Full spare pool (generic + uncategorized) remains on the Spare parts tab.
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
      return 'Product sync timed out. Deploy the latest functions and try again — sync should finish in under a minute.';
    }

    if (
      code === 'functions/resource-exhausted'
      || /rate.?limit|blocked for some time|too many requests|exceeded the maximum number of requests/i.test(message)
    ) {
      return 'Zoho is temporarily rate-limited after heavy updates. Wait a few minutes, then try again.';
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
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
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

/** Normalize legacy single-object or array singleBox into CatalogPackageCarton[]. */
function mapSingleBoxCartons(data: unknown): CatalogPackageCarton[] | null {
  if (data == null) return null;
  if (Array.isArray(data)) {
    const boxes = data
      .map(row => mapPackageCarton(row))
      .filter((row): row is CatalogPackageCarton => Boolean(row));
    return boxes.length ? boxes : null;
  }
  const one = mapPackageCarton(data);
  return one ? [one] : null;
}

function mapPackageInfo(data: unknown): CatalogPackageInfo | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const masterCarton = mapPackageCarton(row.masterCarton);
  const singleBox = mapSingleBoxCartons(row.singleBox);
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
  const hsn = (data.hsn as string | null) ?? null;
  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    sku: (data.sku as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    unit: String(data.unit ?? 'pcs'),
    rate: Number(data.rate ?? 0),
    stock: Number(data.stock ?? 0),
    stockStatus: effectiveCatalogStockStatus(
      (data.stockStatus as CatalogProduct['stockStatus']) ?? 'out_of_stock',
      hsn,
    ),
    imageUrl,
    ...(imageUrls?.length ? { imageUrls } : {}),
    ...(imageDocs?.length ? { imageDocs } : {}),
    categoryId: (data.categoryId as string | null) ?? null,
    categoryName: (data.categoryName as string | null) ?? null,
    status: String(data.status ?? 'active'),
    hsn,
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
    ...(typeof data.spareGroupId === 'string' && data.spareGroupId.trim()
      ? { spareGroupId: data.spareGroupId.trim() }
      : {}),
    ...(Array.isArray(data.gatcStampingPriceIds)
      ? {
          gatcStampingPriceIds: [
            ...new Set(
              data.gatcStampingPriceIds
                .map((id: unknown) => String(id ?? '').trim())
                .filter(Boolean),
            ),
          ],
        }
      : {}),
    ...(typeof data.skuChangedAt === 'string' && data.skuChangedAt.trim()
      ? { skuChangedAt: data.skuChangedAt.trim() }
      : {}),
    ...(typeof data.nameChangedAt === 'string' && data.nameChangedAt.trim()
      ? { nameChangedAt: data.nameChangedAt.trim() }
      : {}),
    ...(typeof data.binLabelPrintedSku === 'string' && data.binLabelPrintedSku.trim()
      ? { binLabelPrintedSku: data.binLabelPrintedSku.trim() }
      : {}),
    ...(typeof data.binLabelPrintedName === 'string' && data.binLabelPrintedName.trim()
      ? { binLabelPrintedName: data.binLabelPrintedName.trim() }
      : {}),
    ...(typeof data.binLabelPrintedAt === 'string' && data.binLabelPrintedAt.trim()
      ? { binLabelPrintedAt: data.binLabelPrintedAt.trim() }
      : {}),
    ...(data.hiddenFromCatalog === true ? { hiddenFromCatalog: true } : {}),
    ...(Number.isFinite(Number(data.ledgerClosingStock))
      ? { ledgerClosingStock: Number(data.ledgerClosingStock) }
      : {}),
    ...(typeof data.ledgerClosingStockAt === 'string' && data.ledgerClosingStockAt.trim()
      ? { ledgerClosingStockAt: data.ledgerClosingStockAt.trim() }
      : {}),
  };
}

/** Spare-rack SKU colour: white = unchanged, yellow = changed, green = relabel printed. */
export type SkuLabelRackStatus = 'unchanged' | 'changed' | 'relabel_printed';

export function resolveSkuLabelRackStatus(
  product: Pick<
    CatalogProduct,
    'sku' | 'name' | 'skuChangedAt' | 'nameChangedAt' | 'binLabelPrintedSku' | 'binLabelPrintedName'
  >,
): SkuLabelRackStatus {
  const skuChanged = Boolean(product.skuChangedAt?.trim());
  const nameChanged = Boolean(product.nameChangedAt?.trim());
  if (!skuChanged && !nameChanged) return 'unchanged';

  const currentSku = (product.sku ?? '').trim();
  const printedSku = (product.binLabelPrintedSku ?? '').trim();
  if (!printedSku || printedSku !== currentSku) return 'changed';

  // Legacy: SKU-only change tracking — green when printed SKU matches.
  if (!nameChanged) return 'relabel_printed';

  const currentName = (product.name ?? '').trim();
  const printedName = (product.binLabelPrintedName ?? '').trim();
  if (printedName && printedName === currentName) return 'relabel_printed';
  return 'changed';
}

export const SPARE_LABEL_UPDATE_FILTERS = [
  { key: 'labelNeedsPrint', label: 'Updated · not printed' },
  { key: 'labelPrinted', label: 'Updated · printed' },
] as const;

export type SpareLabelUpdateFilter = typeof SPARE_LABEL_UPDATE_FILTERS[number]['key'];

export function matchesSpareLabelUpdateFilters(
  product: Pick<
    CatalogProduct,
    'sku' | 'name' | 'skuChangedAt' | 'nameChangedAt' | 'binLabelPrintedSku' | 'binLabelPrintedName'
  >,
  filters: ReadonlySet<SpareLabelUpdateFilter>,
): boolean {
  if (filters.size === 0) return true;
  const status = resolveSkuLabelRackStatus(product);
  if (filters.has('labelNeedsPrint') && status === 'changed') return true;
  if (filters.has('labelPrinted') && status === 'relabel_printed') return true;
  return false;
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
    isWeighingScale: Boolean(data.isWeighingScale),
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
        isWeighingScale: Boolean(storedMap.get(categoryId)?.isWeighingScale),
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
        isWeighingScale: Boolean(prev?.isWeighingScale ?? cat.isWeighingScale),
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
export async function fetchCatalog(
  filters: CatalogFilters = {},
  options: FetchCatalogOptions = {},
): Promise<CatalogResponse> {
  try {
    const payload = await loadCatalogPayload(options);
    const items = filterItems(payload.allItems, filters);
    return {
      items,
      categories: payload.categories,
      total: items.length,
      syncedAt: payload.syncedAt,
      stats: payload.stats,
    };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

async function loadCatalogPayload(options: FetchCatalogOptions): Promise<CatalogCachePayload> {
  if (options.force) {
    const promise = fetchCatalogPayloadFromFirestore().finally(() => {
      setCatalogInflight(null);
    });
    setCatalogInflight(promise);
    return promise;
  }

  const fresh = peekCatalogCache();
  if (fresh) return fresh;

  const stale = peekCatalogCacheStale();
  if (stale) {
    // Soft TTL expired — one meta read; skip full catalog if Zoho sync wrote nothing new.
    try {
      const metaSnap = await getDoc(doc(db, 'catalogMeta', 'sync'));
      const meta = metaSnap.exists() ? metaSnap.data() : null;
      const contentKey = catalogContentKey(meta);
      if (contentKey && contentKey === stale.contentKey) {
        touchCatalogCache();
        return stale;
      }
    } catch {
      // Fall through to full fetch.
    }
  }

  const existing = getCatalogInflight();
  if (existing) return existing;

  const promise = fetchCatalogPayloadFromFirestore().finally(() => {
    setCatalogInflight(null);
  });
  setCatalogInflight(promise);
  return promise;
}

function catalogContentKey(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  const key = (meta.lastContentChangeAt ?? meta.lastSyncAt) as string | null | undefined;
  return key ? String(key) : null;
}

async function fetchCatalogPayloadFromFirestore(): Promise<CatalogCachePayload> {
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
  const meta = metaSnap.exists() ? metaSnap.data() : null;
  const syncedAt = (meta?.lastSyncAt as string | null) ?? null;
  const payload: CatalogCachePayload = {
    allItems,
    categories,
    syncedAt,
    contentKey: catalogContentKey(meta as Record<string, unknown> | null),
    stats: buildStats(allItems, categories),
  };
  setCatalogCache(payload);
  return payload;
}

/** Drop in-memory / session catalog cache (call after mutations or manual sync). */
export { clearCatalogCache };

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
    clearCatalogCache();
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

export interface BulkCatalogSkuUpdateInput {
  productId: string;
  name: string;
  newSku: string;
  oldSku?: string | null;
}

/** Apply explicit bulk SKU updates from CSV upload (super admin). */
export async function applyBulkCatalogSkuUpdates(
  updates: BulkCatalogSkuUpdateInput[],
): Promise<CatalogSkuRepairResult> {
  const callable = httpsCallable<{ updates: BulkCatalogSkuUpdateInput[] }, CatalogSkuRepairResult>(
    functions,
    'applyBulkCatalogSkuUpdatesFn',
    { timeout: 540_000 },
  );
  try {
    const result = await callable({ updates });
    clearCatalogCache();
    return result.data;
  } catch (err) {
    if (err && typeof err === 'object') {
      const code = 'code' in err ? String((err as { code: string }).code) : '';
      const message = 'message' in err ? String((err as { message: string }).message) : '';
      if (code === 'functions/deadline-exceeded' || message.includes('deadline-exceeded')) {
        throw new Error(
          'Bulk SKU update timed out. Wait a minute, then run bulk update again for any remaining rows.',
        );
      }
    }
    throw new Error(catalogErrorMessage(err));
  }
}

/** Count duplicate New Proposed SKU values within a bulk-upload batch. */
export function countDuplicateNewSkusInBatch(newSkus: string[]): number {
  const counts = new Map<string, number>();
  for (const raw of newSkus) {
    const sku = String(raw ?? '').trim();
    if (!sku) continue;
    counts.set(sku, (counts.get(sku) ?? 0) + 1);
  }
  let duplicateValues = 0;
  for (const count of counts.values()) {
    if (count > 1) duplicateValues += 1;
  }
  return duplicateValues;
}

/** Rows whose New Proposed SKU appears more than once in the batch. */
export function newSkusWithDuplicatesInBatch(newSkus: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const raw of newSkus) {
    const sku = String(raw ?? '').trim();
    if (!sku) continue;
    counts.set(sku, (counts.get(sku) ?? 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [sku, count] of counts) {
    if (count > 1) dupes.add(sku);
  }
  return dupes;
}

/** Record that a bin label was printed with the given SKU/name (drives spare-rack green status). */
export async function recordCatalogBinLabelPrint(
  productId: string,
  sku: string,
  name?: string,
): Promise<void> {
  const callable = httpsCallable<
    { productId: string; sku: string; name?: string },
    { ok: boolean }
  >(
    functions,
    'recordCatalogBinLabelPrintFn',
  );
  try {
    const trimmedName = name?.trim() ?? '';
    await callable({
      productId: productId.trim(),
      sku: sku.trim(),
      ...(trimmedName ? { name: trimmedName } : {}),
    });
    clearCatalogCache();
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export function mergeCatalogProductLedgerStock<T extends CatalogProduct>(
  product: T,
  fallback?: Pick<CatalogProduct, 'ledgerClosingStock' | 'ledgerClosingStockAt'> | null,
): T {
  if (!fallback || product.ledgerClosingStock != null) return product;
  if (fallback.ledgerClosingStock == null) return product;
  return {
    ...product,
    ledgerClosingStock: fallback.ledgerClosingStock,
    ...(fallback.ledgerClosingStockAt
      ? { ledgerClosingStockAt: fallback.ledgerClosingStockAt }
      : {}),
  };
}

async function supplementCatalogProductLedgerStock(
  productId: string,
  detail: CatalogProductDetail,
): Promise<CatalogProductDetail> {
  if (detail.ledgerClosingStock != null) return detail;
  try {
    const snap = await getDoc(doc(db, 'catalogProducts', productId));
    if (!snap.exists()) return detail;
    const data = snap.data() ?? {};
    if (!Number.isFinite(Number(data.ledgerClosingStock))) return detail;
    return {
      ...detail,
      ledgerClosingStock: Number(data.ledgerClosingStock),
      ...(typeof data.ledgerClosingStockAt === 'string' && data.ledgerClosingStockAt.trim()
        ? { ledgerClosingStockAt: data.ledgerClosingStockAt.trim() }
        : {}),
    };
  } catch {
    return detail;
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
    const syncedAt = detail.syncedAt;
    const imageUrl = withCatalogImageCacheBust(detail.imageUrl, syncedAt);
    const imageDocs = detail.imageDocs?.map(doc => ({
      ...doc,
      url: withCatalogImageCacheBust(doc.url, syncedAt) ?? doc.url,
    }));
    const imageUrls = detail.imageUrls?.length
      ? detail.imageUrls
        .map(url => withCatalogImageCacheBust(url, syncedAt))
        .filter((url): url is string => Boolean(url))
      : undefined;
    return supplementCatalogProductLedgerStock(productId, {
      ...detail,
      imageUrl,
      ...(imageUrls?.length ? { imageUrls } : {}),
      ...(imageDocs?.length ? { imageDocs } : {}),
    });
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
    clearCatalogCache();
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export async function saveCatalogCategoryWeighingScaleFlags(
  categories: Array<{ id: string; isWeighingScale: boolean }>,
): Promise<void> {
  const callable = httpsCallable<
    { categories: Array<{ id: string; isWeighingScale: boolean }> },
    { ok: boolean; count: number }
  >(functions, 'saveCatalogCategoryWeighingScaleFlags');
  try {
    await callable({ categories });
    clearCatalogCache();
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** One-shot seed of default weighing-scale groups when none are flagged. */
export async function seedCatalogWeighingScaleCategories(): Promise<{
  seeded: number;
  skipped: boolean;
  reason?: string;
}> {
  const callable = httpsCallable<
    Record<string, never>,
    { seeded: number; skipped: boolean; reason?: string }
  >(functions, 'seedCatalogWeighingScaleCategories');
  try {
    const res = await callable({});
    if (!res.data.skipped && res.data.seeded > 0) clearCatalogCache();
    return res.data;
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
    clearCatalogCache();
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
    clearCatalogCache();
    return withCatalogImageCacheBust(result.data.thumbnailUrl, Date.now()) ?? result.data.thumbnailUrl;
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export interface PushMissingCatalogImagesResult {
  productId: string;
  dryRun: boolean;
  firebaseCount: number;
  zohoCount: number;
  missingCount: number;
  uploadedCount: number;
  failedCount: number;
  skipped: boolean;
  message: string;
  uploaded?: Array<{ kind: string; documentId: string | null; previousDocumentId?: string }>;
  failed?: Array<{ kind: string; documentId: string | null; error: string }>;
}

/** Compare Firebase vs Zoho images; optionally upload Firebase-only images to Zoho. */
export async function pushMissingCatalogProductImagesToZoho(
  productId: string,
  options?: { dryRun?: boolean },
): Promise<PushMissingCatalogImagesResult> {
  const callable = httpsCallable<
    { productId: string; dryRun?: boolean },
    PushMissingCatalogImagesResult
  >(functions, 'pushMissingCatalogProductImagesToZohoFn', { timeout: 300_000 });
  try {
    const result = await callable({
      productId: productId.trim(),
      dryRun: Boolean(options?.dryRun),
    });
    return result.data;
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export interface CatalogProductWithFirebaseImages {
  id: string;
  sku: string;
  name: string;
  firebaseImageCount: number;
}

/** Catalog products that have at least one image stored in Firebase. */
export async function listCatalogProductsWithFirebaseImages(): Promise<
  CatalogProductWithFirebaseImages[]
> {
  try {
    const snap = await getDocs(collection(db, 'catalogProducts'));
    return snap.docs
      .map(docSnap => {
        const product = mapProduct(docSnap.data() as Record<string, unknown>);
        const docsCount = product.imageDocs?.length ?? 0;
        const urlsCount = product.imageUrls?.length ?? 0;
        const firebaseImageCount = Math.max(
          docsCount,
          urlsCount,
          product.imageUrl ? 1 : 0,
        );
        return {
          id: product.id,
          sku: product.sku?.trim() || product.id,
          name: product.name,
          firebaseImageCount,
        };
      })
      .filter(row => row.id && row.firebaseImageCount > 0)
      .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { sensitivity: 'base' }));
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** Zoho + Firestore cache — replace primary/current gallery slot, append, or promote. */
export async function uploadCatalogProductImage(
  productId: string,
  file: File | null,
  mode: 'replace' | 'add' | 'promote' = 'replace',
  options: { documentId?: string } = {},
): Promise<{ imageUrl: string | null; imageUrls: string[]; imageDocs?: CatalogProduct['imageDocs'] }> {
  const callable = httpsCallable<
    {
      productId: string;
      contentType?: string;
      imageBase64?: string;
      mode: 'replace' | 'add' | 'promote';
      documentId?: string;
    },
    { imageUrl: string | null; imageUrls?: string[]; imageDocs?: CatalogProduct['imageDocs'] }
  >(functions, 'uploadCatalogProductImage', { timeout: 120_000 });

  try {
    let contentType = 'image/jpeg';
    let imageBase64: string | undefined;
    if (mode !== 'promote') {
      if (!file) throw new Error('Choose an image file.');
      const compressed = await compressImageForUpload(file);
      contentType = compressed.type || 'image/jpeg';
      imageBase64 = await fileToBase64(compressed);
    }
    const result = await callable({
      productId,
      mode,
      ...(imageBase64 ? { contentType, imageBase64 } : {}),
      ...(options.documentId ? { documentId: options.documentId } : {}),
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
    clearCatalogCache();
    return { imageUrl, imageUrls, imageDocs };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** Zoho + Firestore cache — remove primary or a gallery image. */
export async function deleteCatalogProductImage(
  productId: string,
  options: { documentId?: string; imageUrl?: string } = {},
): Promise<{ imageUrl: string | null; imageUrls: string[]; imageDocs?: CatalogProduct['imageDocs'] }> {
  const callable = httpsCallable<
    { productId: string; documentId?: string; imageUrl?: string },
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
      ...(options.imageUrl ? { imageUrl: options.imageUrl } : {}),
    });
    const syncedAt = Date.now();
    const imageUrl = withCatalogImageCacheBust(result.data.imageUrl ?? null, syncedAt)
      ?? result.data.imageUrl
      ?? null;
    const imageUrls = (result.data.imageUrls ?? (imageUrl ? [imageUrl] : []))
      .map(url => withCatalogImageCacheBust(url, syncedAt) ?? url)
      .filter(Boolean);
    clearCatalogCache();
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

function mimeFromExtension(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value.trim()) return value.trim();
  }
  return null;
}

function stripDataUrlPrefix(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma >= 0 ? value.slice(comma + 1) : value;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not encode image.'));
        return;
      }
      resolve(stripDataUrlPrefix(result));
    };
    reader.onerror = () => reject(new Error('Could not encode image.'));
    reader.readAsDataURL(blob);
  });
}

function pluginUnimplemented(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    if (String((err as { code?: string }).code) === 'UNIMPLEMENTED') return true;
  }
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /unimplemented|not implemented/i.test(message);
}

async function fetchCatalogImageAsBase64(imageUrl: string): Promise<{
  dataBase64: string;
  mimeType: string;
  ext: string;
}> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error('Could not download image.');
    const blob = await response.blob();
    const mimeType = blob.type || mimeFromExtension(extensionFromUrl(imageUrl) || 'jpg');
    const ext = extensionFromMime(mimeType) || extensionFromUrl(imageUrl) || 'jpg';
    return { dataBase64: await blobToBase64(blob), mimeType, ext };
  } catch {
    if (!Capacitor.isNativePlatform()) throw new Error('Could not download image.');
    const http = await CapacitorHttp.get({
      url: imageUrl,
      responseType: 'blob',
      connectTimeout: 15000,
      readTimeout: 30000,
    });
    if (http.status < 200 || http.status >= 300) {
      throw new Error('Could not download image.');
    }
    const contentType = headerValue(http.headers, 'content-type');
    const mimeType = (contentType?.split(';')[0]?.trim() || '')
      || mimeFromExtension(extensionFromUrl(imageUrl) || 'jpg');
    const ext = extensionFromMime(mimeType) || extensionFromUrl(imageUrl) || 'jpg';
    const data = http.data;
    if (typeof data === 'string' && data.trim()) {
      return { dataBase64: stripDataUrlPrefix(data.trim()), mimeType, ext };
    }
    if (data instanceof Blob) {
      return {
        dataBase64: await blobToBase64(data),
        mimeType: data.type || mimeType,
        ext: extensionFromMime(data.type) || ext,
      };
    }
    throw new Error('Could not download image.');
  }
}

export type CatalogImageDownloadDestination = 'file' | 'gallery' | 'share';

export async function downloadCatalogProductImage(
  imageUrl: string,
  opts: { productName?: string; sku?: string | null; productId?: string },
): Promise<CatalogImageDownloadDestination> {
  const baseName = sanitizeDownloadFilename(
    opts.sku?.trim() || opts.productName?.trim() || opts.productId || 'product',
  );
  const guessedExt = extensionFromUrl(imageUrl) || 'jpg';
  const guessedMime = mimeFromExtension(guessedExt);

  if (Capacitor.isNativePlatform()) {
    try {
      await WhatsAppShare.saveImage({
        url: imageUrl,
        fileName: `${baseName}.${guessedExt}`,
        mimeType: guessedMime,
      });
      return 'gallery';
    } catch (saveErr) {
      const image = await fetchCatalogImageAsBase64(imageUrl);
      try {
        await WhatsAppShare.shareImage({
          dataBase64: image.dataBase64,
          fileName: `${baseName}.${image.ext}`,
          mimeType: image.mimeType,
        });
        return 'share';
      } catch (shareErr) {
        if (!pluginUnimplemented(saveErr)) {
          const saveMessage = saveErr instanceof Error ? saveErr.message : '';
          if (saveMessage) throw new Error(saveMessage);
        }
        throw new Error(
          shareErr instanceof Error ? shareErr.message : 'Could not save photo to this phone.',
        );
      }
    }
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error('Could not download image.');
    const blob = await response.blob();
    const ext = extensionFromMime(blob.type) || guessedExt;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}.${ext}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `${baseName}.${guessedExt}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  }
  return 'file';
}

export async function syncCatalog(): Promise<{ syncedCount: number; syncedAt: string }> {
  const callable = httpsCallable<undefined, { syncedCount: number; syncedAt: string }>(
    functions,
    'syncZohoCatalog',
    { timeout: 600_000 },
  );
  try {
    const result = await callable();
    clearCatalogCache();
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
    clearCatalogCache();
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
    clearCatalogCache();
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
    clearCatalogCache();
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

/** Firestore-only model / approval / spare group / GATC — does not call Zoho. */
export async function updateCatalogProductOverlays(
  productId: string,
  input: {
    modelNumber?: string | null;
    approvalNumber?: string | null;
    spareGroupId?: string | null;
    gatcStampingPriceIds?: string[];
  },
): Promise<{
  modelNumber?: string | null;
  approvalNumber?: string | null;
  spareGroupId?: string | null;
  gatcStampingPriceIds?: string[];
}> {
  const callable = httpsCallable<
    {
      productId: string;
      modelNumber?: string | null;
      approvalNumber?: string | null;
      spareGroupId?: string | null;
      gatcStampingPriceIds?: string[];
    },
    {
      ok: boolean;
      modelNumber?: string | null;
      approvalNumber?: string | null;
      spareGroupId?: string | null;
      gatcStampingPriceIds?: string[];
    }
  >(functions, 'updateCatalogProductOverlays');
  try {
    const result = await callable({
      productId,
      ...('modelNumber' in input ? { modelNumber: input.modelNumber ?? null } : {}),
      ...('approvalNumber' in input ? { approvalNumber: input.approvalNumber ?? null } : {}),
      ...('spareGroupId' in input ? { spareGroupId: input.spareGroupId ?? null } : {}),
      ...('gatcStampingPriceIds' in input
        ? { gatcStampingPriceIds: input.gatcStampingPriceIds ?? [] }
        : {}),
    });
    clearCatalogCache();
    return {
      ...('modelNumber' in result.data ? { modelNumber: result.data.modelNumber ?? null } : {}),
      ...('approvalNumber' in result.data
        ? { approvalNumber: result.data.approvalNumber ?? null }
        : {}),
      ...('spareGroupId' in result.data
        ? { spareGroupId: result.data.spareGroupId ?? null }
        : {}),
      ...('gatcStampingPriceIds' in result.data
        ? { gatcStampingPriceIds: result.data.gatcStampingPriceIds ?? [] }
        : {}),
    };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** Super admin — hide or unhide a product from dealer/public products browse browse. */
export async function setCatalogProductHidden(
  productId: string,
  hidden: boolean,
): Promise<{ hiddenFromCatalog: boolean }> {
  const callable = httpsCallable<
    { productId: string; hidden: boolean },
    { ok: boolean; hiddenFromCatalog: boolean }
  >(functions, 'setCatalogProductHidden');
  try {
    const result = await callable({ productId, hidden });
    clearCatalogCache();
    return { hiddenFromCatalog: result.data.hiddenFromCatalog === true };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

/** Assign or clear spareGroupId on many spares (Firestore only). */
export async function assignCatalogSpareGroups(
  productIds: string[],
  spareGroupId: string | null,
): Promise<{ updated: number; spareGroupId: string | null }> {
  const callable = httpsCallable<
    { productIds: string[]; spareGroupId: string | null },
    { ok: boolean; updated: number; spareGroupId: string | null }
  >(functions, 'assignCatalogSpareGroups');
  try {
    const result = await callable({
      productIds,
      spareGroupId,
    });
    clearCatalogCache();
    return {
      updated: Number(result.data.updated ?? 0),
      spareGroupId: result.data.spareGroupId ?? null,
    };
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export async function getCatalogProductsByIds(
  ids: string[],
): Promise<Record<string, CatalogProduct>> {
  const unique = [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))];
  const result: Record<string, CatalogProduct> = {};
  if (!unique.length) return result;

  await Promise.all(
    unique.map(async id => {
      const snap = await getDoc(doc(db, 'catalogProducts', id));
      if (!snap.exists()) return;
      result[id] = mapProduct({ id, ...snap.data() } as Record<string, unknown>);
    }),
  );
  return result;
}

async function getCatalogProductBySku(sku: string): Promise<CatalogProduct | null> {
  const trimmed = String(sku || '').trim();
  if (!trimmed) return null;
  const snap = await getDocs(
    query(collection(db, 'catalogProducts'), where('sku', '==', trimmed), limit(1)),
  );
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return mapProduct({ id: docSnap.id, ...docSnap.data() } as Record<string, unknown>);
}

/**
 * Resolve catalog products for bill/invoice lines by Zoho item id, then SKU fallback.
 * Map is keyed by product id, raw itemId, and `sku:${sku}` when present.
 */
export async function resolveCatalogProductsForLineItems(
  lines: Array<{ itemId?: string | null; sku?: string | null }>,
): Promise<Record<string, CatalogProduct>> {
  const result: Record<string, CatalogProduct> = {};
  const indexProduct = (product: CatalogProduct, itemId?: string | null) => {
    result[product.id] = product;
    if (itemId?.trim()) result[itemId.trim()] = product;
    if (product.sku?.trim()) result[`sku:${product.sku.trim()}`] = product;
  };

  const itemIds = [...new Set(
    lines.map(line => String(line.itemId || '').trim()).filter(Boolean),
  )];
  const byId = await getCatalogProductsByIds(itemIds);
  for (const [itemId, product] of Object.entries(byId)) {
    indexProduct(product, itemId);
  }

  const skusNeeded = [...new Set(
    lines
      .filter(line => {
        const itemId = String(line.itemId || '').trim();
        if (itemId && result[itemId]) return false;
        const sku = String(line.sku || '').trim();
        return Boolean(sku) && !result[`sku:${sku}`];
      })
      .map(line => String(line.sku || '').trim())
      .filter(Boolean),
  )];

  await Promise.all(
    skusNeeded.map(async sku => {
      const product = await getCatalogProductBySku(sku);
      if (product) indexProduct(product);
    }),
  );

  return result;
}

/** Firestore only — package dimensions are never sent to Zoho. */
export async function updateCatalogProductPackageInfo(
  productId: string,
  input: {
    masterCarton: CatalogPackageCarton | null;
    singleBox: CatalogPackageCarton[] | null;
  },
): Promise<CatalogPackageInfo> {
  const callable = httpsCallable<
    {
      productId: string;
      masterCarton: CatalogPackageCarton | null;
      singleBox: CatalogPackageCarton[] | null;
    },
    { ok: boolean; packageInfo: CatalogPackageInfo }
  >(functions, 'updateCatalogProductPackageInfo');
  try {
    const result = await callable({
      productId,
      masterCarton: input.masterCarton,
      singleBox: input.singleBox,
    });
    clearCatalogCache();
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
    clearCatalogCache();
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
    clearCatalogCache();
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export function formatCurrency(value: number, currencyCode = 'INR'): string {
  const code = String(currencyCode || 'INR').trim().toUpperCase() || 'INR';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(value);
  }
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
