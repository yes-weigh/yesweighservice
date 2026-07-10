/**
 * Catalog product write contract
 * ----------------------------
 * Zoho-backed fields (always push to Zoho before updating the Firestore cache):
 *   name, sku, status, categoryId, categoryName, imageUrl
 *
 * Firestore-only overlays (never push to Zoho):
 *   packageInfo, spare-link maps, catalogSiteInventory, yesStore audit links, displayOrder
 */
import {
  updateProductDetails,
  setProductStatus,
  moveProductToCategory,
} from './zoho.js';
import {
  patchProductDetails,
  patchProductStatus,
  patchProductCategory,
  uploadProductImage,
  addProductImage,
  deleteProductImage,
} from './catalog-sync.js';

export const ZOHO_BACKED_CATALOG_PRODUCT_FIELDS = [
  'name',
  'sku',
  'status',
  'categoryId',
  'categoryName',
  'imageUrl',
];

export const FIRESTORE_ONLY_CATALOG_PRODUCT_FIELDS = [
  'packageInfo',
];

/** Update item name + SKU on Zoho, then mirror to Firestore. */
export async function mutateCatalogProductDetails(accessToken, organizationId, productId, input) {
  const name = String(input?.name ?? '').trim();
  const sku = String(input?.sku ?? '').trim();
  await updateProductDetails(accessToken, organizationId, productId, { name, sku });
  await patchProductDetails(productId, { name, sku });
  return { name, sku };
}

/** Set item active/inactive on Zoho, then mirror to Firestore. */
export async function mutateCatalogProductStatus(accessToken, organizationId, productId, status) {
  const normalized = String(status ?? '').trim().toLowerCase();
  await setProductStatus(accessToken, organizationId, productId, normalized);
  await patchProductStatus(productId, normalized);
  return { status: normalized };
}

/** Assign Zoho category, then mirror to Firestore. */
export async function mutateCatalogProductCategory(
  accessToken,
  organizationId,
  productId,
  categoryId,
  categoryName,
) {
  await moveProductToCategory(accessToken, organizationId, productId, categoryId);
  await patchProductCategory(productId, categoryId, categoryName);
  return { ok: true };
}

/** Upload/replace primary image, or append gallery image. */
export async function mutateCatalogProductImageUpload(
  productId,
  buffer,
  contentType,
  accessToken,
  organizationId,
  mode = 'replace',
) {
  if (mode === 'add') {
    return addProductImage(productId, buffer, contentType, accessToken, organizationId);
  }
  return uploadProductImage(productId, buffer, contentType, accessToken, organizationId);
}

/** Delete primary or a specific gallery image. */
export async function mutateCatalogProductImageDelete(
  productId,
  accessToken,
  organizationId,
  options = {},
) {
  return deleteProductImage(productId, accessToken, organizationId, options);
}
