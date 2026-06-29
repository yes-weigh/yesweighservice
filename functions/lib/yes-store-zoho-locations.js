import { syncCatalogProductStoreLocationsToZoho } from './zoho-item-store-locations.js';

export function collectCatalogProductIdsFromWrite(before, after) {
  const ids = new Set();
  const beforeId = String(before?.catalogProductId ?? '').trim();
  const afterId = String(after?.catalogProductId ?? '').trim();
  if (beforeId) ids.add(beforeId);
  if (afterId) ids.add(afterId);
  return [...ids];
}

export async function syncStoreLocationsForCatalogProducts(
  db,
  secrets,
  orgId,
  productIds,
  fieldConfig,
) {
  const unique = [...new Set(productIds.map(id => String(id ?? '').trim()).filter(Boolean))];
  const results = [];

  for (const productId of unique) {
    try {
      const result = await syncCatalogProductStoreLocationsToZoho(
        db,
        secrets,
        orgId,
        productId,
        fieldConfig,
      );
      results.push({ productId, ok: true, locationCount: result.locationCount });
    } catch (err) {
      console.error('[yes-store-zoho] sync failed for', productId, err);
      results.push({
        productId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
