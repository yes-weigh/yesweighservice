import type { User } from '../types';
import {
  ALL_DEALER_PERMISSIONS,
  DEALER_TIER_DEFAULT_PERMISSIONS,
  DEALER_TIER_LABELS,
  DEFAULT_DEALER_ACCESS,
  type DealerAccessProfile,
  type DealerPermission,
  type DealerTier,
} from '../types/dealer-access';

export function isDealerPortalUser(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'dealer' || user?.role === 'dealer_staff';
}

export function readDealerAccessProfile(user: User | null | undefined): DealerAccessProfile {
  if (!user || !isDealerPortalUser(user)) return DEFAULT_DEALER_ACCESS;
  return {
    tier: user.dealerTier ?? 'standard',
    accessMode: user.dealerAccessMode ?? 'tier',
    permissions: user.dealerPermissions ?? [],
  };
}

export function resolveDealerPermissions(user: User | null | undefined): DealerPermission[] {
  if (!user) return [];
  if (user.role === 'super_admin' || user.role === 'staff') {
    return ALL_DEALER_PERMISSIONS;
  }
  if (!isDealerPortalUser(user)) return [];

  const profile = readDealerAccessProfile(user);
  if (profile.accessMode === 'custom' && profile.permissions.length > 0) {
    const custom = new Set(profile.permissions);
    return ALL_DEALER_PERMISSIONS.filter(permission => custom.has(permission));
  }
  return DEALER_TIER_DEFAULT_PERMISSIONS[profile.tier];
}

export function hasDealerPermission(
  user: User | null | undefined,
  permission: DealerPermission,
): boolean {
  return resolveDealerPermissions(user).includes(permission);
}

export function canViewCatalogStock(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'staff') return true;
  return hasDealerPermission(user, 'catalog.stock_view');
}

export function canViewWarehouseStock(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'staff') return true;
  return hasDealerPermission(user, 'catalog.warehouse_view');
}

export function dealerTierLabel(tier: DealerTier | undefined): string {
  if (!tier) return DEALER_TIER_LABELS.standard;
  return DEALER_TIER_LABELS[tier];
}

export function effectiveDealerPermissionSet(
  tier: DealerTier,
  accessMode: 'tier' | 'custom',
  permissions: DealerPermission[],
): DealerPermission[] {
  if (accessMode === 'custom' && permissions.length > 0) {
    const custom = new Set(permissions);
    return ALL_DEALER_PERMISSIONS.filter(permission => custom.has(permission));
  }
  return DEALER_TIER_DEFAULT_PERMISSIONS[tier];
}
