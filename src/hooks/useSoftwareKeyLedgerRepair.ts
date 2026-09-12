import type { CatalogProduct } from '../types/catalog';

/** Disabled — catalog-wide Zoho lifetime pulls exhausted the daily API cap. */
export function useSoftwareKeyLedgerRepair(
  _products: CatalogProduct[] | undefined,
  _enabled = true,
): void {
  return;
}
