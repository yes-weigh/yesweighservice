import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isDealerPortalUser } from '../lib/dealerAccess';
import {
  dealerCanOrderProduct,
  dealerOrderUsesScheduledInbound,
} from '../lib/dealerOrderStock';
import { getScheduledInboundQtyByProductId } from '../lib/scheduledGoodsReceiptInbound';
import type { CatalogProduct } from '../types/catalog';

export function useDealerOrderStockGate() {
  const { user } = useAuth();
  const gate = isDealerPortalUser(user);
  const [inboundByProductId, setInboundByProductId] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!gate) {
      setInboundByProductId({});
      return;
    }
    let cancelled = false;
    void getScheduledInboundQtyByProductId().then(map => {
      if (!cancelled) setInboundByProductId(map);
    });
    return () => {
      cancelled = true;
    };
  }, [gate]);

  const scheduledQty = (productId: string) => inboundByProductId[productId] ?? 0;

  const canOrder = (
    product: Pick<CatalogProduct, 'id' | 'hsn' | 'stock' | 'auditSnapshot' | 'ledgerClosingStock' | 'categoryName' | 'categoryId'> | null | undefined,
  ) => {
    if (!gate) return true;
    if (!product) return false;
    return dealerCanOrderProduct(product, scheduledQty(product.id));
  };

  const usesScheduledInbound = (
    product: Pick<CatalogProduct, 'id' | 'hsn' | 'stock' | 'auditSnapshot' | 'ledgerClosingStock' | 'categoryName' | 'categoryId'> | null | undefined,
  ) => {
    if (!gate || !product) return false;
    return dealerOrderUsesScheduledInbound(product, scheduledQty(product.id));
  };

  return {
    gate,
    inboundByProductId,
    scheduledQty,
    canOrder,
    usesScheduledInbound,
  };
}
