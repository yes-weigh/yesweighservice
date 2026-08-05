import { createContext } from 'react';
import type { CatalogProduct } from '../types/catalog';
import type { DealerUnitPrice, PriceLevel } from '../types/priceLevels';

export type DealerPriceLevelContextValue = {
  levels: PriceLevel[];
  /** Zoho customer id used to match priceLevels.dealerIds. */
  dealerId: string | null;
  ready: boolean;
  resolveProductPrice: (
    product: Pick<CatalogProduct, 'id' | 'rate' | 'categoryId' | 'categoryName'> | null | undefined,
  ) => DealerUnitPrice | null;
};

export const DealerPriceLevelContext = createContext<DealerPriceLevelContextValue | null>(null);
