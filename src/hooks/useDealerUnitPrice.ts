import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  emptyPriceLevelsDoc,
  resolveDealerUnitPrice,
  subscribePriceLevels,
} from '../lib/priceLevels';
import type { CatalogProduct } from '../types/catalog';
import type { DealerUnitPrice, PriceLevel } from '../types/priceLevels';

function isDealerPortalRole(role: string | undefined): boolean {
  return role === 'dealer' || role === 'dealer_staff';
}

/**
 * Live price-level rules for the signed-in dealer (catalog + cart).
 * Staff / admin see catalog list rates (no level transform).
 */
export function useDealerPriceLevels(): {
  levels: PriceLevel[];
  dealerId: string | null;
  ready: boolean;
} {
  const { user } = useAuth();
  const dealerId = isDealerPortalRole(user?.role)
    ? (user?.zohoCustomerId?.trim() || user?.dealerId?.trim() || null)
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

  return { levels, dealerId, ready };
}

export function useDealerUnitPrice(
  product: Pick<CatalogProduct, 'rate' | 'categoryId'> | null | undefined,
): DealerUnitPrice | null {
  const { levels, dealerId } = useDealerPriceLevels();
  return useMemo(() => {
    if (!product || !dealerId) return null;
    return resolveDealerUnitPrice(levels, dealerId, product);
  }, [product, levels, dealerId]);
}
