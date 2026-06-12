import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  fetchAllProducts,
  getAccessToken,
  resolveOrganizationId,
  downloadProductImage,
} from './zoho.js';

const PRODUCTS_COLLECTION = 'catalogProducts';
const CATEGORIES_COLLECTION = 'catalogCategories';
const META_DOC = 'catalogMeta/sync';

function publicStorageUrl(bucketName, storagePath) {
  const encoded = encodeURIComponent(storagePath).replace(/%2F/g, '%2F');
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media`;
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

function buildCategoryMap(products, existingCategories) {
  const existingSettings = new Map(
    (existingCategories ?? []).map(cat => [cat.id, cat]),
  );

  const counts = new Map();
  for (const product of products) {
    if (product.status !== 'active') continue;
    if (!product.categoryId) continue;
    const key = product.categoryId;
    if (!counts.has(key)) {
      counts.set(key, {
        id: key,
        name: product.categoryName || 'Category',
        productCount: 0,
        displayOrder: existingSettings.get(key)?.displayOrder ?? 999,
        thumbnailUrl: existingSettings.get(key)?.thumbnailUrl ?? null,
      });
    }
    counts.get(key).productCount += 1;
    if (product.categoryName) counts.get(key).name = product.categoryName;
  }

  return [...counts.values()].sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    return a.name.localeCompare(b.name);
  });
}

export async function syncCatalogToFirestore(secrets, configuredOrgId) {
  const db = getFirestore();
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, configuredOrgId);
  const products = await fetchAllProducts(accessToken, organizationId);

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

  for (const product of products) {
    syncedIds.add(product.id);
    const existing = existingMap.get(product.id);
    let imageUrl = existing?.imageUrl ?? null;

    if (product.hasImage && !imageUrl && !skipFurtherImages) {
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

  const categories = buildCategoryMap(products, existingCategories);
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

  const activeProducts = products.filter(p => p.status === 'active');
  await db.doc(META_DOC).set({
    lastSyncAt: now,
    productCount: products.length,
    activeProductCount: activeProducts.length,
    categoryCount: categories.length,
    organizationId,
    imageDownloadsSkipped: skipFurtherImages,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    syncedCount,
    categoryCount: categories.length,
    syncedAt: now,
    organizationId,
  };
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

  const categories = categoriesSnap.docs
    .map(doc => doc.data())
    .sort((a, b) => {
      const orderDiff = (a.displayOrder ?? 999) - (b.displayOrder ?? 999);
      if (orderDiff !== 0) return orderDiff;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });

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
