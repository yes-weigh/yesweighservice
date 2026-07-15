import type { CatalogProduct } from '../types/catalog';
import type { CatalogInventorySite } from '../types/catalog-site-inventory';
import type { CatalogSiteInventoryDoc } from '../types/catalog-site-inventory';
import type { YesStoreItemDoc } from '../types/yes-store';
import { catalogProductWarehouseStock, SPARE_WAREHOUSE_LOCATION_FILTERS } from './catalog';

export const CATALOG_WAREHOUSE_COCHIN = SPARE_WAREHOUSE_LOCATION_FILTERS[0].warehouseName;
export const CATALOG_WAREHOUSE_HEAD_OFFICE = SPARE_WAREHOUSE_LOCATION_FILTERS[1].warehouseName;

export interface CatalogInventorySiteConfig {
  site: CatalogInventorySite;
  warehouseName: string;
  locationSubtitle: string;
}

export const CATALOG_INVENTORY_SITE_CONFIG: Record<CatalogInventorySite, CatalogInventorySiteConfig> = {
  cochin: {
    site: 'cochin',
    warehouseName: CATALOG_WAREHOUSE_COCHIN,
    locationSubtitle: 'Warehouse',
  },
  head_office: {
    site: 'head_office',
    warehouseName: CATALOG_WAREHOUSE_HEAD_OFFICE,
    locationSubtitle: 'Store room',
  },
};

export function resolveActiveInventorySites(input: {
  product: Pick<CatalogProduct, 'warehouses'>;
  auditItems: YesStoreItemDoc[];
  cochinRecord: CatalogSiteInventoryDoc | null;
  headOfficeRecord?: CatalogSiteInventoryDoc | null;
  /** When set, always expose the primary audit site even if Zoho stock is 0. */
  preferredSite?: CatalogInventorySite | null;
}): CatalogInventorySite[] {
  const sites: CatalogInventorySite[] = [];
  const hasCochinStock = catalogProductWarehouseStock(input.product, CATALOG_WAREHOUSE_COCHIN) !== 0;
  const hasHeadOfficeStock = catalogProductWarehouseStock(input.product, CATALOG_WAREHOUSE_HEAD_OFFICE) !== 0;

  if (hasHeadOfficeStock || input.auditItems.length > 0 || input.headOfficeRecord) {
    sites.push('head_office');
  }
  if (hasCochinStock || input.cochinRecord) {
    sites.push('cochin');
  }

  if (sites.length === 0) {
    if (input.preferredSite) {
      sites.push(input.preferredSite);
      return sites;
    }
    const warehouses = input.product.warehouses ?? [];
    if (warehouses.length === 0) {
      if (input.auditItems.length > 0) sites.push('head_office');
    } else {
      const primary = warehouses.reduce((best, row) => (
        Math.abs(row.stock) > Math.abs(best.stock) ? row : best
      ), warehouses[0]);
      const name = primary.warehouseName.trim().toLowerCase();
      if (name.includes('cochin')) sites.push('cochin');
      else if (name.includes('head') || name.includes('office')) sites.push('head_office');
    }
  }

  if (sites.length === 0 && input.preferredSite) {
    sites.push(input.preferredSite);
  }

  return sites;
}

export function siteAuditedDifference(auditedQty: number | null, zohoQty: number): number | null {
  if (auditedQty == null) return null;
  return auditedQty - zohoQty;
}

export function diffTone(difference: number | null): 'over' | 'under' | 'match' | undefined {
  if (difference == null) return undefined;
  if (difference > 0) return 'over';
  if (difference < 0) return 'under';
  return 'match';
}
