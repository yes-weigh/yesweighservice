/**
 * Weighing-scale (and Indicators & CCM) lines need a serial per unit
 * before warehouse can book courier / mark delivered.
 */
import { getFirestore } from 'firebase-admin/firestore';
export const MANDATORY_SERIAL_CATEGORY_NAMES = new Set([
  'WEIGHING SCALE IMPORT',
  'BILL PRINTING SCALES',
  'WEIGHING SCALES INDIA',
  'ANALYTICAL SCALES',
  'INDUSTRIAL WEIGHING SCALE',
  'INDICATORS & CCM',
]);

export const MANDATORY_SERIAL_EXEMPT_SKUS = new Set([
  // User will share exempt SKUs.
]);

export const MANDATORY_SERIAL_EXEMPT_PRODUCT_IDS = new Set([
  // User will share exempt catalog product ids.
]);

function compactSku(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function isMandatorySerialExemptLine(line) {
  const sku = compactSku(line?.sku);
  if (sku && MANDATORY_SERIAL_EXEMPT_SKUS.has(sku)) return true;
  const itemId = String(line?.itemId ?? '').trim();
  return Boolean(itemId && MANDATORY_SERIAL_EXEMPT_PRODUCT_IDS.has(itemId));
}

export function lineIsMandatorySerialCategory(line) {
  if (line?.isWeighingScale === true) return true;
  const name = String(line?.categoryName ?? '').trim().toUpperCase();
  return Boolean(name) && MANDATORY_SERIAL_CATEGORY_NAMES.has(name);
}

export function assertCanMutateSerialsAfterDelivery(data, allowWhenDelivered) {
  if (invoiceLooksDelivered(data) && !allowWhenDelivered) {
    throw new Error('Only admin can link or unlink serial numbers after the invoice is delivered.');
  }
}

export function invoiceLooksDelivered(data) {
  const pickup = data?.customerPickup;
  if (pickup && typeof pickup === 'object' && String(pickup.markedAt || '').trim()) return true;
  const delivery = data?.manualDelivery;
  if (delivery && typeof delivery === 'object' && String(delivery.markedAt || '').trim()) return true;
  if (String(data?.manualDeliveredAt || '').trim()) return true;
  if (String(data?.goodsReceivedAt || '').trim()) return true;
  return false;
}

/**
 * Older invoice docs may lack categoryName / isWeighingScale. Resolve from catalog
 * so CCM / indicator / renamed weighing-scale lines still require serials.
 */
export async function enrichInvoiceLinesCatalogCategory(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const ids = [...new Set(list.map(line => String(line?.itemId || '').trim()).filter(Boolean))];
  if (!ids.length) return list;

  const db = getFirestore();
  const snaps = await db.getAll(...ids.map(id => db.collection('catalogProducts').doc(id)));
  const byId = new Map();
  const categoryIds = new Set();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const categoryId = data.categoryId != null ? String(data.categoryId).trim() : '';
    if (categoryId) categoryIds.add(categoryId);
    byId.set(snap.id, {
      hsn: data.hsn != null ? String(data.hsn) : null,
      categoryId: categoryId || null,
      categoryName: data.categoryName != null ? String(data.categoryName) : null,
    });
  }

  const weighingIds = new Set();
  if (categoryIds.size) {
    const catSnaps = await db.getAll(
      ...[...categoryIds].map(id => db.collection('catalogCategories').doc(id)),
    );
    for (const snap of catSnaps) {
      if (snap.exists && snap.data()?.isWeighingScale) weighingIds.add(snap.id);
    }
  }

  return list.map(line => {
    const meta = line?.itemId ? byId.get(String(line.itemId)) : null;
    const categoryId = String(line?.categoryId || meta?.categoryId || '').trim();
    return {
      ...line,
      hsn: line?.hsn || meta?.hsn || null,
      ...(categoryId ? { categoryId } : {}),
      ...(line?.categoryName || meta?.categoryName
        ? { categoryName: line?.categoryName || meta?.categoryName }
        : {}),
      isWeighingScale: line?.isWeighingScale === true || Boolean(categoryId && weighingIds.has(categoryId)),
    };
  });
}
