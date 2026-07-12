/**
 * SKU correction helpers — sanitize to 0-9A-Z and propose unique replacements.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { mutateCatalogProductDetails } from './catalog-product-mutations.js';

const PRODUCTS_COLLECTION = 'catalogProducts';

export function skuHasNonUppercaseAlphanumericChars(sku) {
  const value = String(sku ?? '');
  if (value === '') return false;
  return /[^0-9A-Z]/.test(value);
}

export function sanitizeSkuToUppercaseAlphanumeric(sku) {
  return String(sku ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * @param {{ id: string; name: string; sku: string | null }[]} products
 * @returns {Map<string, string>} productId → proposed SKU
 */
export function proposeCorrectedSkus(products) {
  const reserved = new Set();
  for (const product of products) {
    const sku = product.sku ?? '';
    if (sku) reserved.add(sku);
  }

  const invalid = products
    .filter(product => skuHasNonUppercaseAlphanumericChars(product.sku))
    .sort((a, b) => {
      const skuCmp = String(a.sku ?? '').localeCompare(String(b.sku ?? ''), undefined, {
        sensitivity: 'base',
      });
      if (skuCmp !== 0) return skuCmp;
      return String(a.name).localeCompare(String(b.name))
        || String(a.id).localeCompare(String(b.id));
    });

  const proposals = new Map();
  for (const product of invalid) {
    const base = sanitizeSkuToUppercaseAlphanumeric(product.sku) || 'SKU';
    let candidate = base;
    if (reserved.has(candidate)) {
      let n = 2;
      while (reserved.has(`${base}${n}`)) n += 1;
      candidate = `${base}${n}`;
    }
    reserved.add(candidate);
    proposals.set(product.id, candidate);
  }
  return proposals;
}

async function loadCatalogProductsForSkuRepair() {
  const snap = await getFirestore().collection(PRODUCTS_COLLECTION).get();
  return snap.docs.map(docSnap => {
    const data = docSnap.data() ?? {};
    return {
      id: String(data.id ?? docSnap.id),
      name: String(data.name ?? ''),
      sku: data.sku == null ? null : String(data.sku),
    };
  });
}

/**
 * Push every proposed SKU repair to Zoho, then mirror Firestore.
 * Continues on individual failures.
 */
export async function applyAllSkuRepairs(accessToken, organizationId) {
  const products = await loadCatalogProductsForSkuRepair();
  const proposals = proposeCorrectedSkus(products);
  const byId = new Map(products.map(p => [p.id, p]));

  const updated = [];
  const failed = [];

  for (const [productId, newSku] of proposals) {
    const product = byId.get(productId);
    if (!product) continue;
    const name = String(product.name ?? '').trim();
    if (!name) {
      failed.push({
        productId,
        oldSku: product.sku,
        newSku,
        error: 'Item name is missing.',
      });
      continue;
    }
    if (String(product.sku ?? '') === newSku) continue;

    try {
      await mutateCatalogProductDetails(accessToken, organizationId, productId, {
        name,
        sku: newSku,
      });
      updated.push({
        productId,
        oldSku: product.sku,
        newSku,
      });
    } catch (err) {
      failed.push({
        productId,
        oldSku: product.sku,
        newSku,
        error: err?.message ?? 'Update failed.',
      });
    }
  }

  return {
    total: proposals.size,
    updatedCount: updated.length,
    failedCount: failed.length,
    updated,
    failed,
  };
}
