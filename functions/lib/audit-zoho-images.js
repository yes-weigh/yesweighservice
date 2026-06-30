import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAccessToken, resolveOrganizationId, ZOHO_API_BASE } from './zoho.js';
import { uploadProductImage } from './catalog-sync.js';

const PRODUCTS_COLLECTION = 'catalogProducts';
const YES_STORE_ITEMS = 'yesStoreItems';
const MAX_PHOTOS_PER_ITEM = 2;
const MAX_UPLOAD_BATCH = 12;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function photoKey(photo) {
  return String(photo?.storagePath ?? photo?.id ?? '').trim();
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

function isAuditGalleryFileName(name) {
  return /^audit-\d+-\d+\.(jpe?g|png|webp|gif)$/i.test(String(name ?? '').trim());
}

async function fetchZohoItemRaw(accessToken, orgId, itemId) {
  const url = new URL(`${ZOHO_API_BASE}/items/${itemId}`);
  url.searchParams.set('organization_id', orgId);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const payload = await response.json();
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload.message || 'Could not load Zoho item.');
  }
  return payload?.item ?? null;
}

function listAuditGalleryDocuments(item) {
  const docs = Array.isArray(item?.documents) ? item.documents : [];
  return docs
    .filter(doc => isAuditGalleryFileName(doc?.file_name))
    .sort((a, b) => Number(a?.attachment_order ?? 0) - Number(b?.attachment_order ?? 0));
}

function buildPhotoDocumentMap(item, photoKeys) {
  const auditDocs = listAuditGalleryDocuments(item);
  const map = {};
  photoKeys.forEach((key, index) => {
    const docId = String(auditDocs[index]?.document_id ?? '').trim();
    if (key && docId) map[key] = docId;
  });
  return map;
}

async function deleteZohoGalleryImages(accessToken, orgId, itemId, documentIds) {
  const ids = [...new Set(documentIds.map(id => String(id).trim()).filter(Boolean))];
  if (!ids.length) return 0;

  const url = new URL(`${ZOHO_API_BASE}/items/${itemId}/images`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('document_ids', ids.join(','));

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload.message || 'Could not delete Zoho gallery images.');
  }
  if (!response.ok) {
    throw new Error(payload?.message || `Could not delete Zoho gallery images (${response.status}).`);
  }
  return ids.length;
}

async function deleteZohoPrimaryImage(accessToken, orgId, itemId) {
  const url = new URL(`${ZOHO_API_BASE}/items/${itemId}/image`);
  url.searchParams.set('organization_id', orgId);
  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (response.status === 404) return false;

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (payload?.code !== undefined && payload.code !== 0 && payload.code !== 1002) {
    throw new Error(payload.message || 'Could not delete Zoho primary image.');
  }
  return response.ok;
}

async function clearCatalogAuditCachedImage(productId, productData) {
  const imageUrl = String(productData?.imageUrl ?? '');
  if (!imageUrl.includes(`/catalog/products/${productId}.`)) return false;

  const db = getFirestore();
  await db.collection(PRODUCTS_COLLECTION).doc(productId).set({
    imageUrl: FieldValue.delete(),
  }, { merge: true });
  return true;
}

async function refreshPrimaryFromRemainingAuditPhoto(
  accessToken,
  orgId,
  productId,
  items,
  productRef,
) {
  const photos = collectAuditPhotosForProduct(items);
  const firstPhoto = photos[0];
  if (!firstPhoto) return false;

  const downloaded = await downloadYesStorePhoto(firstPhoto.storagePath);
  if (!downloaded) return false;

  await uploadProductImage(productId, downloaded.buffer, downloaded.contentType, accessToken, orgId);
  return true;
}

function versionedPublicStorageUrl(bucketName, storagePath, version) {
  const encoded = encodeURIComponent(storagePath).replace(/%2F/g, '%2F');
  const v = encodeURIComponent(String(version));
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media&v=${v}`;
}

async function listLinkedAuditItems(catalogProductId) {
  const db = getFirestore();
  const snap = await db.collection(YES_STORE_ITEMS)
    .where('catalogProductId', '==', String(catalogProductId).trim())
    .limit(200)
    .get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/** Up to 2 photos per linked audit item, deduped across the group. */
export function collectAuditPhotosForProduct(items) {
  const photos = [];
  const seen = new Set();

  const sortedItems = [...items].sort((a, b) => {
    const aTime = new Date(a.linkedAt ?? a.updatedAt ?? 0).getTime();
    const bTime = new Date(b.linkedAt ?? b.updatedAt ?? 0).getTime();
    return aTime - bTime;
  });

  for (const item of sortedItems) {
    const itemPhotos = Array.isArray(item.photos) ? item.photos.slice(0, MAX_PHOTOS_PER_ITEM) : [];
    for (const photo of itemPhotos) {
      const key = photoKey(photo);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      photos.push(photo);
    }
  }

  return photos;
}

async function downloadYesStorePhoto(storagePath) {
  const path = String(storagePath ?? '').trim();
  if (!path || !path.startsWith('yesStore/')) return null;

  const bucket = getStorage().bucket();
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) return null;

  const [metadata] = await file.getMetadata();
  const [buffer] = await file.download();
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;

  let contentType = String(metadata?.contentType ?? 'image/jpeg').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    if (path.endsWith('.png')) contentType = 'image/png';
    else if (path.endsWith('.webp')) contentType = 'image/webp';
    else if (path.endsWith('.gif')) contentType = 'image/gif';
    else contentType = 'image/jpeg';
  }

  return { buffer, contentType, storagePath: path };
}

function extFromContentType(contentType) {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

async function cacheCatalogProductImage(productId, buffer, contentType) {
  const id = String(productId ?? '').trim();
  const type = String(contentType ?? 'image/jpeg').toLowerCase();
  const ext = extFromContentType(type);
  const storagePath = `catalog/products/${id}.${ext}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: { contentType: type, cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();

  const now = new Date().toISOString();
  const imageUrl = versionedPublicStorageUrl(bucket.name, storagePath, now);
  await getFirestore().collection(PRODUCTS_COLLECTION).doc(id).set({
    imageUrl,
    syncedAt: now,
  }, { merge: true });

  return imageUrl;
}

/** Upload one or more images to Zoho Inventory (primary + gallery). */
export async function uploadProductImagesToZoho(accessToken, orgId, itemId, images, options = {}) {
  if (!images.length) return { uploadedCount: 0 };

  const updatePrimaryImage = options.updatePrimaryImage === true;

  if (images.length === 1 && updatePrimaryImage) {
    await uploadProductImage(itemId, images[0].buffer, images[0].contentType, accessToken, orgId);
    return { uploadedCount: 1, primaryUpdated: true };
  }

  const url = new URL(`${ZOHO_API_BASE}/items/${itemId}/images`);
  url.searchParams.set('organization_id', orgId);
  if (updatePrimaryImage) {
    url.searchParams.set('update_primary_image', 'true');
  }

  const form = new FormData();
  images.forEach((img, index) => {
    const ext = extFromContentType(img.contentType);
    form.append(
      'image',
      new Blob([img.buffer], { type: img.contentType }),
      `audit-${itemId}-${index + 1}.${ext}`,
    );
  });

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    body: form,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload.message || 'Zoho multi-image upload failed.');
  }
  if (!response.ok) {
    throw new Error(payload?.message || `Zoho multi-image upload failed (${response.status}).`);
  }

  if (updatePrimaryImage && images[0]) {
    await cacheCatalogProductImage(itemId, images[0].buffer, images[0].contentType);
  }

  return { uploadedCount: images.length, primaryUpdated: updatePrimaryImage };
}

/**
 * Push warehouse audit photos (2 per linked bin) to Zoho for a catalog product.
 * Skips photos already recorded on the product doc (zohoAuditPhotoKeys).
 */
export async function syncLinkedAuditPhotosToZoho(catalogProductId, secrets, configuredOrgId) {
  const productId = String(catalogProductId ?? '').trim();
  if (!productId) throw new Error('catalogProductId is required.');

  const db = getFirestore();
  const productRef = db.collection(PRODUCTS_COLLECTION).doc(productId);
  const productSnap = await productRef.get();
  const productData = productSnap.exists ? productSnap.data() : null;

  const items = await listLinkedAuditItems(productId);
  if (!items.length) {
    return { uploadedCount: 0, linkedItemCount: 0, skipped: true, reason: 'no_linked_items' };
  }

  const allPhotos = collectAuditPhotosForProduct(items);
  const syncedKeys = new Set(
    Array.isArray(productData?.zohoAuditPhotoKeys)
      ? productData.zohoAuditPhotoKeys.map(key => String(key))
      : [],
  );

  const pendingPhotos = allPhotos.filter(photo => !syncedKeys.has(photoKey(photo)));
  if (!pendingPhotos.length) {
    return {
      uploadedCount: 0,
      linkedItemCount: items.length,
      photoCount: allPhotos.length,
      skipped: true,
      reason: 'already_synced',
    };
  }

  const downloads = [];
  for (const photo of pendingPhotos.slice(0, MAX_UPLOAD_BATCH)) {
    const downloaded = await downloadYesStorePhoto(photo.storagePath);
    if (downloaded) {
      downloads.push({ ...downloaded, key: photoKey(photo) });
    }
  }

  if (!downloads.length) {
    return {
      uploadedCount: 0,
      linkedItemCount: items.length,
      photoCount: allPhotos.length,
      skipped: true,
      reason: 'no_downloadable_photos',
    };
  }

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, configuredOrgId);
  const needsPrimary = !productData?.imageUrl;

  const result = await uploadProductImagesToZoho(
    accessToken,
    organizationId,
    productId,
    downloads,
    { updatePrimaryImage: needsPrimary },
  );

  const newKeys = downloads.map(img => img.key).filter(Boolean);
  const updatePayload = {
    zohoAuditPhotoKeys: FieldValue.arrayUnion(...newKeys),
    zohoAuditPhotosSyncedAt: new Date().toISOString(),
  };
  if (needsPrimary) {
    updatePayload.zohoAuditPrimaryFromAudit = true;
  }

  await productRef.set(updatePayload, { merge: true });

  const accessTokenForDocs = accessToken;
  const orgIdForDocs = organizationId;
  try {
    const rawItem = await fetchZohoItemRaw(accessTokenForDocs, orgIdForDocs, productId);
    const docMap = buildPhotoDocumentMap(rawItem, newKeys);
    if (Object.keys(docMap).length) {
      const existingDocs = productData?.zohoAuditPhotoDocuments && typeof productData.zohoAuditPhotoDocuments === 'object'
        ? productData.zohoAuditPhotoDocuments
        : {};
      await productRef.set({
        zohoAuditPhotoDocuments: { ...existingDocs, ...docMap },
      }, { merge: true });
    }
  } catch {
    // Non-fatal: reconcile can fall back to filename-based cleanup later.
  }

  return {
    uploadedCount: result.uploadedCount,
    linkedItemCount: items.length,
    photoCount: allPhotos.length,
    primaryUpdated: result.primaryUpdated ?? false,
    syncedKeys: newKeys,
  };
}

/**
 * After unlinking warehouse bins, drop orphaned audit photos from Zoho and keep
 * gallery/primary aligned with remaining linked items.
 */
export async function reconcileLinkedAuditPhotosOnZoho(catalogProductId, secrets, configuredOrgId) {
  const productId = String(catalogProductId ?? '').trim();
  if (!productId) throw new Error('catalogProductId is required.');

  const db = getFirestore();
  const productRef = db.collection(PRODUCTS_COLLECTION).doc(productId);
  const productSnap = await productRef.get();
  const productData = productSnap.exists ? productSnap.data() : null;

  const syncedKeys = new Set(
    Array.isArray(productData?.zohoAuditPhotoKeys)
      ? productData.zohoAuditPhotoKeys.map(key => String(key)).filter(Boolean)
      : [],
  );
  if (!syncedKeys.size) {
    return { skipped: true, reason: 'never_synced' };
  }

  const items = await listLinkedAuditItems(productId);
  const desiredPhotos = collectAuditPhotosForProduct(items);
  const desiredKeys = new Set(desiredPhotos.map(photo => photoKey(photo)).filter(Boolean));

  if (setsEqual(syncedKeys, desiredKeys)) {
    return {
      skipped: true,
      reason: 'in_sync',
      linkedItemCount: items.length,
      photoCount: desiredKeys.size,
    };
  }

  const orphanedKeys = [...syncedKeys].filter(key => !desiredKeys.has(key));
  const docMap = productData?.zohoAuditPhotoDocuments && typeof productData.zohoAuditPhotoDocuments === 'object'
    ? { ...productData.zohoAuditPhotoDocuments }
    : {};

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, configuredOrgId);

  let deletedGalleryCount = 0;
  const mappedDocIds = orphanedKeys
    .map(key => String(docMap[key] ?? '').trim())
    .filter(Boolean);

  if (mappedDocIds.length === orphanedKeys.length && mappedDocIds.length) {
    deletedGalleryCount = await deleteZohoGalleryImages(
      accessToken,
      organizationId,
      productId,
      mappedDocIds,
    );
    for (const key of orphanedKeys) delete docMap[key];
  } else if (orphanedKeys.length) {
    const rawItem = await fetchZohoItemRaw(accessToken, organizationId, productId);
    const auditDocIds = listAuditGalleryDocuments(rawItem)
      .map(doc => String(doc.document_id ?? '').trim())
      .filter(Boolean);
    if (auditDocIds.length) {
      deletedGalleryCount = await deleteZohoGalleryImages(
        accessToken,
        organizationId,
        productId,
        auditDocIds,
      );
    }
    for (const key of Object.keys(docMap)) delete docMap[key];
  }

  const firstSyncedKey = [...syncedKeys][0] ?? '';
  const primaryFromAudit = productData?.zohoAuditPrimaryFromAudit === true;
  const primaryOrphaned = primaryFromAudit && firstSyncedKey && orphanedKeys.includes(firstSyncedKey);

  if (!desiredKeys.size) {
    if (primaryFromAudit) {
      await deleteZohoPrimaryImage(accessToken, organizationId, productId);
      await clearCatalogAuditCachedImage(productId, productData);
    }
    await productRef.set({
      zohoAuditPhotoKeys: FieldValue.delete(),
      zohoAuditPhotoDocuments: FieldValue.delete(),
      zohoAuditPrimaryFromAudit: FieldValue.delete(),
      zohoAuditPhotosSyncedAt: FieldValue.delete(),
    }, { merge: true });

    return {
      removedAll: true,
      deletedGalleryCount,
      primaryRemoved: primaryFromAudit,
      linkedItemCount: 0,
    };
  }

  if (primaryOrphaned) {
    const refreshed = await refreshPrimaryFromRemainingAuditPhoto(
      accessToken,
      organizationId,
      productId,
      items,
      productRef,
    );
    if (!refreshed && primaryFromAudit) {
      await deleteZohoPrimaryImage(accessToken, organizationId, productId);
      await clearCatalogAuditCachedImage(productId, productData);
      await productRef.set({ zohoAuditPrimaryFromAudit: FieldValue.delete() }, { merge: true });
    }
  }

  const remainingKeys = [...desiredKeys];
  const needsFullGalleryRefresh = orphanedKeys.length > 0
    && mappedDocIds.length !== orphanedKeys.length;

  let uploadedCount = 0;
  if (needsFullGalleryRefresh) {
    const downloads = [];
    for (const photo of desiredPhotos.slice(0, MAX_UPLOAD_BATCH)) {
      const downloaded = await downloadYesStorePhoto(photo.storagePath);
      if (downloaded) {
        downloads.push({ ...downloaded, key: photoKey(photo) });
      }
    }

    if (downloads.length) {
      const uploadResult = await uploadProductImagesToZoho(
        accessToken,
        organizationId,
        productId,
        downloads,
        { updatePrimaryImage: false },
      );
      uploadedCount = uploadResult.uploadedCount ?? 0;

      try {
        const rawItem = await fetchZohoItemRaw(accessToken, organizationId, productId);
        const refreshedMap = buildPhotoDocumentMap(rawItem, downloads.map(img => img.key));
        Object.assign(docMap, refreshedMap);
      } catch {
        // Keep partial doc map if Zoho listing fails.
      }
    }
  }

  const nextDocMap = {};
  for (const key of remainingKeys) {
    if (docMap[key]) nextDocMap[key] = docMap[key];
  }

  await productRef.set({
    zohoAuditPhotoKeys: remainingKeys,
    zohoAuditPhotoDocuments: nextDocMap,
    zohoAuditPhotosSyncedAt: new Date().toISOString(),
  }, { merge: true });

  return {
    reconciled: true,
    deletedGalleryCount,
    uploadedCount,
    linkedItemCount: items.length,
    photoCount: remainingKeys.length,
    primaryRefreshed: primaryOrphaned,
  };
}
