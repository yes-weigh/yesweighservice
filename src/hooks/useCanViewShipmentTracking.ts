import { useAuth } from '../context/AuthContext';
import { canViewShipmentTracking, isDealerPortalUser } from '../lib/dealerAccess';
import { useDealerPriceLevels } from './useDealerUnitPrice';

/** True when the signed-in user may see catalog on-order / ship tracking. */
export function useCanViewShipmentTracking(): boolean {
  const { user } = useAuth();
  const { level, ready } = useDealerPriceLevels();
  if (!user) return false;
  if (isDealerPortalUser(user) && !ready) return false;
  return canViewShipmentTracking(user, level?.name);
}
