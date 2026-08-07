import { useContext, useMemo } from 'react';
import { DealerPriceLevelContext } from '../context/dealer-price-level-context';
import type { CatalogProduct } from '../types/catalog';
import type { DealerUnitPrice, PriceLevel } from '../types/priceLevels';

/**
 * Live price-level rules for the signed-in dealer (catalog + cart).
 * Requires DealerPriceLevelProvider (mounted next to CartProvider).
 */
export function useDealerPriceLevels(): {
  levels: PriceLevel[];
  dealerId: string | null;
  ready: boolean;
  restrictedCategoryIds: ReadonlySet<string>;
  isProductVisible: (
    product: Pick<CatalogProduct, 'categoryId' | 'categoryName'> | null | undefined,
  ) => boolean;
} {
  const ctx = useContext(DealerPriceLevelContext);
  if (!ctx) {
    return {
      levels: [],
      dealerId: null,
      ready: true,
      restrictedCategoryIds: new Set<string>(),
      isProductVisible: () => true,
    };
  }
  return {
    levels: ctx.levels,
    dealerId: ctx.dealerId,
    ready: ctx.ready,
    restrictedCategoryIds: ctx.restrictedCategoryIds,
    isProductVisible: ctx.isProductVisible,
  };
}

export function useDealerUnitPrice(
  product: Pick<CatalogProduct, 'id' | 'rate' | 'categoryId' | 'categoryName'> | null | undefined,
): DealerUnitPrice | null {
  const ctx = useContext(DealerPriceLevelContext);
  return useMemo(() => {
    if (!ctx || !product || !ctx.dealerId) return null;
    return ctx.resolveProductPrice(product);
  }, [ctx, product]);
}
