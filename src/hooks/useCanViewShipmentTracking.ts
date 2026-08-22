import { useAuth } from '../context/AuthContext';
import {
  canViewCatalogStock,
  canViewShipmentTracking,
  isDealerPortalUser,
} from '../lib/dealerAccess';
import { useDealerPriceLevels } from './useDealerUnitPrice';

function useDirectorsPriceLevelReady(): {
  user: ReturnType<typeof useAuth>['user'];
  priceLevelName: string | null;
  ready: boolean;
} {
  const { user } = useAuth();
  const { level, ready } = useDealerPriceLevels();
  const dealerReady = !isDealerPortalUser(user) || ready;
  return {
    user,
    priceLevelName: level?.name ?? null,
    ready: dealerReady,
  };
}

/** True when the signed-in user may see catalog on-order / ship tracking. */
export function useCanViewShipmentTracking(): boolean {
  const { user, priceLevelName, ready } = useDirectorsPriceLevelReady();
  if (!user || !ready) return false;
  return canViewShipmentTracking(user, priceLevelName);
}

/** True when the signed-in user may see audited catalog stock qty. */
export function useCanViewCatalogStock(): boolean {
  const { user, priceLevelName, ready } = useDirectorsPriceLevelReady();
  if (!user || !ready) return false;
  return canViewCatalogStock(user, priceLevelName);
}
