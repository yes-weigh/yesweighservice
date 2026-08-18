/**
 * Dealer order availability: audited warehouse stock, or scheduled inbound
 * on a draft goods receipt (purchased, arriving in a few days).
 */
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { nextAuditDiffAfterZohoChange } from './catalog-product-audit.js';
import { isFreightOrderLine } from './freight-lines.js';
import { isSacHsn } from './sac-catalog.js';
import { scheduledInboundQtyByProductId } from './scheduled-goods-receipt-inbound.js';

const PRODUCTS = 'catalogProducts';

function catalogAuditedStockQty(product) {
  if (!product) return 0;
  if (isSacHsn(product.hsn)) return 1;
  const stock = Number(product.stock);
  const currentZoho = Number.isFinite(stock) ? stock : 0;
  const snap = product.auditSnapshot;
  if (!snap || typeof snap !== 'object') {
    return currentZoho;
  }
  const baselineDifference = Number(snap.baselineDifference);
  const lockedDiff = Number.isFinite(baselineDifference)
    ? baselineDifference
    : Number(snap.physicalQtyAtAudit ?? 0) - Number(snap.zohoQtyAtAudit ?? 0);
  const prevZoho = Number(snap.zohoQtyAtAudit);
  const liveDiff = Number.isFinite(prevZoho)
    ? nextAuditDiffAfterZohoChange(
      prevZoho,
      currentZoho,
      lockedDiff,
      snap.pendingZohoInbound ?? 0,
    )
    : lockedDiff;
  const qty = currentZoho + Number(liveDiff);
  return Number.isFinite(qty) ? qty : 0;
}

export function dealerCanOrderProduct(product, scheduledQty = 0) {
  if (!product) return false;
  if (isSacHsn(product.hsn)) return true;
  if (catalogAuditedStockQty(product) > 0) return true;
  return Number(scheduledQty) > 0;
}

async function loadProductForStock(productId) {
  const snap = await getFirestore().doc(`${PRODUCTS}/${productId}`).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    productId: snap.id,
    name: String(data.name ?? 'Product'),
    hsn: data.hsn != null ? String(data.hsn) : null,
    stock: Number(data.stock ?? 0),
    auditSnapshot: data.auditSnapshot && typeof data.auditSnapshot === 'object'
      ? data.auditSnapshot
      : null,
    ledgerClosingStock: data.ledgerClosingStock != null
      ? Number(data.ledgerClosingStock)
      : null,
  };
}

/**
 * Reject dealer cart lines with no audited stock and no scheduled inbound.
 * @param {object[]} lines
 */
export async function assertDealerGoodsLinesOrderable(lines) {
  const goods = (Array.isArray(lines) ? lines : []).filter(line => !isFreightOrderLine(line));
  if (goods.length === 0) return;

  const inbound = await scheduledInboundQtyByProductId();
  const ids = [...new Set(goods.map(line => String(line?.productId ?? '').trim()).filter(Boolean))];
  const products = await Promise.all(ids.map(id => loadProductForStock(id)));
  const byId = new Map(ids.map((id, i) => [id, products[i]]));

  for (const line of goods) {
    const productId = String(line?.productId ?? '').trim();
    const product = byId.get(productId) || null;
    const scheduledQty = inbound[productId] || 0;
    if (dealerCanOrderProduct(product, scheduledQty)) continue;
    const name = product?.name || line?.name || productId;
    throw new HttpsError(
      'failed-precondition',
      `${name} is out of stock and is not scheduled on a goods receipt.`,
    );
  }
}
