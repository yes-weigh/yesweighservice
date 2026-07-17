import { fetchCatalogProductLifetimeStockMovements } from './data';
import type { CatalogProductStockMovementsResult } from '../../types/catalog-product-audit';

/** Load lifetime stock ledger live from Zoho. */
export async function loadCatalogProductStockLedger(
  catalogProductId: string,
): Promise<CatalogProductStockMovementsResult> {
  return fetchCatalogProductLifetimeStockMovements(catalogProductId);
}

export function isBrokenStockLedger(result: CatalogProductStockMovementsResult): boolean {
  return (!result.movements?.length) && result.currentStock == null;
}
