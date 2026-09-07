import type { CatalogCategory, CatalogProduct } from '../types/catalog';

/** SAC code for subscription keys that Zoho treats as non-inventory. */
export const SOFTWARE_KEYS_LEDGER_HSN = '997331';

export function normalizeCatalogHsn(hsn: string | null | undefined): string {
  return String(hsn ?? '').replace(/\s+/g, '').trim();
}

export function isSoftwareKeysCategoryName(name: string | null | undefined): boolean {
  return String(name ?? '').trim().toLowerCase() === 'software keys';
}

/**
 * Software Keys category — grid stock comes from ledger closing (in − out),
 * not warehouse audit. HSN 85238020/997331 both qualify.
 */
export function isSoftwareKeysLedgerStockProduct(
  product: Pick<CatalogProduct, 'categoryName' | 'categoryId' | 'hsn'>,
  categories: CatalogCategory[] = [],
): boolean {
  if (product.categoryName && isSoftwareKeysCategoryName(product.categoryName)) {
    return true;
  }
  if (product.categoryId && categories.length) {
    const cat = categories.find(c => c.id === product.categoryId);
    if (cat && isSoftwareKeysCategoryName(cat.name)) return true;
  }
  return false;
}
