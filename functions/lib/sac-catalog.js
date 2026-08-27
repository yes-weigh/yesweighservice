/**
 * SAC (service accounting) codes start with 99.
 * These are services/fees — force in_stock via effectiveCatalogStockStatus.
 */
export function isSacHsn(hsn) {
  const digits = String(hsn ?? '').replace(/\D/g, '');
  // GST chapter 99 = services (4–8 digit SAC). Inventory items are 01–98.
  return digits.startsWith('99') && digits.length >= 2;
}

export function effectiveCatalogStockStatus(stockStatus, hsn) {
  if (isSacHsn(hsn)) return 'in_stock';
  if (stockStatus === 'in_stock' || stockStatus === 'low_stock' || stockStatus === 'out_of_stock') {
    return stockStatus;
  }
  return 'out_of_stock';
}
