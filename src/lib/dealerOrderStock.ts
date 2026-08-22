import { catalogGridStockQty } from './catalogProductAudit/display';
import { isSacHsn } from './sacCatalog';
import type { CatalogProduct } from '../types/catalog';

/**
 * Qty dealers treat as available to order.
 * SAC / services: always orderable.
 * Audited products: Zoho + Diff (catalog grid).
 * Never audited: Zoho stock (do not treat missing audit as zero).
 */
export function dealerCatalogAvailableQty(
  product: Pick<CatalogProduct, 'hsn' | 'stock' | 'auditSnapshot' | 'ledgerClosingStock' | 'categoryName' | 'categoryId'>,
): number {
  if (isSacHsn(product.hsn)) return 1;
  if (product.auditSnapshot) {
    return catalogGridStockQty(product as CatalogProduct);
  }
  const stock = Number(product.stock);
  return Number.isFinite(stock) ? stock : 0;
}

/** Upcoming shipment qty (scheduled warehouse receipt and/or open PO). */
export function dealerUpcomingShipmentQty(scheduledQty = 0, raisedPoQty = 0): number {
  const inbound = Number(scheduledQty);
  const po = Number(raisedPoQty);
  const a = Number.isFinite(inbound) && inbound > 0 ? inbound : 0;
  const b = Number.isFinite(po) && po > 0 ? po : 0;
  return Math.max(a, b);
}

export function dealerCanOrderProduct(
  product: Pick<CatalogProduct, 'hsn' | 'stock' | 'auditSnapshot' | 'ledgerClosingStock' | 'categoryName' | 'categoryId'> | null | undefined,
  scheduledQty = 0,
  raisedPoQty = 0,
): boolean {
  if (!product) return dealerUpcomingShipmentQty(scheduledQty, raisedPoQty) > 0;
  if (isSacHsn(product.hsn)) return true;
  if (dealerCatalogAvailableQty(product) > 0) return true;
  return dealerUpcomingShipmentQty(scheduledQty, raisedPoQty) > 0;
}

/** Dealer browse: hide when audited/available stock is 0 and there is no upcoming shipment. */
export function dealerShouldListCatalogProduct(
  product: Pick<CatalogProduct, 'hsn' | 'stock' | 'auditSnapshot' | 'ledgerClosingStock' | 'categoryName' | 'categoryId'> | null | undefined,
  scheduledQty = 0,
  raisedPoQty = 0,
): boolean {
  return dealerCanOrderProduct(product, scheduledQty, raisedPoQty);
}

export function dealerOrderUsesScheduledInbound(
  product: Pick<CatalogProduct, 'hsn' | 'stock' | 'auditSnapshot' | 'ledgerClosingStock' | 'categoryName' | 'categoryId'> | null | undefined,
  scheduledQty = 0,
  raisedPoQty = 0,
): boolean {
  if (!product || isSacHsn(product.hsn)) return false;
  return dealerCatalogAvailableQty(product) <= 0
    && dealerUpcomingShipmentQty(scheduledQty, raisedPoQty) > 0;
}

export const DEALER_ORDER_UNAVAILABLE_TITLE =
  'Out of stock — not scheduled for warehouse receipt';

export const DEALER_ORDER_UNAVAILABLE_MESSAGE =
  'This item is out of stock. You can order it when warehouse stock is available or it is scheduled on a goods receipt.';

export const DEALER_ORDER_SCHEDULED_TITLE =
  'Inbound scheduled — you can order now';

export const DEALER_ORDER_SCHEDULED_MESSAGE =
  'Audited stock is 0. An upcoming shipment is scheduled — this order will be fulfilled when goods arrive.';
