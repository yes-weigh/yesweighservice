import type { StockStatus } from '../types/catalog';

/**
 * SAC (service accounting) codes start with 99.
 * These are services/fees — always sellable in the portal cart.
 */
export function isSacHsn(hsn: string | null | undefined): boolean {
  const normalized = String(hsn ?? '').replace(/\s+/g, '').trim();
  return /^99\d{4,}$/.test(normalized);
}

/** Force SAC catalog rows to appear / behave as in stock. */
export function effectiveCatalogStockStatus(
  stockStatus: string | null | undefined,
  hsn?: string | null,
): StockStatus {
  if (isSacHsn(hsn)) return 'in_stock';
  if (stockStatus === 'in_stock' || stockStatus === 'low_stock' || stockStatus === 'out_of_stock') {
    return stockStatus;
  }
  return 'out_of_stock';
}
