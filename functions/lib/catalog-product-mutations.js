/**
 * Catalog product write contract
 * ----------------------------
 * Zoho-backed fields (always push to Zoho before updating the Firestore cache):
 *   name, sku, status, categoryId, categoryName, imageUrl, rate,
 *   mrpOverride → Zoho `label_rate` (MRP) when set
 *
 * Firestore-only overlays (never push to Zoho):
 *   packageInfo, modelNumber, approvalNumber (shop/categorized products only),
 *   spare-link maps, catalogSiteInventory, yesStore audit links, displayOrder
 */
import {
  updateProductDetails,
  setProductStatus,
  moveProductToCategory,
} from './zoho.js';
import {
  patchProductDetails,
  patchProductOverlays,
  patchProductStatus,
  patchProductCategory,
  uploadProductImage,
  addProductImage,
  replaceGalleryImage,
  promoteGalleryImageToPrimary,
  deleteProductImage,
} from './catalog-sync.js';

export const ZOHO_BACKED_CATALOG_PRODUCT_FIELDS = [
  'name',
  'sku',
  'status',
  'categoryId',
  'categoryName',
  'imageUrl',
  'rate',
  'mrpOverride', // mirrored to Zoho label_rate when set
];

export const FIRESTORE_ONLY_CATALOG_PRODUCT_FIELDS = [
  'packageInfo',
  'modelNumber',
  'approvalNumber',
  'spareGroupId',
  'skuChangedAt',
  'binLabelPrintedSku',
  'binLabelPrintedAt',
];

/** Update item details on Zoho, then mirror to Firestore (incl. Firestore-only overlays). */
export async function mutateCatalogProductDetails(accessToken, organizationId, productId, input) {
  const name = String(input?.name ?? '').trim();
  const sku = String(input?.sku ?? '').trim();
  const hasRate = input?.rate != null && input.rate !== '';
  const rate = hasRate ? Number(input.rate) : undefined;
  const mrpOverrideRaw = input?.mrpOverride;
  const hasMrpOverride = 'mrpOverride' in (input ?? {});
  let mrpOverride = null;
  if (hasMrpOverride) {
    if (mrpOverrideRaw === null || mrpOverrideRaw === '' || mrpOverrideRaw === undefined) {
      mrpOverride = null;
    } else {
      mrpOverride = Number(mrpOverrideRaw);
      if (!Number.isFinite(mrpOverride) || mrpOverride < 0) {
        throw new Error('MRP override must be a valid number.');
      }
      if (mrpOverride === 0) mrpOverride = null;
      else mrpOverride = Math.round(mrpOverride * 100) / 100;
    }
  }

  const modelNumber = 'modelNumber' in (input ?? {})
    ? String(input.modelNumber ?? '').trim() || null
    : undefined;
  const approvalNumber = 'approvalNumber' in (input ?? {})
    ? String(input.approvalNumber ?? '').trim() || null
    : undefined;

  await updateProductDetails(accessToken, organizationId, productId, {
    name,
    sku,
    ...(hasRate ? { rate } : {}),
    ...(mrpOverride != null ? { labelRate: mrpOverride } : {}),
  });

  const patch = { name, sku };
  if (hasRate) patch.rate = rate;
  if (hasMrpOverride) patch.mrpOverride = mrpOverride;
  if (modelNumber !== undefined) patch.modelNumber = modelNumber;
  if (approvalNumber !== undefined) patch.approvalNumber = approvalNumber;

  await patchProductDetails(productId, patch);
  return {
    name,
    sku,
    ...(hasRate ? { rate } : {}),
    ...(hasMrpOverride ? { mrpOverride } : {}),
    ...(modelNumber !== undefined ? { modelNumber } : {}),
    ...(approvalNumber !== undefined ? { approvalNumber } : {}),
  };
}

/** Firestore-only model / approval / spare group updates — never calls Zoho. */
export async function mutateCatalogProductOverlays(productId, input) {
  const patch = {};
  if ('modelNumber' in (input ?? {})) {
    patch.modelNumber = String(input.modelNumber ?? '').trim() || null;
  }
  if ('approvalNumber' in (input ?? {})) {
    patch.approvalNumber = String(input.approvalNumber ?? '').trim() || null;
  }
  if ('spareGroupId' in (input ?? {})) {
    patch.spareGroupId = String(input.spareGroupId ?? '').trim() || null;
  }
  if (!('modelNumber' in patch) && !('approvalNumber' in patch) && !('spareGroupId' in patch)) {
    throw new Error('No Firestore-only fields to update.');
  }
  return patchProductOverlays(productId, patch);
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

/** Upload/replace primary, replace gallery slot, append, or promote gallery → main. */
export async function mutateCatalogProductImageUpload(
  productId,
  buffer,
  contentType,
  accessToken,
  organizationId,
  mode = 'replace',
  options = {},
) {
  const documentId = String(options.documentId ?? '').trim();

  if (mode === 'add') {
    return addProductImage(productId, buffer, contentType, accessToken, organizationId);
  }
  if (mode === 'promote') {
    if (!documentId) throw new Error('documentId is required to set a gallery photo as main.');
    return promoteGalleryImageToPrimary(
      productId,
      documentId,
      accessToken,
      organizationId,
    );
  }
  if (documentId) {
    return replaceGalleryImage(
      productId,
      documentId,
      buffer,
      contentType,
      accessToken,
      organizationId,
    );
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
