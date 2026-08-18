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

export function dealerCanOrderProduct(
  product: Pick<CatalogProduct, 'hsn' | 'stock' | 'auditSnapshot' | 'ledgerClosingStock' | 'categoryName' | 'categoryId'> | null | undefined,
  scheduledQty = 0,
): boolean {
  if (!product) return Number(scheduledQty) > 0;
  if (isSacHsn(product.hsn)) return true;
  if (dealerCatalogAvailableQty(product) > 0) return true;
  return Number(scheduledQty) > 0;
}

export function dealerOrderUsesScheduledInbound(
  product: Pick<CatalogProduct, 'hsn' | 'stock' | 'auditSnapshot' | 'ledgerClosingStock' | 'categoryName' | 'categoryId'> | null | undefined,
  scheduledQty = 0,
): boolean {
  if (!product || isSacHsn(product.hsn)) return false;
  return dealerCatalogAvailableQty(product) <= 0 && Number(scheduledQty) > 0;
}

export const DEALER_ORDER_UNAVAILABLE_TITLE =
  'Out of stock — not scheduled for warehouse receipt';

export const DEALER_ORDER_UNAVAILABLE_MESSAGE =
  'This item is out of stock. You can order it when warehouse stock is available or it is scheduled on a goods receipt.';

export const DEALER_ORDER_SCHEDULED_TITLE =
  'Inbound scheduled — you can order now';

export const DEALER_ORDER_SCHEDULED_MESSAGE =
  'Audited stock is 0. Inbound is scheduled — this order will be fulfilled when goods arrive.';
