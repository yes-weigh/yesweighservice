import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  fetchAllProducts,
  fetchBulkItemDetails,
  getAccessToken,
  resolveOrganizationId,
  downloadProductImage,
  uploadProductImageToZoho,
  deleteProductImageFromZoho,
  normaliseCategoryId,
} from './zoho.js';
import { buildZohoSyncAuditAdjustment } from './catalog-product-audit.js';

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

async function findCategoryThumbnailInStorage(bucket, categoryId) {
  const id = String(categoryId ?? '').trim();
  if (!id) return null;

  const [files] = await bucket.getFiles({ prefix: `catalog/categories/${id}.` });
  const file = files.find(f => /^catalog\/categories\/[^/]+\.[a-z0-9]+$/i.test(f.name));
  if (!file) return null;

  try {
    await file.makePublic();
  } catch {
    // Already public.
  }

  const version = file.metadata?.updated ?? new Date().toISOString();
  return versionedPublicStorageUrl(bucket.name, file.name, version);
}

async function copyCategoryThumbnailInStorage(bucket, oldId, newId) {
  const from = String(oldId ?? '').trim();
  const to = String(newId ?? '').trim();
  if (!from || !to || from === to) return null;

  const existing = await findCategoryThumbnailInStorage(bucket, to);
  if (existing) return existing;

  const [files] = await bucket.getFiles({ prefix: `catalog/categories/${from}.` });
  const source = files.find(f => /^catalog\/categories\/[^/]+\.[a-z0-9]+$/i.test(f.name));
  if (!source) return null;

  const ext = source.name.split('.').pop();
  const destPath = `catalog/categories/${to}.${ext}`;
  const dest = bucket.file(destPath);
  await source.copy(dest);
  await dest.makePublic();

  return versionedPublicStorageUrl(bucket.name, destPath, new Date().toISOString());
}

/** Fill missing thumbnails from Storage — including files keyed by pre-migration group IDs. */
async function attachStorageThumbnails(categories, legacyCategories, bucket) {
  const nameToCurrentId = new Map(
    categories.map(cat => [String(cat.name ?? '').toLowerCase(), String(cat.id)]),
  );
  const legacyIdToCurrentId = new Map();

  for (const legacy of legacyCategories ?? []) {
    const legacyId = String(legacy.id ?? '').trim();
    if (!legacyId) continue;
    const byName = nameToCurrentId.get(String(legacy.name ?? '').toLowerCase());
    if (byName && byName !== legacyId) {
      legacyIdToCurrentId.set(legacyId, byName);
    }
  }

  for (const cat of categories) {
    if (cat.thumbnailUrl) continue;

    let url = await findCategoryThumbnailInStorage(bucket, cat.id);
    if (!url) {
      for (const [oldId, newId] of legacyIdToCurrentId) {
        if (newId !== String(cat.id)) continue;
        url = await copyCategoryThumbnailInStorage(bucket, oldId, cat.id);
        if (url) break;
      }
    }
    if (url) cat.thumbnailUrl = url;
  }

  return categories;
}

function categoryDocPayload(category, now) {
  const payload = {
    id: category.id,
    name: category.name,
    productCount: category.productCount,
    displayOrder: category.displayOrder,
    syncedAt: now,
  };
  if (category.thumbnailUrl) payload.thumbnailUrl = category.thumbnailUrl;
  return payload;
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

function normaliseProductCategory(product) {
  const categoryId = normaliseCategoryId(product.categoryId);
  return {
    ...product,
    categoryId: categoryId || null,
    categoryName: categoryId ? String(product.categoryName ?? '').trim() || null : null,
  };
}

/** Fill category_id and warehouse stock via Zoho bulk itemdetails. */
async function enrichProductsFromBulkDetails(accessToken, orgId, products) {
  const activeIds = products.filter(p => p.status === 'active').map(p => p.id);
  if (!activeIds.length) return products;

  const byId = new Map(products.map(p => [p.id, { ...p }]));

  for (let i = 0; i < activeIds.length; i += BULK_DETAIL_CHUNK) {
    const chunk = activeIds.slice(i, i + BULK_DETAIL_CHUNK);
    try {
      const details = await fetchBulkItemDetails(accessToken, orgId, chunk);
      for (const item of details) {
        const product = byId.get(item.id);
        if (!product) continue;
        if (!product.categoryId && item.categoryId) {
          product.categoryId = item.categoryId;
          product.categoryName = item.categoryName || product.categoryName;
        }
        if (item.warehouses?.length) {
          product.warehouses = item.warehouses;
        }
      }
    } catch (err) {
      console.warn('Bulk item detail fetch failed:', err?.message ?? err);
    }
  }

  return [...byId.values()];
}

/** Re-key catalogCategories settings when Zoho category IDs changed (match by name). */
async function remapCategorySettingsAfterSync(db, products, existingCategories) {
  if (!existingCategories.length) return existingCategories;

  const bucket = getStorage().bucket();
  const idByName = new Map();
  for (const product of products) {
    if (product.status !== 'active' || !product.categoryId || !product.categoryName) continue;
    idByName.set(String(product.categoryName).toLowerCase(), String(product.categoryId));
  }

  const remapped = new Map();
  const staleIds = new Set();

  for (const cat of existingCategories) {
    const oldId = String(cat.id);
    const correctId = idByName.get(String(cat.name ?? '').toLowerCase());
    const targetId = correctId && correctId !== oldId ? correctId : oldId;

    if (correctId && correctId !== oldId) {
      staleIds.add(oldId);
    }

    const prev = remapped.get(targetId);
    let thumbnailUrl = cat.thumbnailUrl ?? prev?.thumbnailUrl ?? null;

    if (correctId && correctId !== oldId) {
      const copied = await copyCategoryThumbnailInStorage(bucket, oldId, targetId);
      if (copied) {
        thumbnailUrl = copied;
      } else if (thumbnailUrl && String(thumbnailUrl).includes(oldId)) {
        const fromStorage = await findCategoryThumbnailInStorage(bucket, oldId);
        if (fromStorage) thumbnailUrl = fromStorage;
      }
    }

    remapped.set(targetId, {
      id: targetId,
      name: cat.name || prev?.name || 'Category',
      displayOrder: cat.displayOrder ?? prev?.displayOrder ?? 999,
      thumbnailUrl,
    });
  }

  if (staleIds.size) {
    const batch = db.batch();
    for (const [id, cat] of remapped) {
      batch.set(db.collection(CATEGORIES_COLLECTION).doc(id), {
        id,
        name: cat.name,
        displayOrder: cat.displayOrder,
        thumbnailUrl: cat.thumbnailUrl,
      }, { merge: true });
    }
    for (const staleId of staleIds) {
      batch.delete(db.collection(CATEGORIES_COLLECTION).doc(staleId));
    }
    await batch.commit();
  }

  return [...remapped.values()];
}

/** Aggregate active categorized products — mirrors yesweigh listProductCategories(). */
function buildCategoryMap(products, existingCategories, existingProductMap) {
  const settingsById = new Map(
    (existingCategories ?? []).map(cat => [String(cat.id), cat]),
  );
  const settingsByName = new Map(
    (existingCategories ?? []).map(cat => [String(cat.name ?? '').toLowerCase(), cat]),
  );

  const counts = new Map();

  for (const product of products) {
    if (product.status !== 'active' || !product.categoryId) continue;
    const key = String(product.categoryId);
    const settings = settingsById.get(key)
      ?? settingsByName.get(String(product.categoryName ?? '').toLowerCase());
    const cachedProduct = existingProductMap?.get(product.id);
    const imageUrl = cachedProduct?.imageUrl ?? product.imageUrl ?? null;

    if (!counts.has(key)) {
      counts.set(key, {
        id: key,
        name: product.categoryName || settings?.name || 'Category',
        productCount: 0,
        displayOrder: settings?.displayOrder ?? 999,
        thumbnailUrl: settings?.thumbnailUrl ?? null,
      });
    }

    const cat = counts.get(key);
    cat.productCount += 1;
    if (product.categoryName) cat.name = product.categoryName;
    const customThumb = settings?.thumbnailUrl;
    if (customThumb) {
      cat.thumbnailUrl = customThumb;
    } else if (!cat.thumbnailUrl && imageUrl) {
      cat.thumbnailUrl = imageUrl;
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

  const products = await fetchAllProducts(accessToken, organizationId);
  let enrichedProducts = products.map(normaliseProductCategory);
  enrichedProducts = await enrichProductsFromBulkDetails(accessToken, organizationId, enrichedProducts);

  const existingSnap = await db.collection(PRODUCTS_COLLECTION).get();
  const existingMap = new Map(existingSnap.docs.map(doc => [doc.id, doc.data()]));

  const categorySnap = await db.collection(CATEGORIES_COLLECTION).get();
  const legacyCategories = categorySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  let existingCategories = [...legacyCategories];
  existingCategories = await remapCategorySettingsAfterSync(db, enrichedProducts, existingCategories);

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
      warehouses: Array.isArray(product.warehouses) ? product.warehouses : [],
      syncedAt: now,
      organizationId,
    };

    const packageInfo = readPackageInfo(existing?.packageInfo);
    if (packageInfo) {
      doc.packageInfo = packageInfo;
    }

    const previousStock = Number(existing?.stock);
    const zohoSyncEntry = buildZohoSyncAuditAdjustment(
      existing?.auditSnapshot,
      previousStock,
      product.stock,
      now,
    );
    if (zohoSyncEntry) {
      const productRef = db.collection(PRODUCTS_COLLECTION).doc(product.id);
      const logRef = productRef.collection('auditLogs').doc();
      const log = {
        id: logRef.id,
        catalogProductId: product.id,
        ...zohoSyncEntry,
      };
      const snapshot = {
        lastAuditLogId: logRef.id,
        lastAuditedAt: zohoSyncEntry.auditedAt,
        lastAuditedByUid: null,
        lastAuditedByName: zohoSyncEntry.auditedByName,
        baselineDifference: zohoSyncEntry.baselineDifference,
        physicalQtyAtAudit: zohoSyncEntry.physicalQty,
        zohoQtyAtAudit: zohoSyncEntry.zohoQtyAtAudit,
        mode: zohoSyncEntry.mode,
        headOfficeQtyAtAudit: zohoSyncEntry.headOfficeQty,
        cochinQtyAtAudit: zohoSyncEntry.cochinQty,
      };
      if (batchCount >= batchSize) {
        await commitBatch();
      }
      batch.set(logRef, log);
      batchCount += 1;
      doc.auditSnapshot = snapshot;
    } else if (existing?.auditSnapshot) {
      doc.auditSnapshot = existing.auditSnapshot;
    }

    if (Number.isFinite(existing?.displayOrder)) {
      doc.displayOrder = existing.displayOrder;
    }

    if (batchCount >= batchSize) {
      await commitBatch();
    }
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

  let categories = buildCategoryMap(enrichedProducts, existingCategories, existingMap);
  categories = await attachStorageThumbnails(
    categories,
    legacyCategories,
    getStorage().bucket(),
  );
  const categoryBatch = db.batch();
  const categoryIds = new Set(categories.map(c => c.id));

  for (const category of categories) {
    categoryBatch.set(
      db.collection(CATEGORIES_COLLECTION).doc(category.id),
      categoryDocPayload(category, now),
      { merge: true },
    );
  }

  for (const doc of categorySnap.docs) {
    if (!categoryIds.has(doc.id)) {
      categoryBatch.delete(doc.ref);
    }
  }

  await categoryBatch.commit();

  const activeProducts = enrichedProducts.filter(p => p.status === 'active');
  const categorizedCount = activeProducts.filter(p => p.categoryId).length;

  await db.doc(META_DOC).set({
    lastSyncAt: now,
    productCount: products.length,
    activeProductCount: activeProducts.length,
    categorizedProductCount: categorizedCount,
    categoryCount: categories.length,
    organizationId,
    imageDownloadsSkipped: skipNewImages || skipFurtherImages,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    syncedCount,
    categoryCount: categories.length,
    categorizedProductCount: categorizedCount,
    syncedAt: now,
    organizationId,
  };
}

function hasValidCategoryId(product) {
  const id = String(product?.categoryId ?? '').trim();
  return Boolean(id && id !== '-1');
}

function deriveCategoriesFromProducts(items, storedCategories) {
  const storedMap = new Map(storedCategories.map(cat => [String(cat.id), cat]));
  const derived = new Map();

  for (const product of items) {
    if (!hasValidCategoryId(product)) continue;
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

  return [...derived.values()]
    .map(cat => {
      const prev = storedMap.get(cat.id);
      return {
        ...cat,
        thumbnailUrl: prev?.thumbnailUrl || cat.thumbnailUrl,
        displayOrder: prev?.displayOrder ?? cat.displayOrder,
      };
    })
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

/** @internal Firestore cache only — call via catalog-product-mutations after Zoho succeeds. */
export async function patchProductCategory(productId, categoryId, categoryName) {
  const db = getFirestore();
  await db.collection(PRODUCTS_COLLECTION).doc(productId).set({
    categoryId,
    categoryName,
    syncedAt: new Date().toISOString(),
  }, { merge: true });
}

/** @internal Firestore cache only — call via catalog-product-mutations after Zoho succeeds. */
export async function patchProductStatus(productId, status) {
  const id = String(productId ?? '').trim();
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!id) throw new Error('productId is required.');
  if (normalized !== 'active' && normalized !== 'inactive') {
    throw new Error('status must be active or inactive');
  }

  const db = getFirestore();
  await db.collection(PRODUCTS_COLLECTION).doc(id).set({
    status: normalized,
    syncedAt: new Date().toISOString(),
  }, { merge: true });
}

/** @internal Firestore cache only — call via catalog-product-mutations after Zoho succeeds. */
export async function patchProductDetails(productId, input) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  const name = String(input?.name ?? '').trim();
  const sku = String(input?.sku ?? '').trim();
  if (!name) throw new Error('Item name is required.');
  if (!sku) throw new Error('Item SKU is required.');

  const db = getFirestore();
  await db.collection(PRODUCTS_COLLECTION).doc(id).set({
    name,
    sku,
    syncedAt: new Date().toISOString(),
  }, { merge: true });
}

function parseOptionalPositiveNumber(value, { allowZero = false, integer = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (integer) {
    if (!Number.isInteger(num)) return null;
    if (num < 0 || (!allowZero && num <= 0)) return null;
    return num;
  }
  if (num < 0 || (!allowZero && num <= 0)) return null;
  return Math.round(num * 100) / 100;
}

function normalizePackageCarton(input) {
  if (!input || typeof input !== 'object') return null;
  const quantity = parseOptionalPositiveNumber(input.quantity, { integer: true });
  const weightKg = parseOptionalPositiveNumber(input.weightKg);
  const lengthCm = parseOptionalPositiveNumber(input.lengthCm);
  const breadthCm = parseOptionalPositiveNumber(input.breadthCm);
  const heightCm = parseOptionalPositiveNumber(input.heightCm);
  const hasValue = [quantity, weightKg, lengthCm, breadthCm, heightCm].some(v => v != null);
  if (!hasValue) return null;
  return { quantity, weightKg, lengthCm, breadthCm, heightCm };
}

function readPackageCarton(data) {
  if (!data || typeof data !== 'object') return null;
  const quantity = data.quantity != null ? Number(data.quantity) : null;
  const weightKg = data.weightKg != null ? Number(data.weightKg) : null;
  const lengthCm = data.lengthCm != null ? Number(data.lengthCm) : null;
  const breadthCm = data.breadthCm != null ? Number(data.breadthCm) : null;
  const heightCm = data.heightCm != null ? Number(data.heightCm) : null;
  const hasValue = [quantity, weightKg, lengthCm, breadthCm, heightCm].some(
    v => v != null && Number.isFinite(v),
  );
  if (!hasValue) return null;
  return {
    quantity: Number.isFinite(quantity) ? quantity : null,
    weightKg: Number.isFinite(weightKg) ? weightKg : null,
    lengthCm: Number.isFinite(lengthCm) ? lengthCm : null,
    breadthCm: Number.isFinite(breadthCm) ? breadthCm : null,
    heightCm: Number.isFinite(heightCm) ? heightCm : null,
  };
}

export function readPackageInfo(data) {
  if (!data || typeof data !== 'object') return null;
  const masterCarton = readPackageCarton(data.masterCarton);
  const singleBox = readPackageCarton(data.singleBox);
  if (!masterCarton && !singleBox) return null;
  return {
    masterCarton,
    singleBox,
    updatedAt: data.updatedAt ?? null,
    updatedByUid: data.updatedByUid ?? null,
    updatedByName: data.updatedByName ?? null,
  };
}

/** Firestore-only — package dimensions are never pushed to Zoho. */
export async function patchProductPackageInfo(productId, input, editor = {}) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  const masterCarton = normalizePackageCarton(input?.masterCarton);
  const singleBox = normalizePackageCarton(input?.singleBox);
  const now = new Date().toISOString();

  const db = getFirestore();
  await db.collection(PRODUCTS_COLLECTION).doc(id).set({
    packageInfo: {
      masterCarton,
      singleBox,
      updatedAt: now,
      updatedByUid: editor.uid ?? null,
      updatedByName: editor.displayName ?? null,
    },
  }, { merge: true });

  return {
    masterCarton,
    singleBox,
    updatedAt: now,
    updatedByUid: editor.uid ?? null,
    updatedByName: editor.displayName ?? null,
  };
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

export async function saveCategoryProductOrder(categoryId, products) {
  const catId = String(categoryId ?? '').trim();
  if (!catId) throw new Error('categoryId is required.');
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('products array is required.');
  }

  const db = getFirestore();
  const batch = db.batch();
  const now = new Date().toISOString();
  let count = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const id = String(product?.id ?? '').trim();
    if (!id) continue;
    batch.set(
      db.collection(PRODUCTS_COLLECTION).doc(id),
      {
        displayOrder: Number.isFinite(product.displayOrder) ? product.displayOrder : i,
        displayOrderUpdatedAt: now,
      },
      { merge: true },
    );
    count += 1;
  }

  if (!count) throw new Error('No valid products provided.');

  await batch.commit();
  return { ok: true, categoryId: catId, count };
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

/** Zoho first, then Storage + Firestore cache. */
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

/** Zoho first, then Storage cleanup + Firestore cache. */
export async function deleteProductImage(productId, accessToken, organizationId) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  await deleteProductImageFromZoho(accessToken, organizationId, id);

  const bucket = getStorage().bucket();
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    try {
      await bucket.file(`catalog/products/${id}.${ext}`).delete({ ignoreNotFound: true });
    } catch {
      // Best-effort cache cleanup only.
    }
  }

  const now = new Date().toISOString();
  await getFirestore().collection(PRODUCTS_COLLECTION).doc(id).set({
    imageUrl: null,
    syncedAt: now,
  }, { merge: true });

  return { ok: true };
}
