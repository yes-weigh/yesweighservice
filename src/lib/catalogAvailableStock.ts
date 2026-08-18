import { catalogSiteInventoryTotalQuantity } from '../types/catalog-site-inventory';
import type { CatalogProduct } from '../types/catalog';
import { readItemQuantity } from '../types/yes-store';
import { getCatalogProductsByIds } from './catalog';
import { catalogGridStockQty } from './catalogProductAudit/display';
import { getCatalogSiteInventory } from './catalogSiteInventory/data';
import { isSoftwareKeysLedgerStockProduct } from './softwareKeysLedgerStock';
import { listItemsByCatalogProduct } from './yesStore/data';

async function liveWarehouseQty(productId: string): Promise<number | null> {
  const [headOffice, cochin] = await Promise.all([
    getCatalogSiteInventory(productId, 'head_office').catch(() => null),
    getCatalogSiteInventory(productId, 'cochin').catch(() => null),
  ]);
  let total = 0;
  let hasSite = false;
  if (headOffice) {
    total += catalogSiteInventoryTotalQuantity(headOffice);
    hasSite = true;
  }
  if (cochin) {
    total += catalogSiteInventoryTotalQuantity(cochin);
    hasSite = true;
  }
  return hasSite ? total : null;
}

/**
 * Live audited qty for SO review / Verify & invoice.
 * Software Keys (997331): ledger closing stock (same as catalog grid).
 * Other products: audited stock (Zoho + Diff) from the live catalog doc.
 * If never audited, sum live Head Office + Cochin warehouse qty.
 */
export async function resolveAvailableQtyByProductIds(
  productIds: string[],
  catalogById: Record<string, CatalogProduct> = {},
): Promise<Map<string, number>> {
  const unique = [...new Set(productIds.map(id => id.trim()).filter(Boolean))];
  const map = new Map<string, number>();
  const liveById = unique.length ? await getCatalogProductsByIds(unique) : {};

  await Promise.all(unique.map(async id => {
    try {
      const product = liveById[id] ?? catalogById[id];
      if (product && (
        isSoftwareKeysLedgerStockProduct(product)
        || product.auditSnapshot
      )) {
        map.set(id, catalogGridStockQty(product));
        return;
      }
      const warehouse = await liveWarehouseQty(id);
      if (warehouse != null) {
        map.set(id, warehouse);
        return;
      }
      const bins = await listItemsByCatalogProduct(id);
      if (bins.length > 0) {
        map.set(id, bins.reduce((sum, item) => sum + readItemQuantity(item), 0));
        return;
      }
      if (product && Number.isFinite(product.stock)) {
        map.set(id, product.stock);
        return;
      }
      map.set(id, 0);
    } catch {
      map.set(id, 0);
    }
  }));

  return map;
}
