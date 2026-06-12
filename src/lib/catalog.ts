import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');
import type { CatalogProductDetail, CatalogResponse } from '../types/catalog';

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

export async function fetchCatalog(filters: CatalogFilters = {}): Promise<CatalogResponse> {
  const callable = httpsCallable<CatalogFilters, CatalogResponse>(functions, 'getCatalog');
  try {
    const result = await callable(filters);
    return result.data;
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
