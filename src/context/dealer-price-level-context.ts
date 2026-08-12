import { createContext } from 'react';
import type { CatalogProduct } from '../types/catalog';
import type { DealerUnitPrice, PriceLevel } from '../types/priceLevels';

export type DealerPriceLevelContextValue = {
  levels: PriceLevel[];
  /** Zoho customer id used to match priceLevels.dealerIds. */
  dealerId: string | null;
  ready: boolean;
  /** Category ids hidden for this dealer’s price level (empty when none / not a dealer). */
  restrictedCategoryIds: ReadonlySet<string>;
  resolveProductPrice: (
    product: Pick<CatalogProduct, 'id' | 'rate' | 'categoryId' | 'categoryName'> & {
      sku?: string | null;
    } | null | undefined,
  ) => DealerUnitPrice | null;
  isProductVisible: (
    product: Pick<CatalogProduct, 'categoryId' | 'categoryName'> | null | undefined,
  ) => boolean;
};

export const DealerPriceLevelContext = createContext<DealerPriceLevelContextValue | null>(null);
