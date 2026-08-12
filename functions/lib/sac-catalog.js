/**
 * SAC (service accounting) codes start with 99.
 * These are services/fees — always sellable (never blocked as out of stock).
 */
export function isSacHsn(hsn) {
  const normalized = String(hsn ?? '').replace(/\s+/g, '').trim();
  return /^99\d{4,}$/.test(normalized);
}

export function isSoftwareKeysCategoryName(name) {
  return String(name ?? '').trim().toLowerCase() === 'software keys';
}

/** Software Keys — orderable without on-hand stock. */
export function catalogProductIgnoresStockForCart(product) {
  return isSoftwareKeysCategoryName(product?.categoryName);
}

/** UI hint only — dealers may order OOS / backorder lines. */
export function cartLineIsOutOfStock(line) {
  if (catalogProductIgnoresStockForCart(line)) return false;
  if (isSacHsn(line.hsn)) return false;
  return line.stockStatus === 'out_of_stock';
}

/** @deprecated Use cartLineIsOutOfStock. Checkout is no longer blocked by stock. */
export function cartLineBlockedByStock(line) {
  return cartLineIsOutOfStock(line);
}

export function effectiveCatalogStockStatus(stockStatus, hsn) {
  if (isSacHsn(hsn)) return 'in_stock';
  if (stockStatus === 'in_stock' || stockStatus === 'low_stock' || stockStatus === 'out_of_stock') {
    return stockStatus;
  }
  return 'out_of_stock';
}
