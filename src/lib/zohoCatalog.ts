import type { ZohoCatalogResponse } from '../types/zoho';
import { fetchCatalog } from './catalog';

/** @deprecated Use fetchCatalog from ./catalog */
export async function fetchZohoCatalog(): Promise<ZohoCatalogResponse> {
  const catalog = await fetchCatalog();

  return {
    organizationId: '',
    syncedAt: catalog.syncedAt ?? new Date().toISOString(),
    stats: {
      totalItems: catalog.stats.totalProducts,
      totalGroups: catalog.stats.totalCategories,
      activeItems: catalog.stats.totalProducts,
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
      groupId: item.categoryId ?? undefined,
      groupName: item.categoryName ?? undefined,
    })),
    itemGroups: catalog.categories.map(cat => ({
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
          groupId: item.categoryId ?? undefined,
          groupName: item.categoryName ?? undefined,
        })),
    })),
  };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}
