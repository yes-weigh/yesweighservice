import type { CatalogProduct } from '../types/catalog';

/**
 * Auto catalog-wide software-key ledger refresh used to loop every SKU through
 * live Zoho lifetime pulls and exhausted the 10k daily API cap.
 * Closing stock now updates from the Stock tab (cached 6h) and a 4:30 AM job.
 */
export function softwareKeyNeedsLedgerRefresh(_product: CatalogProduct): boolean {
  return false;
}

export async function refreshSoftwareKeyLedgerStocks(
  _products: CatalogProduct[],
  _opts?: { onlyIfMissingOrImplausible?: boolean },
): Promise<void> {
  return;
}
