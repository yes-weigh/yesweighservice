import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { withCatalogImageCacheBust } from './catalog';
import type { DealerInvoiceDetail, DealerInvoiceLineItem } from '../types/invoices';

async function catalogImageByItemId(itemId: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'catalogProducts', itemId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return withCatalogImageCacheBust(
    (data?.imageUrl as string | null) ?? null,
    data?.syncedAt,
  );
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
  const missingIds = [
    ...new Set(
      lineItems
        .filter(item => !item.imageUrl && item.itemId)
        .map(item => item.itemId!),
    ),
  ];
  if (!missingIds.length) return lineItems;

  const imageMap = new Map<string, string>();
  await Promise.all(
    missingIds.map(async id => {
      const imageUrl = await catalogImageByItemId(id);
      if (imageUrl) imageMap.set(id, imageUrl);
    }),
  );
  if (!imageMap.size) return lineItems;

  return lineItems.map(item => {
    if (item.imageUrl || !item.itemId) return item;
    const imageUrl = imageMap.get(item.itemId);
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
