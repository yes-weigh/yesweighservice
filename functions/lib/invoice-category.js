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

async function loadCatalogMetaForItemIds(itemIds) {
  const unique = [...new Set(itemIds.filter(Boolean).map(String))];
  const map = new Map();
  if (!unique.length) return map;

  const db = getFirestore();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const refs = chunk.map(id => db.collection('catalogProducts').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      map.set(snap.id, {
        hsn: data.hsn != null ? String(data.hsn) : null,
        categoryId: data.categoryId != null ? String(data.categoryId) : null,
        categoryName: data.categoryName != null ? String(data.categoryName) : null,
      });
    }
  }
  return map;
}

/**
 * Reclassify invoices already in Firestore using lineItems[].itemId → catalogProducts (HSN/category).
 * No Zoho API calls.
 *
 * @param {{ onlyMissing?: boolean, pageSize?: number }} [options]
 */
export async function reclassifyInvoiceCategoriesFromCatalog(options = {}) {
  const onlyMissing = options.onlyMissing === true;
  const pageSize = Math.min(Math.max(Number(options.pageSize) || 200, 50), 400);
  const db = getFirestore();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  const byCategory = {
    product: 0,
    spare: 0,
    service: 0,
    software_key: 0,
  };
  let lastDoc = null;

  while (true) {
    let query = db.collectionGroup('invoices').limit(pageSize);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snap = await query.get();
    if (snap.empty) break;

    const pageDocs = snap.docs;
    const itemIds = [];
    for (const docSnap of pageDocs) {
      const lineItems = Array.isArray(docSnap.data()?.lineItems) ? docSnap.data().lineItems : [];
      for (const item of lineItems) {
        if (item?.itemId) itemIds.push(String(item.itemId));
      }
    }
    const catalogMap = await loadCatalogMetaForItemIds(itemIds);

    let batch = db.batch();
    let batchCount = 0;

    for (const docSnap of pageDocs) {
      scanned += 1;
      const data = docSnap.data() || {};
      const current = parseInvoiceCategory(data.invoiceCategory);
      if (onlyMissing && current) {
        skipped += 1;
        continue;
      }

      const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];
      const next = classifyInvoiceFromLineItems(lineItems, catalogMap);
      byCategory[next] = (byCategory[next] || 0) + 1;

      if (current === next) {
        unchanged += 1;
        continue;
      }

      batch.update(docSnap.ref, { invoiceCategory: next });
      batchCount += 1;
      updated += 1;
      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) await batch.commit();
    lastDoc = pageDocs[pageDocs.length - 1];
    if (snap.size < pageSize) break;
  }

  return { scanned, updated, skipped, unchanged, byCategory };
}

/** @deprecated Use reclassifyInvoiceCategoriesFromCatalog */
export async function backfillInvoiceCategoriesToProduct(options = {}) {
  return reclassifyInvoiceCategoriesFromCatalog({
    onlyMissing: options.onlyMissing === true,
    pageSize: options.pageSize,
  });
}
