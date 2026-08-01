import type { CatalogCategory, CatalogProduct } from '../types/catalog';

/** SAC code for software-key subscription items that use ledger closing stock in the grid. */
export const SOFTWARE_KEYS_LEDGER_HSN = '997331';

export function normalizeCatalogHsn(hsn: string | null | undefined): string {
  return String(hsn ?? '').replace(/\s+/g, '').trim();
}

function isSoftwareKeysCategory(category: Pick<CatalogCategory, 'name'>): boolean {
  return category.name.trim().toLowerCase() === 'software keys';
}

/** Software Keys category + HSN 997331 — grid stock comes from ledger closing, not audit. */
export function isSoftwareKeysLedgerStockProduct(
  product: Pick<CatalogProduct, 'categoryName' | 'categoryId' | 'hsn'>,
  categories: CatalogCategory[] = [],
): boolean {
  if (normalizeCatalogHsn(product.hsn) !== SOFTWARE_KEYS_LEDGER_HSN) return false;
  if (product.categoryName && isSoftwareKeysCategory({ name: product.categoryName })) {
    return true;
  }
  if (product.categoryId && categories.length) {
    const cat = categories.find(c => c.id === product.categoryId);
    if (cat && isSoftwareKeysCategory(cat)) return true;
  }
  return false;
}
