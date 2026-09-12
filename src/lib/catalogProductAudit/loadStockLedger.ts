import { fetchCatalogProductLifetimeStockMovements } from './data';
import type { CatalogProductStockMovementsResult } from '../../types/catalog-product-audit';

/** Load lifetime stock ledger (cached 6h; forceRefresh hits Zoho if quota allows). */
export async function loadCatalogProductStockLedger(
  catalogProductId: string,
  options?: { forceRefresh?: boolean },
): Promise<CatalogProductStockMovementsResult> {
  return fetchCatalogProductLifetimeStockMovements(catalogProductId, options);
}

/** True only when Zoho fetch explicitly failed — an empty ledger is valid. */
export function isBrokenStockLedger(result: CatalogProductStockMovementsResult): boolean {
  return Boolean(result.zohoFetchFailed);
}
