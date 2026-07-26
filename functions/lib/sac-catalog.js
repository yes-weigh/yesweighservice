/**
 * SAC (service accounting) codes start with 99.
 * These are services/fees — always sellable (never blocked as out of stock).
 */
export function isSacHsn(hsn) {
  const normalized = String(hsn ?? '').replace(/\s+/g, '').trim();
  return /^99\d{4,}$/.test(normalized);
}

export function effectiveCatalogStockStatus(stockStatus, hsn) {
  if (isSacHsn(hsn)) return 'in_stock';
  if (stockStatus === 'in_stock' || stockStatus === 'low_stock' || stockStatus === 'out_of_stock') {
    return stockStatus;
  }
  return 'out_of_stock';
}
