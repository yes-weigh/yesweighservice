/**
 * Scheduled Zoho bills (goodsReceipts status draft) — purchased goods
 * still on the way to the warehouse.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { isFreightProductId, isFreightSku } from './freight-lines.js';

/**
 * Sum draft goods-receipt quantities by catalog / Zoho item id.
 * Skips freight lines and bills ops already received.
 * @returns {Promise<Record<string, number>>}
 */
export async function scheduledInboundQtyByProductId() {
  const snap = await getFirestore()
    .collection('goodsReceipts')
    .where('status', '==', 'draft')
    .get();
  const map = {};
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (data.opsReceivedAt) continue;
    const lines = Array.isArray(data.lineItems) ? data.lineItems : [];
    for (const line of lines) {
      const id = String(line?.itemId ?? '').trim();
      if (!id || isFreightProductId(id) || isFreightSku(line?.sku)) continue;
      const qty = Number(line?.quantity) || 0;
      if (qty <= 0) continue;
      map[id] = (map[id] || 0) + qty;
    }
  }
  return map;
}
