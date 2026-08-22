import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isDealerPortalUser } from '../lib/dealerAccess';
import {
  dealerCanOrderProduct,
  dealerOrderUsesScheduledInbound,
  dealerShouldListCatalogProduct,
} from '../lib/dealerOrderStock';
import { getScheduledInboundQtyByProductId } from '../lib/scheduledGoodsReceiptInbound';
import { loadRaisedPoQtyByItemId } from '../lib/raisedPoQty';
import type { CatalogProduct } from '../types/catalog';

type StockProduct = Pick<
  CatalogProduct,
  'id' | 'hsn' | 'stock' | 'auditSnapshot' | 'ledgerClosingStock' | 'categoryName' | 'categoryId'
>;

export function useDealerOrderStockGate() {
  const { user } = useAuth();
  const gate = isDealerPortalUser(user);
  const [inboundByProductId, setInboundByProductId] = useState<Record<string, number>>({});
  const [raisedPoByProductId, setRaisedPoByProductId] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!gate) {
      setInboundByProductId({});
      setRaisedPoByProductId({});
      return;
    }
    let cancelled = false;
    void Promise.all([
      getScheduledInboundQtyByProductId(),
      loadRaisedPoQtyByItemId().catch(() => new Map<string, number>()),
    ]).then(([inbound, poMap]) => {
      if (cancelled) return;
      setInboundByProductId(inbound);
      const po: Record<string, number> = {};
      poMap.forEach((qty, id) => {
        if (qty > 0) po[id] = qty;
      });
      setRaisedPoByProductId(po);
    });
    return () => {
      cancelled = true;
    };
  }, [gate]);

  const scheduledQty = useCallback(
    (productId: string) => inboundByProductId[productId] ?? 0,
    [inboundByProductId],
  );

  const raisedPoQty = useCallback(
    (productId: string) => raisedPoByProductId[productId] ?? 0,
    [raisedPoByProductId],
  );

  const canOrder = useCallback(
    (product: StockProduct | null | undefined) => {
      if (!gate) return true;
      if (!product) return false;
      return dealerCanOrderProduct(product, scheduledQty(product.id), raisedPoQty(product.id));
    },
    [gate, scheduledQty, raisedPoQty],
  );

  const shouldList = useCallback(
    (product: StockProduct | null | undefined) => {
      if (!gate) return true;
      if (!product) return false;
      return dealerShouldListCatalogProduct(product, scheduledQty(product.id), raisedPoQty(product.id));
    },
    [gate, scheduledQty, raisedPoQty],
  );

  const usesScheduledInbound = useCallback(
    (product: StockProduct | null | undefined) => {
      if (!gate || !product) return false;
      return dealerOrderUsesScheduledInbound(product, scheduledQty(product.id), raisedPoQty(product.id));
    },
    [gate, scheduledQty, raisedPoQty],
  );

  return {
    gate,
    inboundByProductId,
    scheduledQty,
    raisedPoQty,
    canOrder,
    shouldList,
    usesScheduledInbound,
  };
}

/** Dealer portal lists omit zero-audited items with no upcoming shipment. */
export function useDealerListedCatalogProducts<T extends CatalogProduct>(products: T[]): T[] {
  const { gate, shouldList } = useDealerOrderStockGate();
  return useMemo(() => {
    if (!gate) return products;
    return products.filter(product => shouldList(product));
  }, [gate, products, shouldList]);
}
