import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { withCatalogImageCacheBust } from './catalog';
import type { DealerInvoiceDetail, DealerInvoiceLineItem } from '../types/invoices';

function imageFromCatalogData(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const raw = (data.imageUrl as string | null)
    ?? (Array.isArray(data.imageUrls) ? (data.imageUrls[0] as string | null) : null)
    ?? null;
  return withCatalogImageCacheBust(raw, data.imageUpdatedAt as string | number | null | undefined);
}

async function catalogImageByItemId(itemId: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'catalogProducts', itemId));
  if (!snap.exists()) return null;
  return imageFromCatalogData(snap.data() as Record<string, unknown>);
}

async function catalogImageBySku(sku: string): Promise<string | null> {
  const trimmed = sku.trim();
  if (!trimmed) return null;
  const snap = await getDocs(
    query(collection(db, 'catalogProducts'), where('sku', '==', trimmed), limit(1)),
  );
  if (snap.empty) return null;
  return imageFromCatalogData(snap.docs[0].data() as Record<string, unknown>);
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
  const lineItems = await enrichInvoiceLineItemImages(detail.lineItems);
  if (lineItems === detail.lineItems) return detail;
  return { ...detail, lineItems };
}
