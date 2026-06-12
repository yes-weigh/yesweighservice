import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { app, db } from '../firebase';
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

function catalogErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return 'Unable to load product catalog.';
}

function mapProduct(data: Record<string, unknown>): CatalogProduct {
  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    sku: (data.sku as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    unit: String(data.unit ?? 'pcs'),
    rate: Number(data.rate ?? 0),
    stock: Number(data.stock ?? 0),
    stockStatus: (data.stockStatus as CatalogProduct['stockStatus']) ?? 'out_of_stock',
    imageUrl: (data.imageUrl as string | null) ?? null,
    categoryId: (data.categoryId as string | null) ?? null,
    categoryName: (data.categoryName as string | null) ?? null,
    status: String(data.status ?? 'active'),
    hsn: (data.hsn as string | null) ?? null,
    taxName: (data.taxName as string | null) ?? null,
    taxPercentage: Number(data.taxPercentage ?? 0),
    reorderLevel: Number(data.reorderLevel ?? 0),
    syncedAt: data.syncedAt as string | undefined,
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

    const categories = categoriesSnap.docs
      .map(snap => mapCategory(snap.data() as Record<string, unknown>))
      .filter(cat => cat.id && cat.productCount > 0)
      .sort((a, b) => {
        const orderDiff = a.displayOrder - b.displayOrder;
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name);
      });

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
    return result.data;
  } catch (err) {
    throw new Error(catalogErrorMessage(err));
  }
}

export async function syncCatalog(): Promise<{ syncedCount: number; syncedAt: string }> {
  const callable = httpsCallable<undefined, { syncedCount: number; syncedAt: string }>(
    functions,
    'syncZohoCatalog',
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
