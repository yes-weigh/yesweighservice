import React, { useEffect, useMemo, useState } from 'react';
import {
  emptyPriceLevelsDoc,
  resolveDealerUnitPrice,
  subscribePriceLevels,
} from '../lib/priceLevels';
import type { CatalogProduct } from '../types/catalog';
import type { DealerUnitPrice, PriceLevel } from '../types/priceLevels';
import { useAuth } from './AuthContext';
import { DealerPriceLevelContext } from './dealer-price-level-context';

function isDealerPortalRole(role: string | undefined): boolean {
  return role === 'dealer' || role === 'dealer_staff';
}

/**
 * One Firestore subscription for price levels for the signed-in dealer.
 * Catalog cards / cart read from this instead of each opening their own listener.
 */
export const DealerPriceLevelProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const dealerId = isDealerPortalRole(user?.role)
    ? (user?.zohoCustomerId?.trim() || null)
    : null;
  const [levels, setLevels] = useState<PriceLevel[]>([]);
  const [ready, setReady] = useState(!dealerId);

  useEffect(() => {
    if (!dealerId) {
      setLevels([]);
      setReady(true);
      return;
    }
    setReady(false);
    return subscribePriceLevels(
      docData => {
        setLevels(docData.levels);
        setReady(true);
      },
      () => {
        setLevels(emptyPriceLevelsDoc().levels);
        setReady(true);
      },
    );
  }, [dealerId]);

  const value = useMemo(() => ({
    levels,
    dealerId,
    ready,
    resolveProductPrice: (
      product: Pick<CatalogProduct, 'id' | 'rate' | 'categoryId'> | null | undefined,
    ): DealerUnitPrice | null => {
      if (!product || !dealerId) return null;
      return resolveDealerUnitPrice(levels, dealerId, product);
    },
  }), [levels, dealerId, ready]);

  return (
    <DealerPriceLevelContext.Provider value={value}>
      {children}
    </DealerPriceLevelContext.Provider>
  );
};
