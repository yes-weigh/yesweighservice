import type { StockStatus } from '../types/catalog';

/**
 * SAC (service accounting) codes start with 99.
 * These are services/fees — treated as in stock in the catalog.
 */
export function isSacHsn(hsn: string | null | undefined): boolean {
  const digits = String(hsn ?? '').replace(/\D/g, '');
  // GST chapter 99 = services (4–8 digit SAC). Inventory items are 01–98.
  return digits.startsWith('99') && digits.length >= 2;
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
