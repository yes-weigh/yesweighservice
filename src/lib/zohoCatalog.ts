import type { ZohoCatalogResponse } from '../types/zoho';
import { fetchCatalog } from './catalog';

/**
 * @deprecated Use fetchCatalog from ./catalog — maps category fields to legacy group names
 * for callers that still expect groupId / itemGroups.
 */
export async function fetchZohoCatalog(): Promise<ZohoCatalogResponse & {
  /** @deprecated Use categories */
  itemGroups: ZohoCatalogResponse['categories'];
  stats: ZohoCatalogResponse['stats'] & {
    /** @deprecated Use totalCategories */
    totalGroups: number;
    /** @deprecated Use activeCategories */
    activeGroups: number;
  };
  items: Array<ZohoCatalogResponse['items'][number] & {
    /** @deprecated Use categoryId */
    groupId?: string;
    /** @deprecated Use categoryName */
    groupName?: string;
  }>;
}> {
  const catalog = await fetchCatalog();

  const categories = catalog.categories.map(cat => ({
    id: cat.id,
    name: cat.name,
    description: '',
    status: 'active',
    unit: '',
    itemCount: cat.productCount,
    items: catalog.items
      .filter(p => p.categoryId === cat.id)
      .map(item => ({
        id: item.id,
        name: item.name,
        sku: item.sku ?? '',
        rate: item.rate,
        status: item.status,
        unit: item.unit,
        type: '',
        description: item.description ?? '',
        categoryId: item.categoryId ?? undefined,
        categoryName: item.categoryName ?? undefined,
        groupId: item.categoryId ?? undefined,
        groupName: item.categoryName ?? undefined,
      })),
  }));

  return {
    organizationId: '',
    syncedAt: catalog.syncedAt ?? new Date().toISOString(),
    stats: {
      totalItems: catalog.stats.totalProducts,
      totalCategories: catalog.stats.totalCategories,
      activeItems: catalog.stats.totalProducts,
      activeCategories: catalog.stats.totalCategories,
      totalGroups: catalog.stats.totalCategories,
      activeGroups: catalog.stats.totalCategories,
    },
    items: catalog.items.map(item => ({
      id: item.id,
      name: item.name,
      sku: item.sku ?? '',
      rate: item.rate,
      status: item.status,
      unit: item.unit,
      type: '',
      description: item.description ?? '',
      categoryId: item.categoryId ?? undefined,
      categoryName: item.categoryName ?? undefined,
      groupId: item.categoryId ?? undefined,
      groupName: item.categoryName ?? undefined,
    })),
    categories,
    itemGroups: categories,
  };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}
