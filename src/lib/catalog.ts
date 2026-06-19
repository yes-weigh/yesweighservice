import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { app, db } from '../firebase';
import { compressImageForUpload } from './compressImage';
import type {
  CatalogCategory,
  CatalogProduct,
  CatalogProductDetail,
  CatalogResponse,
  CatalogStats,
} from '../types/catalog';

const functions = getFunctions(app, 'asia-south1');

export interface CatalogFilters {
  search?: string;
  category?: string;
  stockStatus?: string;
}

const HIDDEN_CATEGORY_NAMES = new Set(['stamping gj', 'stamping kl']);

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

/** Uncategorized catalog items not mapped to any product. */
export function getUnlinkedSpares(
  products: CatalogProduct[],
  linkedSpareIds: Set<string>,
): CatalogProduct[] {
  return getUncategorizedProducts(products).filter(p => !linkedSpareIds.has(p.id));
}

export function getCategoriesForProducts(
  categories: CatalogCategory[],
  products: CatalogProduct[],
): CatalogCategory[] {
  const ids = new Set(products.map(p => p.categoryId).filter(Boolean) as string[]);
  return categories.filter(c => ids.has(c.id));
}

function catalogErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = 'code' in err ? String((err as { code: string }).code) : '';
    const message = 'message' in err ? String((err as { message: string }).message) : '';
    if (code === 'functions/deadline-exceeded' || message.includes('deadline-exceeded')) {
      return 'Catalog sync timed out. Deploy the latest functions and try again — sync should finish in under a minute.';
    }
    if (
      code === 'functions/internal'
      || message.includes('CORS')
      || message.includes('Failed to fetch')
      || message.includes('not-found')
    ) {
      return 'Cloud Function unavailable. Deploy the latest functions (saveCatalogCategoryOrder, uploadCatalogCategoryThumbnail) to Firebase.';
    }
    if (message) return message;
  }
  return 'Unable to load product catalog.';
}

function mapProduct(data: Record<string, unknown>): CatalogProduct {
  const syncedAt = data.syncedAt as string | undefined;
  const rawImageUrl = (data.imageUrl as string | null) ?? null;
  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    sku: (data.sku as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    unit: String(data.unit ?? 'pcs'),
    rate: Number(data.rate ?? 0),
    stock: Number(data.stock ?? 0),
    stockStatus: (data.stockStatus as CatalogProduct['stockStatus']) ?? 'out_of_stock',
    imageUrl: withCatalogImageCacheBust(rawImageUrl, syncedAt),
    categoryId: (data.categoryId as string | null) ?? null,
    categoryName: (data.categoryName as string | null) ?? null,
    status: String(data.status ?? 'active'),
    hsn: (data.hsn as string | null) ?? null,
    taxName: (data.taxName as string | null) ?? null,
    taxPercentage: Number(data.taxPercentage ?? 0),
    reorderLevel: Number(data.reorderLevel ?? 0),
    syncedAt,
  };
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
    const existing = storedMap.get(categoryId) ?? derived.get(categoryId);
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

  const merged = new Map<string, CatalogCategory>();
  for (const cat of stored) {
    if (cat.id) merged.set(cat.id, { ...cat });
  }
  for (const [id, cat] of derived) {
    const prev = merged.get(id);
    merged.set(id, {
      ...cat,
      productCount: Math.max(cat.productCount, prev?.productCount ?? 0),
      thumbnailUrl: prev?.thumbnailUrl ?? cat.thumbnailUrl,
      displayOrder: prev?.displayOrder ?? cat.displayOrder,
    });
  }

  return [...merged.values()]
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

export async function uploadCatalogProductImage(
  productId: string,
  file: File,
): Promise<string> {
  const callable = httpsCallable<
    { productId: string; contentType: string; imageBase64: string },
    { imageUrl: string }
  >(functions, 'uploadCatalogProductImage', { timeout: 120_000 });

  try {
    const compressed = await compressImageForUpload(file);
    const imageBase64 = await fileToBase64(compressed);
    const result = await callable({
      productId,
      contentType: compressed.type || 'image/jpeg',
      imageBase64,
    });
    return withCatalogImageCacheBust(result.data.imageUrl, Date.now()) ?? result.data.imageUrl;
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
