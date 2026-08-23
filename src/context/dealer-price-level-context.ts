import { createContext } from 'react';
import type { CatalogProduct } from '../types/catalog';
import type { DealerUnitPrice, PriceLevel } from '../types/priceLevels';

export type DealerPriceLevelContextValue = {
  levels: PriceLevel[];
  /** Matched price level for this dealer (Directors, Dealers, …). */
  level: PriceLevel | null;
  /** Zoho customer id used to match priceLevels.dealerIds. */
  dealerId: string | null;
  ready: boolean;
  /** Category ids hidden for this dealer’s price level (empty when none / not a dealer). */
  restrictedCategoryIds: ReadonlySet<string>;
  /** Billing state from the linked Zoho customer (dealer portal only). */
  billingState: string | null;
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
