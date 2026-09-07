import { useEffect } from 'react';
import { refreshSoftwareKeyLedgerStocks } from '../lib/softwareKeysLedgerRefresh';
import type { CatalogProduct } from '../types/catalog';

/** Reload junk / missing Software Key qty from the same live ledger as the Stock tab. */
export function useSoftwareKeyLedgerRepair(
  products: CatalogProduct[] | undefined,
  enabled = true,
): void {
  const count = products?.length ?? 0;
  useEffect(() => {
    if (!enabled || !products?.length) return;
    void refreshSoftwareKeyLedgerStocks(products, { onlyIfMissingOrImplausible: true });
    // catalog array identity changes on each ledger publish — start once it first loads
    // eslint-disable-next-line react-hooks/exhaustive-deps -- count is the load signal
  }, [enabled, count]);
}
