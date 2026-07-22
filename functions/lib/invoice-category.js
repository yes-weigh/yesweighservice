/** HSN / SAC codes used to classify invoices from the highest-value line item. */
export const INVOICE_CATEGORY_HSN = {
  service: '998717',
  software_key: '85238020',
};

export const INVOICE_CATEGORIES = ['product', 'spare', 'service', 'software_key'];

export function normalizeHsn(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

export function isGenericSpareCategoryName(name) {
  const normalized = String(name ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === 'generic spare parts'
    || normalized === 'generic spares'
    || normalized.includes('generic spare')
  );
}

export function isFreightLineItem(name, sku) {
  const itemName = String(name ?? '').trim().toLowerCase();
  if (itemName === 'freight' || itemName.includes('freight')) return true;
  const itemSku = String(sku ?? '').trim().toLowerCase();
  return itemSku === 'freight' || itemSku.includes('freight');
}

/** Uncategorized, missing catalog, or Generic spare parts → spare. */
export function isSpareCatalogItem(catalog) {
  if (!catalog) return true;
  const categoryId = String(catalog.categoryId ?? '').trim();
  if (!categoryId || categoryId === '-1') return true;
  if (isGenericSpareCategoryName(catalog.categoryName)) return true;
  return false;
}

/**
 * Classify an invoice from its line items + catalog metadata.
 * Uses the non-freight line with the highest `total`.
 *
 * @param {Array<{ total?: number, name?: string, sku?: string|null, itemId?: string|null, hsn?: string|null }>} lineItems
 * @param {Map<string, { hsn?: string|null, categoryId?: string|null, categoryName?: string|null }>} catalogByItemId
 * @returns {'product'|'spare'|'service'|'software_key'}
 */
export function classifyInvoiceFromLineItems(lineItems, catalogByItemId = new Map()) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const candidates = items.filter(item => !isFreightLineItem(item?.name, item?.sku));
  if (!candidates.length) return 'spare';

  let top = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    const item = candidates[i];
    if (Number(item.total ?? 0) > Number(top.total ?? 0)) top = item;
  }

  const itemId = top.itemId ? String(top.itemId) : '';
  const catalog = itemId ? catalogByItemId.get(itemId) : null;
  const hsn = normalizeHsn(top.hsn || catalog?.hsn);

  if (hsn === INVOICE_CATEGORY_HSN.service) return 'service';
  if (hsn === INVOICE_CATEGORY_HSN.software_key) return 'software_key';
  if (isSpareCatalogItem(catalog)) return 'spare';
  return 'product';
}

export function parseInvoiceCategory(value) {
  const key = String(value ?? '').trim();
  return INVOICE_CATEGORIES.includes(key) ? key : null;
}
