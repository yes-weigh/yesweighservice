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
 * Continues on individual failures. Limited concurrency keeps Zoho happy
 * while finishing large batches inside the function timeout.
 */
export async function applyAllSkuRepairs(accessToken, organizationId) {
  const products = await loadCatalogProductsForSkuRepair();
  const proposals = proposeCorrectedSkus(products);
  const byId = new Map(products.map(p => [p.id, p]));

  const jobs = [];
  for (const [productId, newSku] of proposals) {
    const product = byId.get(productId);
    if (!product) continue;
    const name = String(product.name ?? '').trim();
    if (!name) {
      jobs.push({
        kind: 'invalid',
        productId,
        oldSku: product.sku,
        newSku,
        error: 'Item name is missing.',
      });
      continue;
    }
    if (String(product.sku ?? '') === newSku) continue;
    jobs.push({
      kind: 'update',
      productId,
      oldSku: product.sku,
      newSku,
      name,
    });
  }

  const updated = [];
  const failed = [];
  const concurrency = 1;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < jobs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const job = jobs[index];
      if (job.kind === 'invalid') {
        failed.push({
          productId: job.productId,
          oldSku: job.oldSku,
          newSku: job.newSku,
          error: job.error,
        });
        continue;
      }

      try {
        await mutateCatalogProductDetails(accessToken, organizationId, job.productId, {
          name: job.name,
          sku: job.newSku,
        });
        updated.push({
          productId: job.productId,
          oldSku: job.oldSku,
          newSku: job.newSku,
        });
      } catch (err) {
        failed.push({
          productId: job.productId,
          oldSku: job.oldSku,
          newSku: job.newSku,
          error: err?.message ?? 'Update failed.',
        });
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(jobs.length, 1)) },
    () => worker(),
  );
  await Promise.all(workers);

  return {
    total: proposals.size,
    updatedCount: updated.length,
    failedCount: failed.length,
    updated,
    failed,
  };
}
