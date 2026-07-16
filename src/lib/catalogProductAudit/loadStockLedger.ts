import { fetchCatalogProductLifetimeStockMovements } from './data';
import type { CatalogProductStockMovementsResult } from '../../types/catalog-product-audit';

/** Load lifetime stock ledger; auto-retries when a bad empty cache is returned. */
export async function loadCatalogProductStockLedger(
  catalogProductId: string,
  forceRefresh = false,
): Promise<CatalogProductStockMovementsResult> {
  let result = await fetchCatalogProductLifetimeStockMovements(catalogProductId, {
    forceRefresh,
  });

  const emptyBroken =
    (!result.movements?.length)
    && (result.currentStock == null)
    && !forceRefresh;

  if (emptyBroken) {
    result = await fetchCatalogProductLifetimeStockMovements(catalogProductId, {
      forceRefresh: true,
    });
  }

  return result;
}

export function isBrokenStockLedger(result: CatalogProductStockMovementsResult): boolean {
  return (!result.movements?.length) && result.currentStock == null;
}
