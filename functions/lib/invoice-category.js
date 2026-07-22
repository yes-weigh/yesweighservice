import { getFirestore } from 'firebase-admin/firestore';

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

/**
 * Stamp existing Firestore invoices as `product`.
 * New Zoho invoices keep guideline classification at sync time.
 *
 * @param {{ onlyMissing?: boolean, pageSize?: number }} [options]
 */
export async function backfillInvoiceCategoriesToProduct(options = {}) {
  const onlyMissing = options.onlyMissing !== false;
  const pageSize = Math.min(Math.max(Number(options.pageSize) || 300, 50), 500);
  const db = getFirestore();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let lastDoc = null;

  while (true) {
    let query = db.collectionGroup('invoices').limit(pageSize);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snap = await query.get();
    if (snap.empty) break;

    let batch = db.batch();
    let batchCount = 0;

    for (const docSnap of snap.docs) {
      scanned += 1;
      const current = parseInvoiceCategory(docSnap.data()?.invoiceCategory);
      if (onlyMissing && current) {
        skipped += 1;
        continue;
      }
      if (current === 'product') {
        skipped += 1;
        continue;
      }
      batch.update(docSnap.ref, { invoiceCategory: 'product' });
      batchCount += 1;
      updated += 1;
      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) await batch.commit();
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  return { scanned, updated, skipped, category: 'product' };
}
