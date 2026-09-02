import { collection, doc, documentId, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { isCatalogSparePartProduct, withCatalogImageCacheBust } from './catalog';
import type { DealerInvoiceDetail, DealerInvoiceLineItem } from '../types/invoices';

export type LineItemCatalogMeta = {
  imageUrl: string | null;
  hsn: string | null;
  categoryId: string | null;
  categoryName: string | null;
  modelNumber: string | null;
  isWeighingScale: boolean;
  isCatalogSpare: boolean;
  spareGroupId: string | null;
};

function metaFromCatalogData(data: Record<string, unknown> | undefined): LineItemCatalogMeta {
  const raw = data
    ? (data.imageUrl as string | null)
      ?? (Array.isArray(data.imageUrls) ? (data.imageUrls[0] as string | null) : null)
      ?? null
    : null;
  const spareGroupId = typeof data?.spareGroupId === 'string' && data.spareGroupId.trim()
    ? data.spareGroupId.trim()
    : null;
  return {
    imageUrl: withCatalogImageCacheBust(raw, data?.imageUpdatedAt as string | number | null | undefined),
    hsn: data?.hsn != null ? String(data.hsn) : null,
    categoryId: data?.categoryId != null ? String(data.categoryId) : null,
    categoryName: data?.categoryName != null ? String(data.categoryName) : null,
    modelNumber: data?.modelNumber != null ? String(data.modelNumber).trim() || null : null,
    isWeighingScale: false,
    spareGroupId,
    isCatalogSpare: Boolean(spareGroupId) || isCatalogSparePartProduct({
      categoryId: data?.categoryId != null ? String(data.categoryId) : null,
      categoryName: data?.categoryName != null ? String(data.categoryName) : null,
      modelNumber: data?.modelNumber != null ? String(data.modelNumber).trim() || null : null,
    }),
  };
}

async function catalogMetaByItemId(itemId: string): Promise<LineItemCatalogMeta | null> {
  const snap = await getDoc(doc(db, 'catalogProducts', itemId));
  if (!snap.exists()) return null;
  return metaFromCatalogData(snap.data() as Record<string, unknown>);
}

async function catalogImageByItemId(itemId: string): Promise<string | null> {
  const meta = await catalogMetaByItemId(itemId);
  return meta?.imageUrl ?? null;
}

async function catalogImageBySku(sku: string): Promise<string | null> {
  const trimmed = sku.trim();
  if (!trimmed) return null;
  const snap = await getDocs(
    query(collection(db, 'catalogProducts'), where('sku', '==', trimmed), limit(1)),
  );
  if (snap.empty) return null;
  return metaFromCatalogData(snap.docs[0].data() as Record<string, unknown>).imageUrl;
}

const catalogMetaMemo = new Map<string, LineItemCatalogMeta>();

export async function fetchCatalogMetaForItemIds(
  itemIds: string[],
): Promise<Map<string, LineItemCatalogMeta>> {
  const unique = [...new Set(itemIds.filter(Boolean))];
  const map = new Map<string, LineItemCatalogMeta>();
  if (!unique.length) return map;

  const missing: string[] = [];
  for (const id of unique) {
    const cached = catalogMetaMemo.get(id);
    if (cached) map.set(id, cached);
    else missing.push(id);
  }
  if (!missing.length) return map;

  const col = collection(db, 'catalogProducts');
  for (let i = 0; i < missing.length; i += 10) {
    const chunk = missing.slice(i, i + 10);
    const snap = await getDocs(query(col, where(documentId(), 'in', chunk)));
    for (const docSnap of snap.docs) {
      const meta = metaFromCatalogData(docSnap.data() as Record<string, unknown>);
      catalogMetaMemo.set(docSnap.id, meta);
      map.set(docSnap.id, meta);
    }
  }
  const categoryIds = [...new Set(
    [...map.values()].map(meta => meta.categoryId).filter((id): id is string => Boolean(id)),
  )];
  if (categoryIds.length) {
    const weighing = new Set<string>();
    const cats = collection(db, 'catalogCategories');
    for (let i = 0; i < categoryIds.length; i += 10) {
      const chunk = categoryIds.slice(i, i + 10);
      const catSnap = await getDocs(query(cats, where(documentId(), 'in', chunk)));
      for (const docSnap of catSnap.docs) {
        if (docSnap.data()?.isWeighingScale) weighing.add(docSnap.id);
      }
    }
    for (const [id, meta] of map) {
      if (meta.isCatalogSpare) continue;
      if (meta.categoryId && weighing.has(meta.categoryId)) {
        const next = { ...meta, isWeighingScale: true };
        catalogMetaMemo.set(id, next);
        map.set(id, next);
      }
    }
  }
  return map;
}

export function applyCatalogMetaToLineItems(
  lineItems: DealerInvoiceLineItem[],
  metaByItemId: Map<string, LineItemCatalogMeta>,
): DealerInvoiceLineItem[] {
  if (!metaByItemId.size) return lineItems;
  return lineItems.map(item => {
    const meta = item.itemId ? metaByItemId.get(item.itemId) : undefined;
    if (!meta) return item;
    const catalogSpare = Boolean(meta.spareGroupId) || isCatalogSparePartProduct({
      categoryId: meta.categoryId,
      categoryName: meta.categoryName,
      modelNumber: meta.modelNumber,
    });
    return {
      ...item,
      imageUrl: item.imageUrl || meta.imageUrl,
      hsn: item.hsn || meta.hsn,
      ...(meta.categoryId ? { categoryId: item.categoryId || meta.categoryId } : {}),
      ...(meta.categoryName ? { categoryName: item.categoryName || meta.categoryName } : {}),
      ...(meta.isWeighingScale && !catalogSpare ? { isWeighingScale: true } : {}),
      isCatalogSpare: catalogSpare,
    };
  });
}

export async function enrichInvoiceLineItemsCatalog(
  lineItems: DealerInvoiceLineItem[],
): Promise<DealerInvoiceLineItem[]> {
  const ids = [...new Set(
    lineItems.map(item => item.itemId).filter((id): id is string => Boolean(id)),
  )];
  if (!ids.length) return lineItems;
  const meta = await fetchCatalogMetaForItemIds(ids);
  return applyCatalogMetaToLineItems(lineItems, meta);
}

export async function fetchCatalogImagesForItemIds(
  itemIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(itemIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;

  await Promise.all(
    unique.map(async id => {
      const imageUrl = await catalogImageByItemId(id);
      if (imageUrl) map.set(id, imageUrl);
    }),
  );
  return map;
}

export async function enrichInvoiceLineItemImages(
  lineItems: DealerInvoiceLineItem[],
): Promise<DealerInvoiceLineItem[]> {
  const missing = lineItems.filter(item => !item.imageUrl && (item.itemId || item.sku));
  if (!missing.length) return lineItems;

  const byItemId = new Map<string, string>();
  const bySku = new Map<string, string>();
  const itemIds = [...new Set(missing.map(item => item.itemId).filter(Boolean) as string[])];
  const skus = [...new Set(missing.map(item => item.sku).filter(Boolean) as string[])];

  await Promise.all([
    ...itemIds.map(async id => {
      const imageUrl = await catalogImageByItemId(id);
      if (imageUrl) byItemId.set(id, imageUrl);
    }),
    ...skus.map(async sku => {
      const imageUrl = await catalogImageBySku(sku);
      if (imageUrl) bySku.set(sku, imageUrl);
    }),
  ]);

  if (!byItemId.size && !bySku.size) return lineItems;

  return lineItems.map(item => {
    if (item.imageUrl) return item;
    const imageUrl = (item.itemId ? byItemId.get(item.itemId) : null)
      || (item.sku ? bySku.get(item.sku) : null)
      || null;
    return imageUrl ? { ...item, imageUrl } : item;
  });
}

export async function enrichInvoiceDetailImages(
  detail: DealerInvoiceDetail,
): Promise<DealerInvoiceDetail> {
  const withImages = await enrichInvoiceLineItemImages(detail.lineItems);
  const lineItems = await enrichInvoiceLineItemsCatalog(withImages);
  if (lineItems === detail.lineItems) return detail;
  return { ...detail, lineItems };
}
