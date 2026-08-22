import type { User } from '../types';
import { isDirectorsPriceLevelName } from './priceLevels';
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

export type DealerStaffTeam = 'sales' | 'service';

export function dealerStaffTeams(
  data: {
    staffDepartment?: string | null;
    dealerTeams?: Array<'sales' | 'service'> | null;
  } | null | undefined,
): DealerStaffTeam[] {
  const stored = Array.isArray(data?.dealerTeams)
    ? data.dealerTeams.filter((team): team is DealerStaffTeam => team === 'sales' || team === 'service')
    : [];
  if (stored.length) return [...new Set(stored)];
  if (data?.staffDepartment === 'service') return ['service'];
  if (data?.staffDepartment === 'sales') return ['sales'];
  return ['sales'];
}

/**
 * Sales vs Service on dealer_staff. Missing department is treated as Sales
 * (more restricted). Dealer owners and non-portal roles return null.
 */
export function dealerStaffTeam(
  user: Pick<User, 'role' | 'staffDepartment' | 'dealerTeams'> | null | undefined,
): DealerStaffTeam | null {
  if (user?.role !== 'dealer_staff') return null;
  return dealerStaffTeams(user).includes('service') ? 'service' : 'sales';
}

/** Teams for dealer_staff only; null for owner and every other role. */
export function dealerPortalStaffTeams(
  user: Pick<User, 'role' | 'staffDepartment' | 'dealerTeams'> | null | undefined,
): DealerStaffTeam[] | null {
  if (user?.role !== 'dealer_staff') return null;
  return dealerStaffTeams(user);
}

/** Hide ₹ / invoice commercials. Sales dealer_staff only. */
export function hideDealerStaffCommercials(
  user: Pick<User, 'role' | 'staffDepartment' | 'dealerTeams'> | null | undefined,
): boolean {
  return dealerStaffTeam(user) === 'sales';
}

/** Dealer owner places in YesOne. Staff must submit for dealer approval. */
export function canPlaceDealerZohoOrder(
  user: Pick<User, 'role'> | null | undefined,
): boolean {
  return user?.role === 'dealer';
}

/** Sales / service staff only see SOs they submitted or created. Owner sees all. */
export function dealerStaffOwnsSalesOrder(
  user: Pick<User, 'uid' | 'role'> | null | undefined,
  order: {
    yesOneDealerStaffUid?: string | null;
    yesOneCreatedByUid?: string | null;
  } | null | undefined,
): boolean {
  if (!user || user.role !== 'dealer_staff') return true;
  const uid = user.uid;
  return String(order?.yesOneDealerStaffUid ?? '').trim() === uid
    || String(order?.yesOneCreatedByUid ?? '').trim() === uid;
}

/** Dealer unit (charge) price. Sales never; Service only on spares; owner always. */
export function canSeeDealerUnitPrice(
  user: Pick<User, 'role' | 'staffDepartment' | 'dealerTeams'> | null | undefined,
  isSpare = false,
): boolean {
  const team = dealerStaffTeam(user);
  if (!team) return true;
  return team === 'service' && isSpare;
}

/** Create tickets and reply. Dealer owner + Service staff; Sales is view-only. */
export function canMutateDealerSupport(
  user: Pick<User, 'role' | 'staffDepartment' | 'dealerTeams'> | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === 'dealer') return true;
  return dealerStaffTeam(user) === 'service';
}

/** Billing / shipping on the dealer profile. Owner only — staff is view-only. */
export function canEditDealerProfileAddresses(
  user: Pick<User, 'role'> | null | undefined,
): boolean {
  return user?.role === 'dealer';
}

/** Firebase uid of the dealer account (parent for dealer_staff). */
export function resolveDealerAccountUid(
  user: Pick<User, 'uid' | 'role' | 'dealerId'> | null | undefined,
): string | null {
  if (!user) return null;
  if (user.role === 'dealer') return user.uid;
  if (user.role === 'dealer_staff') {
    const parent = user.dealerId?.trim();
    return parent || null;
  }
  return null;
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

/**
 * Audited catalog stock qty (grid pill + last-audit footer).
 * Staff / super_admin always. Dealer owner when price level is Directors.
 * Sales / Service dealer_staff never.
 */
export function canViewCatalogStock(
  user: User | null | undefined,
  priceLevelName?: string | null,
): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'staff') return true;
  if (dealerStaffTeam(user)) return false;
  if (isDealerPortalUser(user)) {
    return isDirectorsPriceLevelName(priceLevelName);
  }
  return false;
}

export function canViewWarehouseStock(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'staff') return true;
  return hasDealerPermission(user, 'catalog.warehouse_view');
}

/**
 * Catalog ship / live-tracking chip.
 * All internal users (staff, admin, warehouse, media).
 * Dealer owner when price level is Directors.
 * Sales / Service dealer_staff never.
 */
export function canViewShipmentTracking(
  user: User | null | undefined,
  priceLevelName?: string | null,
): boolean {
  if (!user) return false;
  if (dealerStaffTeam(user)) return false;
  if (isDealerPortalUser(user)) {
    return isDirectorsPriceLevelName(priceLevelName);
  }
  return true;
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
