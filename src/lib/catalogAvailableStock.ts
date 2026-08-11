import { catalogSiteInventoryTotalQuantity } from '../types/catalog-site-inventory';
import type { CatalogProduct } from '../types/catalog';
import { readItemQuantity } from '../types/yes-store';
import { catalogGridStockQty } from './catalogProductAudit/display';
import { getCatalogSiteInventory } from './catalogSiteInventory/data';
import { isSoftwareKeysLedgerStockProduct } from './softwareKeysLedgerStock';
import { listItemsByCatalogProduct } from './yesStore/data';

/**
 * Available qty for SO review.
 * Software Keys (997331): ledger closing stock (same as catalog grid).
 * Other products: Cochin site inventory → warehouse bins → Zoho book stock.
 */
export async function resolveAvailableQtyByProductIds(
  productIds: string[],
  catalogById: Record<string, CatalogProduct> = {},
): Promise<Map<string, number>> {
  const unique = [...new Set(productIds.map(id => id.trim()).filter(Boolean))];
  const map = new Map<string, number>();

  await Promise.all(unique.map(async id => {
    try {
      const product = catalogById[id];
      if (product && isSoftwareKeysLedgerStockProduct(product)) {
        map.set(id, catalogGridStockQty(product));
        return;
      }
      const cochin = await getCatalogSiteInventory(id, 'cochin');
      if (cochin) {
        map.set(id, catalogSiteInventoryTotalQuantity(cochin));
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
