import { fetchCatalogProductLifetimeStockMovements } from './data';
import type { CatalogProductStockMovementsResult } from '../../types/catalog-product-audit';

/** Load lifetime stock ledger live from Zoho. */
export async function loadCatalogProductStockLedger(
  catalogProductId: string,
): Promise<CatalogProductStockMovementsResult> {
  return fetchCatalogProductLifetimeStockMovements(catalogProductId);
}

/** True only when Zoho fetch explicitly failed — an empty ledger is valid. */
export function isBrokenStockLedger(result: CatalogProductStockMovementsResult): boolean {
  return Boolean(result.zohoFetchFailed);
}
