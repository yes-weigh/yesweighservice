import { getFirestore } from 'firebase-admin/firestore';

/**
 * HSN / SAC codes used to classify invoices.
 * Multiple codes per category are OR-matched (existing + newly added).
 */
export const INVOICE_CATEGORY_HSN = {
  service: ['998717', '998719'],
  software_key: ['85238020', '85238010'],
  gatc: ['998346', '79061190'],
  freight: ['996812'],
};

export const INVOICE_CATEGORIES = ['product', 'spare', 'service', 'software_key', 'gatc'];

export function normalizeHsn(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function hsnMatchesCategory(hsn, codes) {
  return Boolean(hsn) && Array.isArray(codes) && codes.includes(hsn);
}

function isGatcFeeLineItem(name, sku, hsn) {
  if (hsnMatchesCategory(normalizeHsn(hsn), INVOICE_CATEGORY_HSN.gatc)) return true;
  const itemName = String(name ?? '').trim().toLowerCase();
  if (itemName.includes('gatc fee')) return true;
  const itemSku = String(sku ?? '').trim().toLowerCase();
  return /^grv\d/.test(itemSku);
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

/** Portal order segments: software keys + sanoft → software_key icon/filter. */
export function isSoftwareSegmentCategoryName(name) {
  const normalized = String(name ?? '').trim().toLowerCase();
  return normalized === 'software keys' || normalized === 'sanoft';
}

export function isFreightLineItem(name, sku, hsn) {
  if (hsnMatchesCategory(normalizeHsn(hsn), INVOICE_CATEGORY_HSN.freight)) return true;
  const itemName = String(name ?? '').trim().toLowerCase();
  if (itemName === 'freight' || itemName.includes('freight')) return true;
  const itemSku = String(sku ?? '').trim().toLowerCase();
  return itemSku === 'freight' || itemSku.includes('freight');
}

/** Lines omitted from qty totals: freight and GATC lines. */
export function isQuantityExcludedLineItem(name, sku, hsn) {
  if (isGatcFeeLineItem(name, sku, hsn)) return true;
  return isFreightLineItem(name, sku, hsn);
}

/** Sum line quantities excluding freight and GATC. */
export function sumNonFreightQuantity(lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  return items.reduce((sum, item) => {
    if (isQuantityExcludedLineItem(item?.name, item?.sku, item?.hsn)) return sum;
    return sum + Number(item?.quantity || 0);
  }, 0);
}

/** Uncategorized, missing catalog, or Generic spare parts → spare. */
export function isSpareCatalogItem(catalog) {
  if (!catalog) return true;
  const categoryId = String(catalog.categoryId ?? '').trim();
  if (!categoryId || categoryId === '-1') return true;
  if (isGenericSpareCategoryName(catalog.categoryName)) return true;
  return false;
}

function emptyCategoryTotals() {
  return {
    product: 0,
    spare: 0,
    service: 0,
    software_key: 0,
    gatc: 0,
  };
}

export function classifyInvoiceLineItem(item, catalogByItemId = new Map()) {
  if (isFreightLineItem(item?.name, item?.sku, item?.hsn)) return null;
  const itemId = item?.itemId ? String(item.itemId) : '';
  const catalog = itemId ? catalogByItemId.get(itemId) : null;
  const hsn = normalizeHsn(item?.hsn || catalog?.hsn);

  if (isGatcFeeLineItem(item?.name, item?.sku, item?.hsn || catalog?.hsn)) return 'gatc';
  if (hsnMatchesCategory(hsn, INVOICE_CATEGORY_HSN.service)) return 'service';
  if (hsnMatchesCategory(hsn, INVOICE_CATEGORY_HSN.software_key)) return 'software_key';
  if (isSoftwareSegmentCategoryName(catalog?.categoryName) || isSoftwareSegmentCategoryName(item?.categoryName)) {
    return 'software_key';
  }
  if (isSpareCatalogItem(catalog)) return 'spare';
  return 'product';
}

export function classifyInvoiceCategoryBreakdown(lineItems, catalogByItemId = new Map()) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const totals = emptyCategoryTotals();
  const counts = emptyCategoryTotals();

  for (const item of items) {
    const category = classifyInvoiceLineItem(item, catalogByItemId);
    if (!category) continue;
    totals[category] += Number(item?.total ?? 0);
    counts[category] += 1;
  }

  const categories = INVOICE_CATEGORIES.filter(category => totals[category] > 0 || counts[category] > 0);
  if (!categories.length) {
    return {
      categories: ['spare'],
      categoryAmounts: { spare: 0 },
      categoryLineCounts: { spare: 0 },
    };
  }

  const categoryAmounts = {};
  const categoryLineCounts = {};
  for (const category of categories) {
    categoryAmounts[category] = totals[category];
    categoryLineCounts[category] = counts[category];
  }
  return { categories, categoryAmounts, categoryLineCounts };
}

/**
 * Legacy single-category accessor kept during migration.
 *
 * @param {Array<{ total?: number, name?: string, sku?: string|null, itemId?: string|null, hsn?: string|null }>} lineItems
 * @param {Map<string, { hsn?: string|null, categoryId?: string|null, categoryName?: string|null }>} catalogByItemId
 * @returns {'product'|'spare'|'service'|'software_key'|'gatc'}
 */
export function classifyInvoiceFromLineItems(lineItems, catalogByItemId = new Map()) {
  return classifyInvoiceCategoryBreakdown(lineItems, catalogByItemId).categories[0] ?? 'spare';
}

export function parseInvoiceCategory(value) {
  const key = String(value ?? '').trim();
  return INVOICE_CATEGORIES.includes(key) ? key : null;
}

/**
 * Software-only docs (HSN 85238020/85238010, Software keys / Sanoft category).
 * Mixed product/spare + software bills are kept.
 */
export function isSoftwareOnlyInvoiceCategories(categories, primaryCategory) {
  const parsed = Array.isArray(categories)
    ? INVOICE_CATEGORIES.filter(category => categories.includes(category))
    : [];
  const primary = parseInvoiceCategory(primaryCategory);
  const cats = parsed.length ? parsed : (primary ? [primary] : []);
  if (!cats.length) return false;
  if (cats.some(category => category === 'product' || category === 'spare')) return false;
  return cats.includes('software_key');
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
    gatc: 0,
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
      const hasMulti = Array.isArray(data.categories) && data.categories.length > 0;
      if (onlyMissing && current && hasMulti) {
        skipped += 1;
        continue;
      }

      const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];
      const breakdown = classifyInvoiceCategoryBreakdown(lineItems, catalogMap);
      const next = breakdown.categories[0] ?? 'spare';
      byCategory[next] = (byCategory[next] || 0) + 1;

      const samePrimary = current === next;
      const sameCategories = JSON.stringify(data.categories ?? []) === JSON.stringify(breakdown.categories);
      const sameAmounts = JSON.stringify(data.categoryAmounts ?? {}) === JSON.stringify(breakdown.categoryAmounts);
      if (samePrimary && sameCategories && sameAmounts) {
        unchanged += 1;
        continue;
      }

      batch.update(docSnap.ref, {
        invoiceCategory: next,
        categories: breakdown.categories,
        categoryAmounts: breakdown.categoryAmounts,
      });
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
