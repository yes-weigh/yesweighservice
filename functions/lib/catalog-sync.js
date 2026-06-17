import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  fetchAllItemGroups,
  fetchAllProducts,
  fetchBulkItemDetails,
  fetchItemsByGroup,
  getAccessToken,
  resolveOrganizationId,
  downloadProductImage,
  uploadProductImageToZoho,
} from './zoho.js';

const PRODUCTS_COLLECTION = 'catalogProducts';
const CATEGORIES_COLLECTION = 'catalogCategories';
const META_DOC = 'catalogMeta/sync';
const BULK_DETAIL_CHUNK = 50;

function publicStorageUrl(bucketName, storagePath) {
  const encoded = encodeURIComponent(storagePath).replace(/%2F/g, '%2F');
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media`;
}

/** Same Storage path is reused on re-upload — bust browser cache with a version query param. */
function versionedPublicStorageUrl(bucketName, storagePath, version) {
  const v = encodeURIComponent(String(version));
  return `${publicStorageUrl(bucketName, storagePath)}&v=${v}`;
}

async function cacheProductImage(accessToken, orgId, productId, existingImageUrl) {
  if (existingImageUrl) return existingImageUrl;

  const result = await downloadProductImage(accessToken, orgId, productId);
  if (!result) return null;
  if (result === 'RATE_LIMITED') return 'RATE_LIMITED';

  const storagePath = `catalog/products/${productId}.${result.ext}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  await file.save(result.buffer, {
    metadata: { contentType: result.contentType, cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();

  return publicStorageUrl(bucket.name, storagePath);
}

/** Mirror yesweigh: map every active item in each Zoho item group (parallel). */
async function buildGroupMembership(accessToken, orgId, itemGroups) {
  const membership = new Map();
  const groups = (itemGroups ?? []).filter(g => g.id);

  const results = await Promise.all(
    groups.map(async group => {
      try {
        const items = await fetchItemsByGroup(accessToken, orgId, group.id);
        return { group, items };
      } catch (err) {
        console.warn(`Group item fetch failed for ${group.id}:`, err?.message ?? err);
        return { group, items: [] };
      }
    }),
  );

  for (const { group, items } of results) {
    for (const item of items) {
      if (item.status !== 'active') continue;
      membership.set(item.id, {
        categoryId: group.id,
        categoryName: group.name,
      });
    }
  }

  return membership;
}

function applyGroupMembership(product, membership) {
  const assigned = membership.get(product.id);
  const categoryId = product.categoryId || assigned?.categoryId || null;
  const categoryName = product.categoryName || assigned?.categoryName || null;
  return { ...product, categoryId, categoryName };
}

/** Fill group_id via Zoho bulk itemdetails for products still missing a category. */
async function enrichMissingGroupIds(accessToken, orgId, products) {
  const missingIds = products
    .filter(p => p.status === 'active' && !p.categoryId)
    .map(p => p.id);

  if (!missingIds.length) return products;

  const byId = new Map(products.map(p => [p.id, { ...p }]));

  for (let i = 0; i < missingIds.length; i += BULK_DETAIL_CHUNK) {
    const chunk = missingIds.slice(i, i + BULK_DETAIL_CHUNK);
    try {
      const details = await fetchBulkItemDetails(accessToken, orgId, chunk);
      for (const item of details) {
        const product = byId.get(item.id);
        if (!product || product.categoryId) continue;
        if (item.categoryId) {
          product.categoryId = item.categoryId;
          product.categoryName = item.categoryName || product.categoryName;
        }
      }
    } catch (err) {
      console.warn('Bulk item detail fetch failed:', err?.message ?? err);
    }
  }

  return [...byId.values()];
}

/** Same aggregation pattern as D:\\yesweigh catalog API — groupBy active products. */
function buildCategoryMap(products, itemGroups, existingCategories) {
  const existingSettings = new Map(
    (existingCategories ?? []).map(cat => [String(cat.id), cat]),
  );

  const counts = new Map();

  for (const group of itemGroups ?? []) {
    if (!group.id) continue;
    const id = String(group.id);
    counts.set(id, {
      id,
      name: group.name || 'Category',
      productCount: 0,
      displayOrder: existingSettings.get(id)?.displayOrder ?? 999,
      thumbnailUrl: existingSettings.get(id)?.thumbnailUrl ?? null,
    });
  }

  for (const product of products) {
    if (product.status !== 'active' || !product.categoryId) continue;
    const key = String(product.categoryId);
    if (!counts.has(key)) {
      counts.set(key, {
        id: key,
        name: product.categoryName || 'Category',
        productCount: 0,
        displayOrder: existingSettings.get(key)?.displayOrder ?? 999,
        thumbnailUrl: existingSettings.get(key)?.thumbnailUrl ?? null,
      });
    }
    const cat = counts.get(key);
    cat.productCount += 1;
    if (product.categoryName) cat.name = product.categoryName;
    const customThumb = existingSettings.get(key)?.thumbnailUrl;
    if (customThumb) {
      cat.thumbnailUrl = customThumb;
    } else if (!cat.thumbnailUrl && product.imageUrl) {
      cat.thumbnailUrl = product.imageUrl;
    }
  }

  return [...counts.values()]
    .filter(cat => cat.productCount > 0)
    .sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.name.localeCompare(b.name);
    });
}

export async function syncCatalogToFirestore(secrets, configuredOrgId, options = {}) {
  const { skipNewImages = false } = options;
  const db = getFirestore();
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, configuredOrgId);

  const [products, itemGroups] = await Promise.all([
    fetchAllProducts(accessToken, organizationId),
    fetchAllItemGroups(accessToken, organizationId).catch(err => {
      console.warn('Item groups fetch failed:', err?.message ?? err);
      return [];
    }),
  ]);

  const groupMembership = await buildGroupMembership(accessToken, organizationId, itemGroups);
  let enrichedProducts = products.map(product => applyGroupMembership(product, groupMembership));
  enrichedProducts = await enrichMissingGroupIds(accessToken, organizationId, enrichedProducts);

  const existingSnap = await db.collection(PRODUCTS_COLLECTION).get();
  const existingMap = new Map(existingSnap.docs.map(doc => [doc.id, doc.data()]));

  const categorySnap = await db.collection(CATEGORIES_COLLECTION).get();
  const existingCategories = categorySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  let skipFurtherImages = false;
  let syncedCount = 0;
  const syncedIds = new Set();
  const now = new Date().toISOString();

  const batchSize = 400;
  let batch = db.batch();
  let batchCount = 0;

  async function commitBatch() {
    if (batchCount === 0) return;
    await batch.commit();
    batch = db.batch();
    batchCount = 0;
  }

  for (const product of enrichedProducts) {
    syncedIds.add(product.id);
    const existing = existingMap.get(product.id);
    let imageUrl = existing?.imageUrl ?? null;

    if (!skipNewImages && product.hasImage && !imageUrl && !skipFurtherImages) {
      const cached = await cacheProductImage(accessToken, organizationId, product.id, imageUrl);
      if (cached === 'RATE_LIMITED') {
        skipFurtherImages = true;
      } else {
        imageUrl = cached;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const doc = {
      id: product.id,
      name: product.name,
      sku: product.sku || null,
      description: product.description || null,
      unit: product.unit,
      rate: product.rate,
      stock: product.stock,
      stockStatus: product.stockStatus,
      imageUrl,
      categoryId: product.categoryId || null,
      categoryName: product.categoryName || null,
      status: product.status,
      hsn: product.hsn || null,
      taxName: product.taxName || null,
      taxPercentage: product.taxPercentage,
      reorderLevel: product.reorderLevel,
      syncedAt: now,
      organizationId,
    };

    batch.set(db.collection(PRODUCTS_COLLECTION).doc(product.id), doc, { merge: true });
    batchCount += 1;
    syncedCount += 1;

    if (batchCount >= batchSize) {
      await commitBatch();
    }
  }

  await commitBatch();

  const staleDeletes = existingSnap.docs.filter(doc => !syncedIds.has(doc.id));
  for (let i = 0; i < staleDeletes.length; i += batchSize) {
    const chunk = staleDeletes.slice(i, i + batchSize);
    const deleteBatch = db.batch();
    for (const doc of chunk) deleteBatch.delete(doc.ref);
    await deleteBatch.commit();
  }

  const categories = buildCategoryMap(enrichedProducts, itemGroups, existingCategories);
  const categoryBatch = db.batch();
  const categoryIds = new Set(categories.map(c => c.id));

  for (const category of categories) {
    categoryBatch.set(db.collection(CATEGORIES_COLLECTION).doc(category.id), {
      ...category,
      syncedAt: now,
    }, { merge: true });
  }

  for (const doc of categorySnap.docs) {
    if (!categoryIds.has(doc.id)) {
      categoryBatch.delete(doc.ref);
    }
  }

  await categoryBatch.commit();

  const activeProducts = enrichedProducts.filter(p => p.status === 'active');
  const groupedCount = activeProducts.filter(p => p.categoryId).length;

  await db.doc(META_DOC).set({
    lastSyncAt: now,
    productCount: products.length,
    activeProductCount: activeProducts.length,
    groupedProductCount: groupedCount,
    categoryCount: categories.length,
    organizationId,
    imageDownloadsSkipped: skipNewImages || skipFurtherImages,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    syncedCount,
    categoryCount: categories.length,
    groupedProductCount: groupedCount,
    syncedAt: now,
    organizationId,
  };
}

function deriveCategoriesFromProducts(items, storedCategories) {
  const storedMap = new Map(storedCategories.map(cat => [String(cat.id), cat]));
  const derived = new Map();

  for (const product of items) {
    if (!product.categoryId) continue;
    const key = String(product.categoryId);
    if (!derived.has(key)) {
      derived.set(key, {
        id: key,
        name: product.categoryName || 'Category',
        productCount: 1,
        displayOrder: storedMap.get(key)?.displayOrder ?? 999,
        thumbnailUrl: storedMap.get(key)?.thumbnailUrl ?? null,
      });
    } else {
      const cat = derived.get(key);
      cat.productCount += 1;
      if (product.categoryName) cat.name = product.categoryName;
    }
    const cat = derived.get(key);
    if (cat && !cat.thumbnailUrl && product.imageUrl) {
      cat.thumbnailUrl = product.imageUrl;
    }
  }

  const merged = new Map();
  for (const cat of storedCategories) {
    if (cat.id) merged.set(String(cat.id), { ...cat, id: String(cat.id) });
  }
  for (const [id, cat] of derived) {
    const prev = merged.get(id);
    merged.set(id, {
      ...cat,
      productCount: Math.max(cat.productCount, prev?.productCount ?? 0),
      thumbnailUrl: prev?.thumbnailUrl ?? cat.thumbnailUrl,
      displayOrder: prev?.displayOrder ?? cat.displayOrder,
    });
  }

  return [...merged.values()]
    .filter(cat => cat.id && cat.productCount > 0)
    .sort((a, b) => {
      const orderDiff = (a.displayOrder ?? 999) - (b.displayOrder ?? 999);
      if (orderDiff !== 0) return orderDiff;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });
}

export async function readCatalogFromFirestore() {
  const db = getFirestore();
  const [productsSnap, categoriesSnap, metaSnap] = await Promise.all([
    db.collection(PRODUCTS_COLLECTION).where('status', '==', 'active').get(),
    db.collection(CATEGORIES_COLLECTION).get(),
    db.doc(META_DOC).get(),
  ]);

  const items = productsSnap.docs
    .map(doc => doc.data())
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const storedCategories = categoriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const categories = deriveCategoriesFromProducts(items, storedCategories);

  const meta = metaSnap.exists ? metaSnap.data() : null;

  return {
    items,
    categories,
    total: items.length,
    syncedAt: meta?.lastSyncAt ?? null,
    stats: {
      totalProducts: items.length,
      totalCategories: categories.length,
      inStock: items.filter(i => i.stockStatus === 'in_stock').length,
      lowStock: items.filter(i => i.stockStatus === 'low_stock').length,
      outOfStock: items.filter(i => i.stockStatus === 'out_of_stock').length,
    },
  };
}

export async function patchProductCategory(productId, categoryId, categoryName) {
  const db = getFirestore();
  await db.collection(PRODUCTS_COLLECTION).doc(productId).set({
    categoryId,
    categoryName,
    syncedAt: new Date().toISOString(),
  }, { merge: true });
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function saveCategoryOrder(categories) {
  const db = getFirestore();
  const batch = db.batch();
  const now = new Date().toISOString();

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    if (!cat?.id) continue;
    batch.set(
      db.collection(CATEGORIES_COLLECTION).doc(String(cat.id)),
      {
        id: String(cat.id),
        name: cat.name || 'Category',
        displayOrder: i,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  await batch.commit();
  return { ok: true, count: categories.length };
}

export async function uploadCategoryThumbnail(categoryId, categoryName, buffer, contentType) {
  const id = String(categoryId ?? '').trim();
  if (!id) throw new Error('categoryId is required.');

  const type = String(contentType ?? 'image/jpeg').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Image must be 5 MB or smaller.');
  }

  const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const storagePath = `catalog/categories/${id}.${ext}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: { contentType: type, cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();

  const now = new Date().toISOString();
  const thumbnailUrl = versionedPublicStorageUrl(bucket.name, storagePath, now);

  await getFirestore().collection(CATEGORIES_COLLECTION).doc(id).set({
    id,
    name: categoryName || 'Category',
    thumbnailUrl,
    updatedAt: now,
  }, { merge: true });

  return { thumbnailUrl };
}

export async function uploadProductImage(productId, buffer, contentType, accessToken, organizationId) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  const type = String(contentType ?? 'image/jpeg').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Image must be 5 MB or smaller.');
  }

  await uploadProductImageToZoho(accessToken, organizationId, id, buffer, type);

  const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
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

  return { imageUrl };
}
