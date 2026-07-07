import { getFirestore } from 'firebase-admin/firestore';

const MAP_COLLECTION = 'catalogProductSpareMap';
const PRODUCTS_COLLECTION = 'catalogProducts';
const CATEGORIES_COLLECTION = 'catalogCategories';

function hasCategoryId(product) {
  const id = String(product?.categoryId ?? '').trim();
  return Boolean(id && id !== '-1');
}

function isGenericSparePartsCategoryName(name) {
  const normalized = String(name ?? '').trim().toLowerCase();
  return (
    normalized === 'generic spare parts'
    || normalized === 'generic spares'
    || normalized.includes('generic spare')
  );
}

async function loadGenericSpareCategoryIds(db) {
  const snap = await db.collection(CATEGORIES_COLLECTION).get();
  const ids = new Set();
  for (const doc of snap.docs) {
    if (isGenericSparePartsCategoryName(doc.data()?.name)) {
      ids.add(doc.id);
    }
  }
  return ids;
}

function isGenericSpareProduct(product, genericCategoryIds) {
  if (isGenericSparePartsCategoryName(product?.categoryName)) return true;
  const categoryId = String(product?.categoryId ?? '').trim();
  return Boolean(categoryId && genericCategoryIds.has(categoryId));
}

function isLinkableSpare(product, genericCategoryIds) {
  if (!product) return false;
  if (!hasCategoryId(product)) return true;
  return isGenericSpareProduct(product, genericCategoryIds);
}

function toClientProduct(data) {
  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    sku: data.sku ?? null,
    description: data.description ?? null,
    unit: String(data.unit ?? 'pcs'),
    rate: Number(data.rate ?? 0),
    stock: Number(data.stock ?? 0),
    stockStatus: data.stockStatus ?? 'out_of_stock',
    imageUrl: data.imageUrl ?? null,
    categoryId: data.categoryId ?? null,
    categoryName: data.categoryName ?? null,
    status: String(data.status ?? 'active'),
    hsn: data.hsn ?? null,
    taxName: data.taxName ?? null,
    taxPercentage: Number(data.taxPercentage ?? 0),
    syncedAt: data.syncedAt ?? undefined,
  };
}

async function readActiveProduct(db, id) {
  const snap = await db.collection(PRODUCTS_COLLECTION).doc(String(id)).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.status !== 'active') return null;
  return data;
}

export async function getLinkedSparesForProduct(productId) {
  const db = getFirestore();
  const product = await readActiveProduct(db, productId);
  if (!product || !hasCategoryId(product)) {
    return [];
  }

  const genericCategoryIds = await loadGenericSpareCategoryIds(db);
  const mapSnap = await db.collection(MAP_COLLECTION).doc(String(productId)).get();
  const spareIds = mapSnap.exists ? (mapSnap.data().spareIds ?? []) : [];

  const spares = [];
  for (const spareId of spareIds) {
    const spare = await readActiveProduct(db, spareId);
    if (spare && isLinkableSpare(spare, genericCategoryIds)) {
      spares.push(toClientProduct(spare));
    }
  }

  return spares.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLinkedProductsForSpare(spareId) {
  const db = getFirestore();
  const spare = await readActiveProduct(db, spareId);
  const genericCategoryIds = await loadGenericSpareCategoryIds(db);
  if (!spare || !isLinkableSpare(spare, genericCategoryIds)) {
    return [];
  }

  const querySnap = await db
    .collection(MAP_COLLECTION)
    .where('spareIds', 'array-contains', String(spareId))
    .get();

  const products = [];
  for (const doc of querySnap.docs) {
    const product = await readActiveProduct(db, doc.id);
    if (product && hasCategoryId(product)) {
      products.push(toClientProduct(product));
    }
  }

  return products.sort((a, b) => a.name.localeCompare(b.name));
}

async function assertCategorizedProduct(db, productId) {
  const product = await readActiveProduct(db, productId);
  if (!product) throw new Error('Product not found in catalog.');
  if (!hasCategoryId(product)) throw new Error('Item is not a categorized product.');
  return product;
}

async function assertLinkableSpare(db, spareId) {
  const spare = await readActiveProduct(db, spareId);
  if (!spare) throw new Error('Spare not found in catalog.');
  const genericCategoryIds = await loadGenericSpareCategoryIds(db);
  if (!isLinkableSpare(spare, genericCategoryIds)) {
    throw new Error('Item is not a spare part (uncategorized or Generic spare parts only).');
  }
  return spare;
}

export async function saveProductSpareMap(productId, spareIds, uid) {
  const db = getFirestore();
  const id = String(productId ?? '').trim();
  if (!id) throw new Error('productId is required.');

  await assertCategorizedProduct(db, id);

  const uniqueSpareIds = [...new Set((spareIds ?? []).map(s => String(s).trim()).filter(Boolean))];
  for (const spareId of uniqueSpareIds) {
    await assertLinkableSpare(db, spareId);
  }

  const now = new Date().toISOString();
  const ref = db.collection(MAP_COLLECTION).doc(id);

  if (!uniqueSpareIds.length) {
    await ref.delete();
    return { ok: true, productId: id, spareIds: [] };
  }

  await ref.set({
    productId: id,
    spareIds: uniqueSpareIds,
    updatedAt: now,
    updatedByUid: uid,
  });

  return { ok: true, productId: id, spareIds: uniqueSpareIds };
}

export async function saveSpareProductMap(spareId, productIds, uid) {
  const db = getFirestore();
  const id = String(spareId ?? '').trim();
  if (!id) throw new Error('spareId is required.');

  await assertLinkableSpare(db, id);

  const uniqueProductIds = [...new Set((productIds ?? []).map(p => String(p).trim()).filter(Boolean))];
  for (const productId of uniqueProductIds) {
    await assertCategorizedProduct(db, productId);
  }

  const targetSet = new Set(uniqueProductIds);
  const existingSnap = await db
    .collection(MAP_COLLECTION)
    .where('spareIds', 'array-contains', id)
    .get();

  const batch = db.batch();
  const now = new Date().toISOString();

  for (const doc of existingSnap.docs) {
    if (!targetSet.has(doc.id)) {
      const nextIds = (doc.data().spareIds ?? []).filter(sid => sid !== id);
      if (!nextIds.length) {
        batch.delete(doc.ref);
      } else {
        batch.set(doc.ref, { spareIds: nextIds, updatedAt: now, updatedByUid: uid }, { merge: true });
      }
    }
  }

  for (const productId of uniqueProductIds) {
    const ref = db.collection(MAP_COLLECTION).doc(productId);
    const snap = await ref.get();
    const current = snap.exists ? (snap.data().spareIds ?? []) : [];
    if (!current.includes(id)) {
      batch.set(
        ref,
        {
          productId,
          spareIds: [...current, id],
          updatedAt: now,
          updatedByUid: uid,
        },
        { merge: true },
      );
    }
  }

  await batch.commit();
  return { ok: true, spareId: id, productIds: uniqueProductIds };
}
