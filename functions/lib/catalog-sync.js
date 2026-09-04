import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  fetchAllProducts,
  fetchBulkItemDetails,
  fetchProductDetail,
  getAccessToken,
  resolveOrganizationId,
  downloadProductImage,
  downloadProductDocumentImage,
  downloadProductBackImage,
  uploadProductImageToZoho,
  uploadProductGalleryImagesToZoho,
  deleteProductGalleryImagesFromZoho,
  deleteProductImageFromZoho,
  fetchZohoItemRaw,
  isLocalOnlyImageDocumentId,
  isRecoverableZohoImageDeleteError,
  normaliseCategoryId,
} from './zoho.js';
import { buildZohoSyncAuditAdjustment } from './catalog-product-audit.js';
import { syncLedgerClosingStockForProducts } from './zoho-stock-movements.js';
import { extractWebhookEvent } from './invoice-sync.js';
import { sanitizeRestrictedSalesStates } from './india-states.js';

const PRODUCTS_COLLECTION = 'catalogProducts';
const CATEGORIES_COLLECTION = 'catalogCategories';
const META_DOC = 'catalogMeta/sync';
const BULK_DETAIL_CHUNK = 50;

/** Stable hash of Zoho-synced product fields — skip Firestore writes when unchanged. */
function stableWarehousesFingerprint(warehouses) {
  if (!Array.isArray(warehouses) || warehouses.length === 0) return '';
  return warehouses
    .map((w) => {
      const id = String(w?.warehouseId ?? w?.warehouse_id ?? '');
      const stock = Number(w?.stock ?? 0);
      return `${id}:${Number.isFinite(stock) ? stock : 0}`;
    })
    .sort()
    .join(',');
}

function catalogContentFingerprint(fields) {
  return [
    fields.name ?? '',
    fields.sku ?? '',
    fields.description ?? '',
    fields.unit ?? '',
    fields.rate ?? '',
    fields.stock ?? '',
    fields.stockStatus ?? '',
    fields.imageUrl ?? '',
    fields.categoryId ?? '',
    fields.categoryName ?? '',
    fields.status ?? '',
    fields.hsn ?? '',
    fields.taxName ?? '',
    fields.taxPercentage ?? '',
    fields.reorderLevel ?? '',
    stableWarehousesFingerprint(fields.warehouses),
    fields.organizationId ?? '',
  ].join('|');
}

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

  return versionedPublicStorageUrl(bucket.name, storagePath, new Date().toISOString());
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
      isWeighingScale: Boolean(cat.isWeighingScale ?? prev?.isWeighingScale),
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
        isWeighingScale: Boolean(cat.isWeighingScale),
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
        isWeighingScale: Boolean(settings?.isWeighingScale),
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
  let skippedCount = 0;
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
    let imageDownloaded = false;

    const suppressZohoImageImport = Boolean(existing?.suppressZohoImageImport);

    if (
      !skipNewImages
      && product.hasImage
      && !imageUrl
      && !skipFurtherImages
      && !suppressZohoImageImport
    ) {
      const cached = await cacheProductImage(accessToken, organizationId, product.id, imageUrl);
      if (cached === 'RATE_LIMITED') {
        skipFurtherImages = true;
      } else {
        imageUrl = cached;
        imageDownloaded = Boolean(cached);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const fingerprint = catalogContentFingerprint({
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
      organizationId,
    });

    // Skip write when Zoho payload matches last synced fingerprint (still track id for stale deletes).
    if (
      !imageDownloaded
      && existing
      && existing.contentFingerprint === fingerprint
    ) {
      skippedCount += 1;
      continue;
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
      contentFingerprint: fingerprint,
    };

    if (imageDownloaded || (imageUrl && imageUrl !== (existing?.imageUrl ?? null))) {
      doc.imageUpdatedAt = now;
    } else if (existing?.imageUpdatedAt) {
      doc.imageUpdatedAt = existing.imageUpdatedAt;
    }

    // Keep intentional local deletes from being re-pulled while Zoho still has the image.
    if (suppressZohoImageImport && !imageUrl) {
      doc.suppressZohoImageImport = true;
    }

    const packageInfo = readPackageInfo(existing?.packageInfo);
    if (packageInfo) {
      doc.packageInfo = packageInfo;
    }

    const mrpOverride = Number(existing?.mrpOverride);
    if (Number.isFinite(mrpOverride) && mrpOverride > 0) {
      doc.mrpOverride = Math.round(mrpOverride * 100) / 100;
    }

    const modelNumber = String(existing?.modelNumber ?? '').trim();
    if (modelNumber) doc.modelNumber = modelNumber;

    const approvalNumber = String(existing?.approvalNumber ?? '').trim();
    if (approvalNumber) doc.approvalNumber = approvalNumber;

    if (existing?.pas === true) {
      doc.pas = true;
      const pasModelId = String(existing.pasModelId ?? '').trim();
      if (pasModelId) doc.pasModelId = pasModelId;
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
      const prior = existing?.auditSnapshot && typeof existing.auditSnapshot === 'object'
        ? existing.auditSnapshot
        : {};
      const log = {
        id: logRef.id,
        catalogProductId: product.id,
        auditedAt: zohoSyncEntry.auditedAt,
        auditedByUid: null,
        auditedByName: zohoSyncEntry.auditedByName,
        mode: zohoSyncEntry.mode,
        headOfficeQty: zohoSyncEntry.headOfficeQty,
        cochinQty: zohoSyncEntry.cochinQty,
        physicalQty: zohoSyncEntry.physicalQty,
        rawPhysicalQty: null,
        zohoQtyAtAudit: zohoSyncEntry.zohoQtyAtAudit,
        baselineDifference: zohoSyncEntry.baselineDifference,
        pendingZohoInbound: zohoSyncEntry.pendingZohoInbound ?? 0,
        trigger: 'zoho_sync',
        auditCycleId: null,
      };
      // Sales: keep Diff, move Audited. Inbound catch-up: consume Diff, Audit stays. HO/Cochin frozen.
      const snapshot = {
        ...prior,
        lastAuditLogId: logRef.id,
        baselineDifference: zohoSyncEntry.baselineDifference,
        pendingZohoInbound: zohoSyncEntry.pendingZohoInbound ?? Number(prior.pendingZohoInbound ?? 0),
        physicalQtyAtAudit: zohoSyncEntry.physicalQty,
        zohoQtyAtAudit: zohoSyncEntry.zohoQtyAtAudit,
        mode: zohoSyncEntry.mode,
        headOfficeQtyAtAudit: Number(prior.headOfficeQtyAtAudit ?? zohoSyncEntry.headOfficeQty),
        cochinQtyAtAudit: Number(prior.cochinQtyAtAudit ?? zohoSyncEntry.cochinQty),
        lastPhysicalAuditedAt: prior.lastPhysicalAuditedAt ?? prior.lastAuditedAt ?? null,
        lastPhysicalAuditedByUid: prior.lastPhysicalAuditedByUid ?? prior.lastAuditedByUid ?? null,
        lastPhysicalAuditedByName: prior.lastPhysicalAuditedByName ?? prior.lastAuditedByName ?? null,
        lastAuditCycleId: prior.lastAuditCycleId ?? null,
        lastHeadOfficeAuditCycleId: prior.lastHeadOfficeAuditCycleId ?? null,
        lastCochinAuditCycleId: prior.lastCochinAuditCycleId ?? null,
        // Do not overwrite lastAuditedAt with Zoho sync time.
        lastAuditedAt: prior.lastAuditedAt ?? prior.lastPhysicalAuditedAt ?? zohoSyncEntry.auditedAt,
        lastAuditedByUid: prior.lastAuditedByUid ?? prior.lastPhysicalAuditedByUid ?? null,
        lastAuditedByName: prior.lastAuditedByName ?? prior.lastPhysicalAuditedByName ?? null,
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

    preserveFirestoreOnlyProductFlags(existing, doc);

    if (Number.isFinite(Number(existing?.ledgerClosingStock))) {
      doc.ledgerClosingStock = Number(existing.ledgerClosingStock);
    }
    if (typeof existing?.ledgerClosingStockAt === 'string' && existing.ledgerClosingStockAt.trim()) {
      doc.ledgerClosingStockAt = existing.ledgerClosingStockAt.trim();
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

  const contentChanged = syncedCount > 0 || staleDeletes.length > 0;
  const metaPayload = {
    lastSyncAt: now,
    productCount: products.length,
    activeProductCount: activeProducts.length,
    categorizedProductCount: categorizedCount,
    categoryCount: categories.length,
    organizationId,
    imageDownloadsSkipped: skipNewImages || skipFurtherImages,
    skippedUnchangedCount: skippedCount,
    writtenCount: syncedCount,
    updatedAt: FieldValue.serverTimestamp(),
  };
  // Client cache invalidates on this — only bump when product docs actually changed.
  if (contentChanged) {
    metaPayload.lastContentChangeAt = now;
  }

  await db.doc(META_DOC).set(metaPayload, { merge: true });

  try {
    const ledgerSync = await syncLedgerClosingStockForProducts(
      secrets,
      configuredOrgId,
      enrichedProducts,
    );
    if (ledgerSync.updated > 0) {
      console.info(
        `syncLedgerClosingStock: ${ledgerSync.updated}/${ledgerSync.total} software-key products`,
      );
    }
  } catch (err) {
    console.warn('syncLedgerClosingStockForProducts failed:', err?.message ?? err);
  }

  return {
    syncedCount,
    skippedCount,
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

  const payload = {
    name,
    sku,
    syncedAt: new Date().toISOString(),
  };

  if (input?.rate != null) {
    const rate = Number(input.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      throw new Error('Rate must be a valid number.');
    }
    payload.rate = Math.round(rate * 100) / 100;
  }

  if ('mrpOverride' in (input ?? {})) {
    const raw = input.mrpOverride;
    if (raw === null || raw === '' || raw === undefined) {
      payload.mrpOverride = null;
    } else {
      const mrp = Number(raw);
      if (!Number.isFinite(mrp) || mrp < 0) {
        throw new Error('MRP override must be a valid number.');
      }
      payload.mrpOverride = mrp === 0 ? null : Math.round(mrp * 100) / 100;
    }
  }

  if ('modelNumber' in (input ?? {})) {
    const modelNumber = String(input.modelNumber ?? '').trim();
    payload.modelNumber = modelNumber || null;
  }

  if ('approvalNumber' in (input ?? {})) {
    const approvalNumber = String(input.approvalNumber ?? '').trim();
    payload.approvalNumber = approvalNumber || null;
  }

  const db = getFirestore();
  const ref = db.collection(PRODUCTS_COLLECTION).doc(id);
  const existing = await ref.get();
  const prevSku = existing.exists ? String(existing.data()?.sku ?? '').trim() : '';
  const prevName = existing.exists ? String(existing.data()?.name ?? '').trim() : '';
  const skuChanged = Boolean(prevSku && prevSku !== sku);
  const nameChanged = Boolean(prevName && prevName !== name);
  const now = new Date().toISOString();
  if (skuChanged) {
    payload.skuChangedAt = now;
  }
  if (nameChanged) {
    payload.nameChangedAt = now;
  }

  await ref.set(payload, { merge: true });

  if (skuChanged || nameChanged) {
    await mirrorYesStoreCatalogSkuSnapshot(id, name, sku);
  }
}

const YES_STORE_ITEMS_COLLECTION = 'yesStoreItems';

/** Keep linked audit bins in sync when catalog SKU changes. */
async function mirrorYesStoreCatalogSkuSnapshot(productId, name, sku) {
  const db = getFirestore();
  const snap = await db.collection(YES_STORE_ITEMS_COLLECTION)
    .where('catalogProductId', '==', String(productId).trim())
    .get();
  if (snap.empty) return;

  const now = new Date().toISOString();
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, {
      catalogProductName: name,
      catalogProductSku: sku,
      updatedAt: now,
    });
  }
  await batch.commit();
}

/** Record that a bin label was printed with the current SKU/name (Firestore only). */
export async function recordCatalogBinLabelPrint(productId, sku, name) {
  const id = String(productId ?? '').trim();
  const printedSku = String(sku ?? '').trim();
  const printedName = String(name ?? '').trim();
  if (!id) throw new Error('productId is required.');
  if (!printedSku) throw new Error('sku is required.');

  const db = getFirestore();
  await db.collection(PRODUCTS_COLLECTION).doc(id).set({
    binLabelPrintedSku: printedSku,
    ...(printedName ? { binLabelPrintedName: printedName } : {}),
    binLabelPrintedAt: new Date().toISOString(),
  }, { merge: true });
}

/** Firestore-only overlays (model / approval / spare group) — no Zoho call. */
export async function patchProductOverlays(productId, input) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  const payload = {
    syncedAt: new Date().toISOString(),
  };

  if ('modelNumber' in (input ?? {})) {
    const modelNumber = String(input.modelNumber ?? '').trim();
    payload.modelNumber = modelNumber || null;
  }

  if ('approvalNumber' in (input ?? {})) {
    const approvalNumber = String(input.approvalNumber ?? '').trim();
    payload.approvalNumber = approvalNumber || null;
  }

  if ('spareGroupId' in (input ?? {})) {
    const spareGroupId = String(input.spareGroupId ?? '').trim();
    payload.spareGroupId = spareGroupId || null;
  }

  if ('gatcStampingPriceIds' in (input ?? {})) {
    const raw = input.gatcStampingPriceIds;
    payload.gatcStampingPriceIds = Array.isArray(raw)
      ? [...new Set(raw.map(id => String(id ?? '').trim()).filter(Boolean))]
      : [];
  }

  if ('pas' in (input ?? {})) {
    payload.pas = input.pas === true;
  }
  if ('pasModelId' in (input ?? {})) {
    payload.pasModelId = String(input.pasModelId ?? '').trim() || null;
  }
  if (payload.pas === true) {
    const modelId = String(payload.pasModelId ?? '').trim();
    if (!modelId) {
      throw new Error('PAS requires a Model ID.');
    }
    payload.pasModelId = modelId;
  }
  if (payload.pas === false) {
    payload.pasModelId = null;
  }

  if (
    !('modelNumber' in payload)
    && !('approvalNumber' in payload)
    && !('spareGroupId' in payload)
    && !('gatcStampingPriceIds' in payload)
    && !('pas' in payload)
    && !('pasModelId' in payload)
  ) {
    throw new Error('No Firestore-only fields to update.');
  }

  const existing = await getFirestore().collection(PRODUCTS_COLLECTION).doc(id).get();
  if (!existing.exists) {
    throw new Error('Catalog product not found.');
  }

  const existingData = existing.data() || {};
  const nextPas = 'pas' in payload ? payload.pas === true : existingData.pas === true;
  const nextModelId = 'pasModelId' in payload
    ? String(payload.pasModelId ?? '').trim()
    : String(existingData.pasModelId ?? '').trim();
  if (nextPas && !nextModelId) {
    throw new Error('PAS requires a Model ID.');
  }

  await getFirestore().collection(PRODUCTS_COLLECTION).doc(id).set(payload, { merge: true });
  return {
    ...('modelNumber' in payload ? { modelNumber: payload.modelNumber } : {}),
    ...('approvalNumber' in payload ? { approvalNumber: payload.approvalNumber } : {}),
    ...('spareGroupId' in payload ? { spareGroupId: payload.spareGroupId } : {}),
    ...('gatcStampingPriceIds' in payload
      ? { gatcStampingPriceIds: payload.gatcStampingPriceIds }
      : {}),
    ...('pas' in payload ? { pas: payload.pas === true } : {}),
    ...('pasModelId' in payload ? { pasModelId: payload.pasModelId || null } : {}),
  };
}

function preserveFirestoreOnlyProductFlags(existing, doc) {
  if (!existing) return;
  if (existing.hiddenFromCatalog === true) {
    doc.hiddenFromCatalog = true;
    if (existing.hiddenFromCatalogAt) doc.hiddenFromCatalogAt = existing.hiddenFromCatalogAt;
    if (existing.hiddenFromCatalogByUid) doc.hiddenFromCatalogByUid = existing.hiddenFromCatalogByUid;
  }
  if (existing.newArrival === true) {
    doc.newArrival = true;
    if (existing.newArrivalAt) doc.newArrivalAt = existing.newArrivalAt;
    if (existing.newArrivalByUid) doc.newArrivalByUid = existing.newArrivalByUid;
  }
  if (existing.discontinuedSoon === true) {
    doc.discontinuedSoon = true;
    if (existing.discontinuedSoonAt) doc.discontinuedSoonAt = existing.discontinuedSoonAt;
    if (existing.discontinuedSoonByUid) doc.discontinuedSoonByUid = existing.discontinuedSoonByUid;
  }
  if (Array.isArray(existing.restrictedSalesStates)) {
    doc.restrictedSalesStates = existing.restrictedSalesStates;
    if (existing.restrictedSalesStatesAt) doc.restrictedSalesStatesAt = existing.restrictedSalesStatesAt;
    if (existing.restrictedSalesStatesByUid) {
      doc.restrictedSalesStatesByUid = existing.restrictedSalesStatesByUid;
    }
  }
  if (existing.pas === true) {
    doc.pas = true;
    const pasModelId = String(existing.pasModelId ?? '').trim();
    if (pasModelId) doc.pasModelId = pasModelId;
  }
}

/** Super admin — hide/unhide from dealer/public catalogue (Firestore only). */
export async function patchProductCatalogVisibility(productId, hidden, actorUid) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  const existing = await getFirestore().collection(PRODUCTS_COLLECTION).doc(id).get();
  if (!existing.exists) {
    throw new Error('Catalog product not found.');
  }

  const payload = {
    hiddenFromCatalog: Boolean(hidden),
    hiddenFromCatalogAt: new Date().toISOString(),
    hiddenFromCatalogByUid: actorUid ? String(actorUid) : null,
    syncedAt: new Date().toISOString(),
  };

  await getFirestore().collection(PRODUCTS_COLLECTION).doc(id).set(payload, { merge: true });
  return { hiddenFromCatalog: payload.hiddenFromCatalog };
}

const MERCH_FLAGS = new Set(['newArrival', 'discontinuedSoon']);

/** Super admin — new arrival / discontinued-soon badges (Firestore only). */
export async function patchProductMerchFlag(productId, flag, enabled, actorUid) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');
  if (!MERCH_FLAGS.has(flag)) {
    throw new Error('flag must be newArrival or discontinuedSoon.');
  }

  const existing = await getFirestore().collection(PRODUCTS_COLLECTION).doc(id).get();
  if (!existing.exists) {
    throw new Error('Catalog product not found.');
  }

  const now = new Date().toISOString();
  const payload = {
    [flag]: Boolean(enabled),
    [`${flag}At`]: now,
    [`${flag}ByUid`]: actorUid ? String(actorUid) : null,
    syncedAt: now,
  };

  const db = getFirestore();
  await db.collection(PRODUCTS_COLLECTION).doc(id).set(payload, { merge: true });
  await db.doc(META_DOC).set({
    lastContentChangeAt: now,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { [flag]: payload[flag] };
}

/** Super admin — block sales in selected Indian states (Firestore only). */
export async function patchProductRestrictedSalesStates(productId, states, actorUid) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  const existing = await getFirestore().collection(PRODUCTS_COLLECTION).doc(id).get();
  if (!existing.exists) {
    throw new Error('Catalog product not found.');
  }

  const now = new Date().toISOString();
  const restrictedSalesStates = sanitizeRestrictedSalesStates(states);
  const payload = {
    restrictedSalesStates,
    restrictedSalesStatesAt: now,
    restrictedSalesStatesByUid: actorUid ? String(actorUid) : null,
    syncedAt: now,
  };

  const db = getFirestore();
  await db.collection(PRODUCTS_COLLECTION).doc(id).set(payload, { merge: true });
  await db.doc(META_DOC).set({
    lastContentChangeAt: now,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { restrictedSalesStates };
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
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const quantity = parseOptionalPositiveNumber(input.quantity, { integer: true });
  const weightKg = parseOptionalPositiveNumber(input.weightKg);
  const lengthCm = parseOptionalPositiveNumber(input.lengthCm);
  const breadthCm = parseOptionalPositiveNumber(input.breadthCm);
  const heightCm = parseOptionalPositiveNumber(input.heightCm);
  const hasValue = [quantity, weightKg, lengthCm, breadthCm, heightCm].some(v => v != null);
  if (!hasValue) return null;
  return { quantity, weightKg, lengthCm, breadthCm, heightCm };
}

function normalizeSingleBoxCartons(input) {
  if (input == null) return null;
  if (Array.isArray(input)) {
    const boxes = input.map(normalizePackageCarton).filter(Boolean);
    return boxes.length ? boxes : null;
  }
  const one = normalizePackageCarton(input);
  return one ? [one] : null;
}

function readPackageCarton(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
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

function readSingleBoxCartons(data) {
  if (data == null) return null;
  if (Array.isArray(data)) {
    const boxes = data.map(readPackageCarton).filter(Boolean);
    return boxes.length ? boxes : null;
  }
  const one = readPackageCarton(data);
  return one ? [one] : null;
}

export function readPackageInfo(data) {
  if (!data || typeof data !== 'object') return null;
  const masterCarton = readPackageCarton(data.masterCarton);
  const singleBox = readSingleBoxCartons(data.singleBox);
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
  const singleBox = normalizeSingleBoxCartons(input?.singleBox);
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

/**
 * Batch-set isWeighingScale on catalogCategories.
 * @param {Array<{ id: string, isWeighingScale?: boolean }>} categories
 */
export async function saveCategoryWeighingScaleFlags(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error('categories array is required.');
  }
  const db = getFirestore();
  const batch = db.batch();
  const now = new Date().toISOString();
  let count = 0;

  for (const cat of categories) {
    const id = String(cat?.id ?? '').trim();
    if (!id) continue;
    batch.set(
      db.collection(CATEGORIES_COLLECTION).doc(id),
      {
        isWeighingScale: Boolean(cat.isWeighingScale),
        updatedAt: now,
      },
      { merge: true },
    );
    count += 1;
  }

  if (!count) throw new Error('No valid categories provided.');
  await batch.commit();
  return { ok: true, count };
}

/**
 * One-shot: mark default Zoho weighing-scale groups when none are flagged yet.
 */
export async function seedWeighingScaleCategoriesIfEmpty() {
  const { DEFAULT_WEIGHING_SCALE_CATEGORY_NAMES } = await import(
    './weighing-scale-description.js'
  );
  const db = getFirestore();
  const snap = await db.collection(CATEGORIES_COLLECTION).get();
  if (snap.empty) return { seeded: 0, skipped: true, reason: 'no_categories' };

  const anyFlagged = snap.docs.some(doc => Boolean(doc.data()?.isWeighingScale));
  if (anyFlagged) return { seeded: 0, skipped: true, reason: 'already_flagged' };

  const nameSet = new Set(
    DEFAULT_WEIGHING_SCALE_CATEGORY_NAMES.map(name => name.toLowerCase()),
  );
  const batch = db.batch();
  const now = new Date().toISOString();
  let seeded = 0;

  for (const doc of snap.docs) {
    const name = String(doc.data()?.name ?? '').trim().toLowerCase();
    if (!nameSet.has(name)) continue;
    batch.set(
      doc.ref,
      { isWeighingScale: true, updatedAt: now },
      { merge: true },
    );
    seeded += 1;
  }

  if (seeded) await batch.commit();
  return { seeded, skipped: false };
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
    thumbnailUpdatedAt: now,
  }, { merge: true });

  return { thumbnailUrl };
}

/** Zoho first, then Storage + Firestore cache. */
export async function uploadProductImage(productId, buffer, contentType, accessToken, organizationId) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  const type = normalizeImageContentType(contentType);
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
  const existing = await getFirestore().collection(PRODUCTS_COLLECTION).doc(id).get();
  const existingData = existing.exists ? existing.data() : {};
  const imageDocs = normalizeImageDocs(existingData?.imageDocs);
  const imageUrls = [imageUrl, ...imageDocs.map(doc => doc.url)];

  await getFirestore().collection(PRODUCTS_COLLECTION).doc(id).set({
    imageUrl,
    imageUrls,
    imageDocs,
    suppressZohoImageImport: FieldValue.delete(),
    syncedAt: now,
    imageUpdatedAt: now,
  }, { merge: true });

  return { imageUrl, imageUrls, imageDocs };
}

function normalizeImageDocs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(row => {
      const documentId = String(row?.documentId ?? '').trim();
      const url = String(row?.url ?? '').trim();
      const storagePath = String(row?.storagePath ?? '').trim();
      if (!documentId || !url || !storagePath) return null;
      return { documentId, url, storagePath };
    })
    .filter(Boolean);
}

/** Prefer full docs; keep incomplete rows so replace/delete can still find documentId. */
function readImageDocsLoose(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(row => {
      const documentId = String(row?.documentId ?? '').trim();
      const url = String(row?.url ?? '').trim();
      const storagePath = String(row?.storagePath ?? '').trim();
      if (!documentId && !url) return null;
      return {
        documentId: documentId || `local_${Date.now().toString(36)}`,
        url,
        storagePath,
      };
    })
    .filter(Boolean);
}

function normalizeImageContentType(contentType) {
  const type = String(contentType ?? 'image/jpeg').trim().toLowerCase();
  if (type === 'image/jpg') return 'image/jpeg';
  return type;
}

function imageUrlPathKey(url) {
  return String(url ?? '').split('?')[0] ?? '';
}

function listZohoImageDocumentIds(item) {
  const docs = Array.isArray(item?.documents) ? item.documents : [];
  return docs
    .map(doc => String(doc?.document_id ?? doc?.image_id ?? '').trim())
    .filter(Boolean);
}

const ZOHO_BACK_DOCUMENT_ID = 'zoho_back';

async function saveGalleryBuffer(productId, documentId, buffer, contentType) {
  const type = String(contentType ?? 'image/jpeg').toLowerCase();
  const ext = type.includes('png')
    ? 'png'
    : type.includes('webp')
      ? 'webp'
      : type.includes('gif')
        ? 'gif'
        : 'jpg';
  const storagePath = `catalog/products/${productId}/gallery/${documentId}.${ext}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    metadata: { contentType: type, cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();
  const now = new Date().toISOString();
  const url = versionedPublicStorageUrl(bucket.name, storagePath, now);
  return { documentId, url, storagePath };
}

/**
 * Pull Zoho primary + gallery (+ rear) images into Firestore catalog image fields.
 * Catalog sync historically only cached the primary image.
 */
export async function importProductImagesFromZoho(productId, accessToken, organizationId) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  const productRef = getFirestore().collection(PRODUCTS_COLLECTION).doc(id);
  const existingSnap = await productRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() : {};
  let imageUrl = String(existingData?.imageUrl ?? '').trim() || null;
  let imageDocs = normalizeImageDocs(existingData?.imageDocs);
  const knownIds = new Set(imageDocs.map(doc => doc.documentId));
  let importedCount = 0;
  let primaryUpdated = false;

  const rawItem = await fetchZohoItemRaw(accessToken, organizationId, id);
  const primaryDocumentId = String(
    rawItem?.image_document_id ?? rawItem?.image_id ?? '',
  ).trim();

  if (!imageUrl && (rawItem?.image_url || primaryDocumentId || rawItem?.image_name)) {
    const primary = await downloadProductImage(accessToken, organizationId, id);
    if (primary && primary !== 'RATE_LIMITED') {
      const storagePath = `catalog/products/${id}.${primary.ext}`;
      const bucket = getStorage().bucket();
      const file = bucket.file(storagePath);
      await file.save(primary.buffer, {
        metadata: { contentType: primary.contentType, cacheControl: 'public, max-age=31536000' },
      });
      await file.makePublic();
      imageUrl = versionedPublicStorageUrl(bucket.name, storagePath, new Date().toISOString());
      primaryUpdated = true;
      importedCount += 1;
    }
  }

  const galleryIds = listZohoImageDocumentIds(rawItem)
    .filter(docId => docId && docId !== primaryDocumentId)
    .filter(docId => !knownIds.has(docId));

  for (const documentId of galleryIds) {
    const downloaded = await downloadProductDocumentImage(
      accessToken,
      organizationId,
      id,
      documentId,
    );
    if (!downloaded || downloaded === 'RATE_LIMITED') {
      if (downloaded === 'RATE_LIMITED') break;
      continue;
    }
    const doc = await saveGalleryBuffer(
      id,
      documentId,
      downloaded.buffer,
      downloaded.contentType,
    );
    imageDocs.push(doc);
    knownIds.add(documentId);
    importedCount += 1;
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  if (!knownIds.has(ZOHO_BACK_DOCUMENT_ID)) {
    const back = await downloadProductBackImage(accessToken, organizationId, id);
    if (back && back !== 'RATE_LIMITED') {
      const doc = await saveGalleryBuffer(
        id,
        ZOHO_BACK_DOCUMENT_ID,
        back.buffer,
        back.contentType,
      );
      imageDocs.push(doc);
      knownIds.add(ZOHO_BACK_DOCUMENT_ID);
      importedCount += 1;
    }
  }

  const imageUrls = imageUrl
    ? [imageUrl, ...imageDocs.map(doc => doc.url)]
    : imageDocs.map(doc => doc.url);

  if (importedCount > 0 || !Array.isArray(existingData?.imageUrls) || !existingData.imageUrls.length) {
    await productRef.set({
      ...(imageUrl ? { imageUrl } : {}),
      imageUrls,
      imageDocs,
      syncedAt: new Date().toISOString(),
    }, { merge: true });
  }

  return {
    imageUrl,
    imageUrls,
    imageDocs,
    importedCount,
    primaryUpdated,
  };
}

const DELAY_BETWEEN_ZOHO_IMAGE_UPLOADS_MS = 2_000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function zohoHasPrimaryImage(rawItem) {
  return Boolean(
    String(rawItem?.image_document_id ?? rawItem?.image_id ?? '').trim()
    || String(rawItem?.image_name ?? '').trim()
    || String(rawItem?.image_url ?? '').trim(),
  );
}

function countZohoItemImages(rawItem) {
  const primaryId = String(rawItem?.image_document_id ?? rawItem?.image_id ?? '').trim();
  const docIds = listZohoImageDocumentIds(rawItem);
  const galleryCount = docIds.filter(id => id !== primaryId).length;
  const primaryCount = zohoHasPrimaryImage(rawItem) ? 1 : 0;
  return {
    primaryCount,
    galleryCount,
    total: primaryCount + galleryCount,
    documentIds: new Set(docIds),
    primaryDocumentId: primaryId || null,
  };
}

async function readStorageImageBuffer(storagePath) {
  const path = String(storagePath ?? '').trim();
  if (!path) throw new Error('storagePath is required.');
  const bucket = getStorage().bucket();
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) throw new Error(`Storage file missing: ${path}`);
  const [buffer] = await file.download();
  const [metadata] = await file.getMetadata();
  const contentType = String(metadata?.contentType ?? 'image/jpeg').toLowerCase();
  return { buffer, contentType };
}

/**
 * Compare Firebase catalog images vs Zoho. Optionally upload Firebase-only images
 * to Zoho (one-at-a-time with delay). Does not delete anything.
 *
 * @param {{ dryRun?: boolean }} [options]
 */
export async function pushMissingCatalogProductImagesToZoho(
  productId,
  accessToken,
  organizationId,
  options = {},
) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');
  const dryRun = Boolean(options.dryRun);

  const productRef = getFirestore().collection(PRODUCTS_COLLECTION).doc(id);
  const existingSnap = await productRef.get();
  if (!existingSnap.exists) {
    throw new Error('Catalog product not found in Firebase.');
  }
  const existingData = existingSnap.data() ?? {};
  const firebasePrimaryUrl = String(existingData.imageUrl ?? '').trim() || null;
  let imageDocs = normalizeImageDocs(existingData.imageDocs);
  const firebaseCount = (firebasePrimaryUrl ? 1 : 0) + imageDocs.length;

  const rawItem = await fetchZohoItemRaw(accessToken, organizationId, id);
  const zoho = countZohoItemImages(rawItem);

  const missing = [];

  if (firebasePrimaryUrl && zoho.primaryCount === 0) {
    missing.push({ kind: 'primary', documentId: null, storagePath: null, url: firebasePrimaryUrl });
  }

  for (const doc of imageDocs) {
    const needsPush = isLocalOnlyImageDocumentId(doc.documentId)
      || !zoho.documentIds.has(doc.documentId);
    if (needsPush) {
      missing.push({
        kind: 'gallery',
        documentId: doc.documentId,
        storagePath: doc.storagePath,
        url: doc.url,
      });
    }
  }

  const result = {
    productId: id,
    dryRun,
    firebaseCount,
    zohoCount: zoho.total,
    missingCount: missing.length,
    uploadedCount: 0,
    failedCount: 0,
    skipped: false,
    uploaded: [],
    failed: [],
    message: '',
  };

  if (missing.length === 0) {
    result.skipped = true;
    result.message = firebaseCount <= zoho.total
      ? `Firebase (${firebaseCount}) is not ahead of Zoho (${zoho.total}). Nothing to push.`
      : `No uploadable Firebase images found beyond Zoho (${zoho.total}).`;
    return result;
  }

  if (dryRun) {
    result.message = `Firebase has ${firebaseCount} image(s), Zoho has ${zoho.total}. `
      + `${missing.length} Firebase image(s) can be uploaded to Zoho.`;
    return result;
  }

  let first = true;
  let imageDocsNext = [...imageDocs];
  let remappedDocs = false;

  for (const item of missing) {
    if (!first) {
      await sleep(DELAY_BETWEEN_ZOHO_IMAGE_UPLOADS_MS);
    }
    first = false;

    try {
      let buffer;
      let contentType;

      if (item.kind === 'primary') {
        // Resolve primary storage file by listing known extensions.
        const bucket = getStorage().bucket();
        const candidates = ['jpg', 'jpeg', 'png', 'webp', 'gif'].map(
          ext => `catalog/products/${id}.${ext}`,
        );
        let found = null;
        for (const path of candidates) {
          const file = bucket.file(path);
          const [exists] = await file.exists();
          if (exists) {
            found = path;
            break;
          }
        }
        if (!found) {
          throw new Error('Primary image file not found in Firebase Storage.');
        }
        ({ buffer, contentType } = await readStorageImageBuffer(found));
        await uploadProductImageToZoho(accessToken, organizationId, id, buffer, contentType);
        result.uploaded.push({ kind: 'primary', documentId: null });
      } else {
        ({ buffer, contentType } = await readStorageImageBuffer(item.storagePath));
        const beforeItem = await fetchZohoItemRaw(accessToken, organizationId, id);
        const beforeIds = new Set(listZohoImageDocumentIds(beforeItem));

        await uploadProductGalleryImagesToZoho(
          accessToken,
          organizationId,
          id,
          [{ buffer, contentType }],
          { updatePrimary: false },
        );

        await sleep(400);
        const afterItem = await fetchZohoItemRaw(accessToken, organizationId, id);
        const afterIds = listZohoImageDocumentIds(afterItem);
        let newDocumentId = afterIds.find(docId => !beforeIds.has(docId)) || '';
        if (!newDocumentId && afterIds.length) {
          newDocumentId = afterIds[afterIds.length - 1];
        }

        if (newDocumentId && item.documentId && newDocumentId !== item.documentId) {
          // Remap local_/stale Firebase gallery id → real Zoho document id.
          imageDocsNext = imageDocsNext.map(doc => {
            if (doc.documentId !== item.documentId) return doc;
            const ext = String(doc.storagePath).split('.').pop() || 'jpg';
            const nextPath = `catalog/products/${id}/gallery/${newDocumentId}.${ext}`;
            return {
              documentId: newDocumentId,
              url: doc.url,
              storagePath: doc.storagePath || nextPath,
            };
          });
          remappedDocs = true;
        }

        result.uploaded.push({
          kind: 'gallery',
          documentId: newDocumentId || item.documentId,
          previousDocumentId: item.documentId,
        });
      }

      result.uploadedCount += 1;
    } catch (err) {
      result.failedCount += 1;
      result.failed.push({
        kind: item.kind,
        documentId: item.documentId,
        error: err?.message ?? 'Upload failed.',
      });
      // Stop on rate limit so remaining can be retried later.
      const msg = String(err?.message ?? '');
      if (/rate|blocked|too many requests|exceeded the maximum number of requests/i.test(msg)) {
        result.message = `Stopped after Zoho rate limit. Uploaded ${result.uploadedCount}, `
          + `${missing.length - result.uploadedCount - result.failedCount + 1} remaining — wait and run again.`;
        break;
      }
    }
  }

  if (remappedDocs || result.uploadedCount > 0) {
    const primaryUrl = firebasePrimaryUrl;
    const imageUrls = primaryUrl
      ? [primaryUrl, ...imageDocsNext.map(doc => doc.url)]
      : imageDocsNext.map(doc => doc.url);
    await productRef.set({
      imageDocs: imageDocsNext,
      imageUrls,
      syncedAt: new Date().toISOString(),
    }, { merge: true });
  }

  if (!result.message) {
    result.message = result.failedCount > 0
      ? `Uploaded ${result.uploadedCount} of ${missing.length} image(s) to Zoho `
        + `(${result.failedCount} failed). Run Catalog Sync after Zoho settles.`
      : `Uploaded ${result.uploadedCount} image(s) to Zoho. `
        + `Firebase had ${firebaseCount}, Zoho had ${zoho.total}. Now run Catalog Sync.`;
  }

  return {
    ...result,
    firebaseCount,
    zohoCountAfterAttempt: zoho.total + result.uploadedCount,
  };
}

/** Append a gallery image on Zoho + Storage (does not replace primary). */
export async function addProductImage(productId, buffer, contentType, accessToken, organizationId) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  const type = normalizeImageContentType(contentType);
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Image must be 5 MB or smaller.');
  }

  const productRef = getFirestore().collection(PRODUCTS_COLLECTION).doc(id);
  const existingSnap = await productRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() : {};
  const existingDocs = normalizeImageDocs(existingData?.imageDocs);
  const knownIds = new Set(existingDocs.map(doc => doc.documentId));

  // If there is no primary yet, first upload becomes primary (replace path).
  if (!String(existingData?.imageUrl ?? '').trim()) {
    return uploadProductImage(id, buffer, type, accessToken, organizationId);
  }

  let beforeIds = new Set(knownIds);
  try {
    const beforeItem = await fetchZohoItemRaw(accessToken, organizationId, id);
    beforeIds = new Set([...beforeIds, ...listZohoImageDocumentIds(beforeItem)]);
  } catch {
    // Best-effort; still upload and resolve document id after.
  }

  await uploadProductGalleryImagesToZoho(
    accessToken,
    organizationId,
    id,
    [{ buffer, contentType: type }],
    { updatePrimary: false },
  );

  let documentId = '';
  try {
    const afterItem = await fetchZohoItemRaw(accessToken, organizationId, id);
    const afterIds = listZohoImageDocumentIds(afterItem);
    documentId = afterIds.find(docId => !beforeIds.has(docId)) || '';
    if (!documentId && afterIds.length) {
      documentId = afterIds[afterIds.length - 1];
    }
  } catch {
    documentId = '';
  }
  if (!documentId) {
    documentId = `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const storagePath = `catalog/products/${id}/gallery/${documentId}.${ext}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    metadata: { contentType: type, cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();

  const now = new Date().toISOString();
  const url = versionedPublicStorageUrl(bucket.name, storagePath, now);
  const imageDocs = [...existingDocs, { documentId, url, storagePath }];
  const primaryUrl = String(existingData?.imageUrl ?? '').trim() || null;
  const imageUrls = primaryUrl
    ? [primaryUrl, ...imageDocs.map(doc => doc.url)]
    : imageDocs.map(doc => doc.url);

  await productRef.set({
    imageUrl: primaryUrl,
    imageUrls,
    imageDocs,
    syncedAt: now,
  }, { merge: true });

  return { imageUrl: primaryUrl, imageUrls, imageDocs };
}

/**
 * Replace a non-primary gallery image in place (same carousel slot).
 * Deletes the old Zoho/Storage gallery doc, uploads a new one, keeps list order.
 */
export async function replaceGalleryImage(
  productId,
  documentId,
  buffer,
  contentType,
  accessToken,
  organizationId,
) {
  const id = String(productId ?? '').trim();
  const targetId = String(documentId ?? '').trim();
  if (!id) throw new Error('productId is required.');
  if (!targetId) throw new Error('documentId is required.');

  const type = normalizeImageContentType(contentType);
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Image must be 5 MB or smaller.');
  }

  const productRef = getFirestore().collection(PRODUCTS_COLLECTION).doc(id);
  const existingSnap = await productRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() : {};
  // Loose read keeps incomplete Firestore rows (missing storagePath) that normalize would drop.
  const existingDocs = readImageDocsLoose(existingData?.imageDocs);
  const targetIndex = existingDocs.findIndex(doc => doc.documentId === targetId);
  if (targetIndex < 0) {
    throw new Error(
      'Gallery image not found in catalog cache. Refresh the product and try again.',
    );
  }

  const target = existingDocs[targetIndex];
  const bucket = getStorage().bucket();

  // Stale Firebase document_ids (common after bulk image push) must not block replace.
  if (targetId && !isLocalOnlyImageDocumentId(targetId)) {
    try {
      await deleteProductGalleryImagesFromZoho(accessToken, organizationId, id, [targetId]);
    } catch (err) {
      if (!isRecoverableZohoImageDeleteError(err?.message)) throw err;
    }
  }
  if (target.storagePath) {
    try {
      await bucket.file(target.storagePath).delete({ ignoreNotFound: true });
    } catch {
      // Best-effort
    }
  }

  let beforeIds = new Set(
    existingDocs
      .filter(doc => doc.documentId !== targetId)
      .map(doc => doc.documentId)
      .filter(Boolean),
  );
  try {
    const beforeItem = await fetchZohoItemRaw(accessToken, organizationId, id);
    beforeIds = new Set([...beforeIds, ...listZohoImageDocumentIds(beforeItem)]);
  } catch {
    // Best-effort
  }

  await uploadProductGalleryImagesToZoho(
    accessToken,
    organizationId,
    id,
    [{ buffer, contentType: type }],
    { updatePrimary: false },
  );

  let nextDocumentId = '';
  try {
    const afterItem = await fetchZohoItemRaw(accessToken, organizationId, id);
    const afterIds = listZohoImageDocumentIds(afterItem);
    nextDocumentId = afterIds.find(docId => !beforeIds.has(docId)) || '';
    if (!nextDocumentId && afterIds.length) {
      nextDocumentId = afterIds[afterIds.length - 1];
    }
  } catch {
    nextDocumentId = '';
  }
  if (!nextDocumentId) {
    nextDocumentId = `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const storagePath = `catalog/products/${id}/gallery/${nextDocumentId}.${ext}`;
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    metadata: { contentType: type, cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();

  const now = new Date().toISOString();
  const url = versionedPublicStorageUrl(bucket.name, storagePath, now);
  const imageDocs = existingDocs
    .map((doc, index) => {
      if (index === targetIndex) {
        return { documentId: nextDocumentId, url, storagePath };
      }
      if (doc.documentId && doc.url && doc.storagePath) {
        return {
          documentId: doc.documentId,
          url: doc.url,
          storagePath: doc.storagePath,
        };
      }
      return null;
    })
    .filter(Boolean);
  const primaryUrl = String(existingData?.imageUrl ?? '').trim() || null;
  const imageUrls = primaryUrl
    ? [primaryUrl, ...imageDocs.map(doc => doc.url)]
    : imageDocs.map(doc => doc.url);

  await productRef.set({
    imageUrl: primaryUrl,
    imageUrls,
    imageDocs,
    syncedAt: now,
  }, { merge: true });

  return { imageUrl: primaryUrl, imageUrls, imageDocs };
}

/** Promote a gallery image to primary (main catalog photo). */
export async function promoteGalleryImageToPrimary(
  productId,
  documentId,
  accessToken,
  organizationId,
) {
  const id = String(productId ?? '').trim();
  const targetId = String(documentId ?? '').trim();
  if (!id) throw new Error('productId is required.');
  if (!targetId) throw new Error('documentId is required.');

  const productRef = getFirestore().collection(PRODUCTS_COLLECTION).doc(id);
  const existingSnap = await productRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() : {};
  const imageDocs = normalizeImageDocs(existingData?.imageDocs);
  const targetIndex = imageDocs.findIndex(doc => doc.documentId === targetId);
  if (targetIndex < 0) throw new Error('Gallery image not found.');

  const target = imageDocs[targetIndex];
  const rest = imageDocs.filter((_, index) => index !== targetIndex);
  const bucket = getStorage().bucket();

  let promotedBuffer = null;
  let promotedType = 'image/jpeg';
  try {
    const [buf] = await bucket.file(target.storagePath).download();
    promotedBuffer = buf;
    const [meta] = await bucket.file(target.storagePath).getMetadata();
    promotedType = String(meta?.contentType ?? 'image/jpeg');
  } catch {
    throw new Error('Could not read gallery image to promote.');
  }

  if (!targetId.startsWith('local_')) {
    try {
      await deleteProductGalleryImagesFromZoho(accessToken, organizationId, id, [targetId]);
    } catch {
      // Continue — primary upload still needed.
    }
  }
  try {
    await bucket.file(target.storagePath).delete({ ignoreNotFound: true });
  } catch {
    // Best-effort
  }

  // Temporarily clear the target from Firestore so uploadProductImage keeps only `rest`.
  await productRef.set({
    imageDocs: rest,
    imageUrls: [
      String(existingData?.imageUrl ?? '').trim(),
      ...rest.map(doc => doc.url),
    ].filter(Boolean),
    syncedAt: new Date().toISOString(),
  }, { merge: true });

  const result = await uploadProductImage(
    id,
    promotedBuffer,
    promotedType,
    accessToken,
    organizationId,
  );

  const imageUrls = [result.imageUrl, ...rest.map(doc => doc.url)].filter(Boolean);
  await productRef.set({
    imageUrl: result.imageUrl,
    imageUrls,
    imageDocs: rest,
    syncedAt: new Date().toISOString(),
  }, { merge: true });

  return {
    imageUrl: result.imageUrl,
    imageUrls,
    imageDocs: rest,
  };
}

/** Zoho first, then Storage cleanup + Firestore cache. */
export async function deleteProductImage(productId, accessToken, organizationId, options = {}) {
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  const documentId = String(options.documentId ?? '').trim();
  const productRef = getFirestore().collection(PRODUCTS_COLLECTION).doc(id);
  const existingSnap = await productRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() : {};
  const imageDocs = normalizeImageDocs(existingData?.imageDocs);
  const bucket = getStorage().bucket();
  const now = new Date().toISOString();

  const imageUrlHint = String(options.imageUrl ?? '').trim();

  // Delete a specific gallery image.
  if (documentId || imageUrlHint) {
    const urlKey = imageUrlHint ? imageUrlPathKey(imageUrlHint) : '';
    let target = documentId
      ? imageDocs.find(doc => doc.documentId === documentId)
      : null;
    if (!target && urlKey) {
      target = imageDocs.find(doc => imageUrlPathKey(doc.url) === urlKey);
    }
    const resolvedDocumentId = String(target?.documentId ?? documentId ?? '').trim();

    // Carousel slot with no imageDoc — drop the URL only.
    if (!target && urlKey) {
      const primaryUrl = String(existingData?.imageUrl ?? '').trim() || null;
      const prevUrls = Array.isArray(existingData?.imageUrls)
        ? existingData.imageUrls.map(u => String(u ?? '').trim()).filter(Boolean)
        : [];
      const imageUrls = prevUrls.filter(u => imageUrlPathKey(u) !== urlKey);
      await productRef.set({
        imageUrl: primaryUrl,
        imageUrls,
        imageDocs,
        syncedAt: now,
      }, { merge: true });
      return { ok: true, imageUrl: primaryUrl, imageUrls, imageDocs };
    }

    if (!target) throw new Error('Gallery image not found.');

    if (resolvedDocumentId && !isLocalOnlyImageDocumentId(resolvedDocumentId)) {
      try {
        await deleteProductGalleryImagesFromZoho(
          accessToken,
          organizationId,
          id,
          [resolvedDocumentId],
        );
      } catch (err) {
        if (!isRecoverableZohoImageDeleteError(err?.message)) throw err;
      }
    }

    try {
      await bucket.file(target.storagePath).delete({ ignoreNotFound: true });
    } catch {
      // Best-effort
    }

    const nextDocs = imageDocs.filter(doc => doc.documentId !== target.documentId);
    const primaryUrl = String(existingData?.imageUrl ?? '').trim() || null;
    const imageUrls = primaryUrl
      ? [primaryUrl, ...nextDocs.map(doc => doc.url)]
      : nextDocs.map(doc => doc.url);

    await productRef.set({
      imageUrl: primaryUrl,
      imageUrls,
      imageDocs: nextDocs,
      syncedAt: now,
    }, { merge: true });

    return { ok: true, imageUrl: primaryUrl, imageUrls, imageDocs: nextDocs };
  }

  // Delete primary image.
  let zohoPrimaryDeleteSkipped = false;
  try {
    await deleteProductImageFromZoho(accessToken, organizationId, id);
  } catch (err) {
    if (!isRecoverableZohoImageDeleteError(err?.message)) throw err;
    zohoPrimaryDeleteSkipped = true;
  }

  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    try {
      await bucket.file(`catalog/products/${id}.${ext}`).delete({ ignoreNotFound: true });
    } catch {
      // Best-effort cache cleanup only.
    }
  }

  // Promote first gallery image to primary when available.
  if (imageDocs.length > 0) {
    const [first, ...rest] = imageDocs;
    let promotedBuffer = null;
    let promotedType = 'image/jpeg';
    try {
      const [buf] = await bucket.file(first.storagePath).download();
      promotedBuffer = buf;
      const [meta] = await bucket.file(first.storagePath).getMetadata();
      promotedType = String(meta?.contentType ?? 'image/jpeg');
    } catch {
      promotedBuffer = null;
    }

    if (promotedBuffer) {
      if (!first.documentId.startsWith('local_')) {
        try {
          await deleteProductGalleryImagesFromZoho(
            accessToken,
            organizationId,
            id,
            [first.documentId],
          );
        } catch {
          // Continue — primary upload still needed.
        }
      }
      try {
        await bucket.file(first.storagePath).delete({ ignoreNotFound: true });
      } catch {
        // Best-effort
      }
      return uploadProductImage(
        id,
        promotedBuffer,
        promotedType,
        accessToken,
        organizationId,
      ).then(async result => {
        // Preserve remaining gallery docs after primary replace.
        const imageUrls = [result.imageUrl, ...rest.map(doc => doc.url)];
        await productRef.set({
          imageUrl: result.imageUrl,
          imageUrls,
          imageDocs: rest,
          suppressZohoImageImport: FieldValue.delete(),
          syncedAt: new Date().toISOString(),
          imageUpdatedAt: new Date().toISOString(),
        }, { merge: true });
        return {
          ok: true,
          imageUrl: result.imageUrl,
          imageUrls,
          imageDocs: rest,
        };
      });
    }
  }

  await productRef.set({
    imageUrl: null,
    imageUrls: [],
    imageDocs: [],
    // Zoho may still have the image (rate limit / auth). Block sync re-import.
    ...(zohoPrimaryDeleteSkipped ? { suppressZohoImageImport: true } : { suppressZohoImageImport: FieldValue.delete() }),
    syncedAt: now,
  }, { merge: true });

  return { ok: true, imageUrl: null, imageUrls: [], imageDocs: [] };
}

function normalizeWebhookBody(body) {
  if (!body || typeof body !== 'object') return {};
  let next = { ...body };
  if (typeof body.JSONString === 'string' && body.JSONString.trim()) {
    try {
      const parsed = JSON.parse(body.JSONString);
      if (parsed && typeof parsed === 'object') next = { ...next, ...parsed };
    } catch {
      // ignore
    }
  }
  return next;
}

export function extractItemIdFromWebhook(body, query = {}) {
  const normalized = normalizeWebhookBody(body);
  const candidates = [
    query.item_id,
    query.itemId,
    query.id,
    normalized.item_id,
    normalized.itemId,
    normalized.item?.item_id,
    normalized.item?.itemId,
    normalized.data?.item_id,
    normalized.payload?.item_id,
  ];
  for (const value of candidates) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

export async function deleteCatalogItemFromFirestore(itemId) {
  const id = String(itemId ?? '').trim();
  if (!id) return;
  const db = getFirestore();
  await db.collection(PRODUCTS_COLLECTION).doc(id).delete().catch(() => {});
  const now = new Date().toISOString();
  await db.doc(META_DOC).set({
    lastContentChangeAt: now,
    lastSyncAt: now,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => {});
}

/**
 * Pull one Zoho item into catalogProducts/{id}. Preserves local overlays.
 * Webhooks skip image download by default (1 API call).
 */
export async function mirrorCatalogItemFromZoho(secrets, configuredOrgId, itemId, options = {}) {
  const id = String(itemId ?? '').trim();
  if (!id) throw new Error('itemId is required.');

  const skipImages = options.skipImages !== false;
  const db = getFirestore();
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, configuredOrgId);
  const product = await fetchProductDetail(accessToken, organizationId, id);

  const existingSnap = await db.collection(PRODUCTS_COLLECTION).doc(id).get();
  const existing = existingSnap.exists ? existingSnap.data() : null;
  let imageUrl = existing?.imageUrl ?? null;
  let imageDownloaded = false;
  const suppressZohoImageImport = Boolean(existing?.suppressZohoImageImport);
  const now = new Date().toISOString();

  if (
    !skipImages
    && !imageUrl
    && !suppressZohoImageImport
  ) {
    const cached = await cacheProductImage(accessToken, organizationId, id, imageUrl);
    if (cached && cached !== 'RATE_LIMITED') {
      imageUrl = cached;
      imageDownloaded = true;
    }
  }

  const fingerprint = catalogContentFingerprint({
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
    organizationId,
  });

  if (!imageDownloaded && existing && existing.contentFingerprint === fingerprint) {
    return { id, created: false, skipped: true };
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
    contentFingerprint: fingerprint,
  };

  if (imageDownloaded || (imageUrl && imageUrl !== (existing?.imageUrl ?? null))) {
    doc.imageUpdatedAt = now;
  } else if (existing?.imageUpdatedAt) {
    doc.imageUpdatedAt = existing.imageUpdatedAt;
  }

  if (suppressZohoImageImport && !imageUrl) {
    doc.suppressZohoImageImport = true;
  }

  const packageInfo = readPackageInfo(existing?.packageInfo);
  if (packageInfo) doc.packageInfo = packageInfo;

  const mrpOverride = Number(existing?.mrpOverride);
  if (Number.isFinite(mrpOverride) && mrpOverride > 0) {
    doc.mrpOverride = Math.round(mrpOverride * 100) / 100;
  }

  const modelNumber = String(existing?.modelNumber ?? '').trim();
  if (modelNumber) doc.modelNumber = modelNumber;

  const approvalNumber = String(existing?.approvalNumber ?? '').trim();
  if (approvalNumber) doc.approvalNumber = approvalNumber;

  if (existing?.pas === true) {
    doc.pas = true;
    const pasModelId = String(existing.pasModelId ?? '').trim();
    if (pasModelId) doc.pasModelId = pasModelId;
  }

  const previousStock = Number(existing?.stock);
  const zohoSyncEntry = buildZohoSyncAuditAdjustment(
    existing?.auditSnapshot,
    previousStock,
    product.stock,
    now,
  );
  if (zohoSyncEntry) {
    const productRef = db.collection(PRODUCTS_COLLECTION).doc(id);
    const logRef = productRef.collection('auditLogs').doc();
    const prior = existing?.auditSnapshot && typeof existing.auditSnapshot === 'object'
      ? existing.auditSnapshot
      : {};
    const log = {
      id: logRef.id,
      catalogProductId: id,
      auditedAt: zohoSyncEntry.auditedAt,
      auditedByUid: null,
      auditedByName: zohoSyncEntry.auditedByName,
      mode: zohoSyncEntry.mode,
      headOfficeQty: zohoSyncEntry.headOfficeQty,
      cochinQty: zohoSyncEntry.cochinQty,
      physicalQty: zohoSyncEntry.physicalQty,
      rawPhysicalQty: null,
      zohoQtyAtAudit: zohoSyncEntry.zohoQtyAtAudit,
      baselineDifference: zohoSyncEntry.baselineDifference,
      pendingZohoInbound: zohoSyncEntry.pendingZohoInbound ?? 0,
      trigger: 'zoho_sync',
      auditCycleId: null,
    };
    const snapshot = {
      ...prior,
      lastAuditLogId: logRef.id,
      baselineDifference: zohoSyncEntry.baselineDifference,
      pendingZohoInbound: zohoSyncEntry.pendingZohoInbound ?? Number(prior.pendingZohoInbound ?? 0),
      physicalQtyAtAudit: zohoSyncEntry.physicalQty,
      zohoQtyAtAudit: zohoSyncEntry.zohoQtyAtAudit,
      mode: zohoSyncEntry.mode,
      headOfficeQtyAtAudit: Number(prior.headOfficeQtyAtAudit ?? zohoSyncEntry.headOfficeQty),
      cochinQtyAtAudit: Number(prior.cochinQtyAtAudit ?? zohoSyncEntry.cochinQty),
      lastPhysicalAuditedAt: prior.lastPhysicalAuditedAt ?? prior.lastAuditedAt ?? null,
      lastPhysicalAuditedByUid: prior.lastPhysicalAuditedByUid ?? prior.lastAuditedByUid ?? null,
      lastPhysicalAuditedByName: prior.lastPhysicalAuditedByName ?? prior.lastAuditedByName ?? null,
      lastAuditCycleId: prior.lastAuditCycleId ?? null,
      lastHeadOfficeAuditCycleId: prior.lastHeadOfficeAuditCycleId ?? null,
      lastCochinAuditCycleId: prior.lastCochinAuditCycleId ?? null,
      lastAuditedAt: prior.lastAuditedAt ?? prior.lastPhysicalAuditedAt ?? zohoSyncEntry.auditedAt,
      lastAuditedByUid: prior.lastAuditedByUid ?? prior.lastPhysicalAuditedByUid ?? null,
      lastAuditedByName: prior.lastAuditedByName ?? prior.lastPhysicalAuditedByName ?? null,
    };
    await logRef.set(log);
    doc.auditSnapshot = snapshot;
  } else if (existing?.auditSnapshot) {
    doc.auditSnapshot = existing.auditSnapshot;
  }

  if (Number.isFinite(existing?.displayOrder)) {
    doc.displayOrder = existing.displayOrder;
  }

  preserveFirestoreOnlyProductFlags(existing, doc);

  await db.collection(PRODUCTS_COLLECTION).doc(id).set(doc, { merge: true });
  await db.doc(META_DOC).set({
    lastContentChangeAt: now,
    lastSyncAt: now,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { id, created: !existingSnap.exists };
}

export async function handleZohoItemWebhook(secrets, orgId, req) {
  const body = normalizeWebhookBody(req.body ?? {});
  const itemId = extractItemIdFromWebhook(body, req.query ?? {});
  if (!itemId) {
    return { ok: false, status: 400, message: 'Missing item_id' };
  }

  const queryAction = String(req.query?.action ?? '').trim().toLowerCase();
  const event = queryAction || extractWebhookEvent(body);
  if (event.includes('delete')) {
    await deleteCatalogItemFromFirestore(itemId);
    return { ok: true, status: 200, action: 'deleted', itemId };
  }

  const result = await mirrorCatalogItemFromZoho(secrets, orgId, itemId, {
    skipImages: true,
    source: 'webhook',
  });
  return { ok: true, status: 200, action: 'synced', itemId, result };
}
