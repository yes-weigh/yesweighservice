export type Role = 'super_admin' | 'staff' | 'media' | 'dealer' | 'dealer_staff' | 'warehouse';

/** Super admin write tier. Missing / unknown → full (legacy accounts). */
export type SuperAdminAccess = 'view_only' | 'full';

export const SUPER_ADMIN_ACCESS_LABELS: Record<SuperAdminAccess, string> = {
  full: 'Full',
  view_only: 'View only',
};

export function normalizeSuperAdminAccess(value: unknown): SuperAdminAccess {
  return value === 'view_only' ? 'view_only' : 'full';
}

export type { StaffDepartment, StaffPermission, StaffAccessProfile, StaffAccessMode } from './types/staff-access';
export {
  STAFF_DEPARTMENTS,
  STAFF_DEPARTMENT_LABELS,
  STAFF_PERMISSION_LABELS,
  STAFF_PERMISSION_GROUPS,
  DEPARTMENT_DEFAULT_PERMISSIONS,
} from './types/staff-access';
export {
  HR_DOCUMENT_TYPES,
  HR_DOCUMENT_LABELS,
  BLOOD_GROUPS,
} from './types/staff-hr';
export type { StaffHrProfile, HrDocuments, HrDocumentType } from './types/staff-hr';

export type { DealerTier, DealerPermission, DealerAccessProfile, DealerAccessMode } from './types/dealer-access';
export {
  DEALER_TIERS,
  DEALER_TIER_LABELS,
  DEALER_PERMISSION_LABELS,
  DEALER_PERMISSION_GROUPS,
  DEALER_TIER_DEFAULT_PERMISSIONS,
} from './types/dealer-access';

export type LoginIdType = 'aadhar' | 'phone' | 'email' | 'username';

export const ROLES: Role[] = ['super_admin', 'staff', 'media', 'dealer', 'dealer_staff', 'warehouse'];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  staff: 'Staff',
  media: 'Media',
  dealer: 'Dealer',
  dealer_staff: 'Dealer Staff',
  warehouse: 'Warehouse',
};

/** Lower index = higher authority */
export const ROLE_ORDER: Role[] = ['super_admin', 'staff', 'media', 'warehouse', 'dealer', 'dealer_staff'];

export interface User {
  uid: string;
  loginId: string;
  loginIdType: LoginIdType;
  displayName: string;
  role: Role;
  /** Super admin only. Missing → full. */
  superAdminAccess?: SuperAdminAccess;
  email?: string;
  dealerId?: string;
  zohoCustomerId?: string;
  phone?: string;
  aadhar?: string;
  active: boolean;
  /** YesOne staff only */
  staffDepartment?: import('./types/staff-access').StaffDepartment;
  staffRoleId?: string | null;
  staffAccessMode?: import('./types/staff-access').StaffAccessMode;
  /** Full permission set when staffAccessMode is custom; ignored otherwise */
  staffPermissions?: import('./types/staff-access').StaffPermission[];
  staffTeamId?: string | null;
  /**
   * Zoho Inventory salesperson ids linked to this staff (KAM on SO/invoice).
   * One staff may map to multiple Zoho salespersons; each Zoho id maps to at most one staff.
   */
  zohoSalespersonIds?: string[] | null;
  zohoSalespersonLinks?: Array<{ id: string; name: string | null }> | null;
  /** @deprecated Prefer zohoSalespersonIds — kept as first linked id for compatibility */
  zohoSalespersonId?: string | null;
  /** @deprecated Prefer zohoSalespersonLinks */
  zohoSalespersonName?: string | null;
  /** Dealer portal only */
  dealerTier?: import('./types/dealer-access').DealerTier;
  dealerAccessMode?: import('./types/dealer-access').DealerAccessMode;
  dealerPermissions?: import('./types/dealer-access').DealerPermission[];
  /**
   * Best-effort flag mirrored from appSettings/spareIncharge.
   * Roster in appSettings is the source of truth for HR assignment.
   */
  spareIncharge?: boolean;
  /** Company staff HR profile */
  hrPhotoUrl?: string | null;
  hrPhotoStoragePath?: string | null;
  hrResidentialAddress?: string | null;
  hrPostalCode?: string | null;
  hrBloodGroup?: string | null;
  hrPoliceStation?: string | null;
  hrEmergencyContactName?: string | null;
  hrEmergencyContactRelationship?: string | null;
  hrEmergencyContactPhone?: string | null;
  hrJoinDate?: string | null;
  hrEmployeeId?: string | null;
  hrDesignation?: string | null;
  hrDocuments?: import('./types/staff-hr').HrDocuments;
}

export interface FirestoreUserDoc {
  loginId?: string;
  loginIdType?: LoginIdType;
  displayName: string;
  role: Role | 'admin' | 'director' | 'director_staff';
  /** Super admin only. Missing → full. */
  superAdminAccess?: SuperAdminAccess;
  email?: string;
  dealerId?: string;
  zohoCustomerId?: string;
  /** @deprecated use dealerId */
  directorId?: string;
  phone?: string;
  /** Set when loginIdType is aadhar */
  aadhar?: string;
  active: boolean;
  staffDepartment?: import('./types/staff-access').StaffDepartment;
  staffRoleId?: string | null;
  staffAccessMode?: import('./types/staff-access').StaffAccessMode;
  staffPermissions?: import('./types/staff-access').StaffPermission[];
  staffTeamId?: string | null;
  zohoSalespersonIds?: string[] | null;
  zohoSalespersonLinks?: Array<{ id: string; name: string | null }> | null;
  /** @deprecated Prefer zohoSalespersonIds */
  zohoSalespersonId?: string | null;
  /** @deprecated Prefer zohoSalespersonLinks */
  zohoSalespersonName?: string | null;
  dealerTier?: import('./types/dealer-access').DealerTier;
  dealerAccessMode?: import('./types/dealer-access').DealerAccessMode;
  dealerPermissions?: import('./types/dealer-access').DealerPermission[];
  spareIncharge?: boolean;
  hrPhotoUrl?: string | null;
  hrPhotoStoragePath?: string | null;
  hrResidentialAddress?: string | null;
  hrPostalCode?: string | null;
  hrBloodGroup?: string | null;
  hrPoliceStation?: string | null;
  hrEmergencyContactName?: string | null;
  hrEmergencyContactRelationship?: string | null;
  hrEmergencyContactPhone?: string | null;
  hrJoinDate?: string | null;
  hrEmployeeId?: string | null;
  hrDesignation?: string | null;
  hrDocuments?: import('./types/staff-hr').HrDocuments;
  /** Staff reporting manager — typically a super_admin uid when created from HR Super Admins. */
  managerUid?: string | null;
  createdAt: string;
  createdByUid?: string;
  updatedAt?: string;
  /** Admin password reset helper — not used for login */
  clearTextPassword?: string;
}

export interface UserRecord extends Omit<FirestoreUserDoc, 'role'> {
  uid: string;
  role: Role;
}

export function normalizeRole(role: string): Role | null {
  if (role === 'admin') return 'super_admin';
  if (role === 'director') return 'dealer';
  if (role === 'director_staff') return 'dealer_staff';
  return ROLES.includes(role as Role) ? (role as Role) : null;
}

export function readDealerId(data: FirestoreUserDoc): string | undefined {
  return data.dealerId ?? data.directorId;
}

export function homePathForRole(role: Role): string {
  switch (role) {
    case 'super_admin':
      return '/super-admin';
    case 'staff':
      return '/staff';
    case 'media':
      return '/media';
    case 'dealer':
      return '/dealer';
    case 'dealer_staff':
      return '/dealer-staff';
    case 'warehouse':
      return '/warehouse';
  }
}

/** First screen after login (dealers land on products — no dashboard). */
export function landingPathForRole(role: Role): string {
  if (role === 'dealer') return '/dealer/products';
  if (role === 'dealer_staff') return '/dealer-staff/products';
  return homePathForRole(role);
}

/** Roles this user may create / manage in the user admin screens */
export function manageableRoles(actor: Role): Role[] {
  switch (actor) {
    case 'super_admin':
      return ['super_admin', 'staff', 'media', 'dealer', 'dealer_staff', 'warehouse'];
    case 'staff':
      return ['dealer', 'dealer_staff'];
    case 'dealer':
      return ['dealer_staff'];
    default:
      return [];
  }
}

export function canManageRole(actor: Role, target: Role): boolean {
  return manageableRoles(actor).includes(target);
}

export function isOpsRole(role: Role): boolean {
  return role === 'super_admin' || role === 'staff';
}

export function isMediaRole(role: Role | undefined): boolean {
  return role === 'media';
}

/** Can upload/edit/delete Firebase-only product media gallery. */
export function canWriteCatalogMedia(role: Role | undefined): boolean {
  return role === 'media' || role === 'super_admin';
}

/**
 * Media writers, or full super admins (not view-only).
 * Prefer this over {@link canWriteCatalogMedia} when a User is available.
 */
export function canWriteCatalogMediaForUser(
  user: Pick<User, 'role' | 'superAdminAccess'> | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === 'media') return true;
  return user.role === 'super_admin' && normalizeSuperAdminAccess(user.superAdminAccess) === 'full';
}

/** Can edit the primary Zoho-linked product image. */
export function canEditCatalogProductImage(role: Role | undefined): boolean {
  return role === 'super_admin' || role === 'staff' || role === 'media';
}

export function canEditCatalogProductImageForUser(
  user: Pick<User, 'role' | 'superAdminAccess'> | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === 'staff' || user.role === 'media') return true;
  return user.role === 'super_admin' && normalizeSuperAdminAccess(user.superAdminAccess) === 'full';
}

export function canUseCart(role: Role | undefined): boolean {
  return role === 'dealer' || role === 'dealer_staff';
}
