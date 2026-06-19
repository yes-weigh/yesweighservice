export type Role = 'super_admin' | 'staff' | 'dealer' | 'dealer_staff';

export type { StaffDepartment, StaffPermission, StaffAccessProfile, StaffAccessMode } from './types/staff-access';
export {
  STAFF_DEPARTMENTS,
  STAFF_DEPARTMENT_LABELS,
  STAFF_PERMISSION_LABELS,
  STAFF_PERMISSION_GROUPS,
  DEPARTMENT_DEFAULT_PERMISSIONS,
} from './types/staff-access';

export type { DealerTier, DealerPermission, DealerAccessProfile, DealerAccessMode } from './types/dealer-access';
export {
  DEALER_TIERS,
  DEALER_TIER_LABELS,
  DEALER_PERMISSION_LABELS,
  DEALER_PERMISSION_GROUPS,
  DEALER_TIER_DEFAULT_PERMISSIONS,
} from './types/dealer-access';

export type LoginIdType = 'aadhar' | 'phone' | 'email';

export const ROLES: Role[] = ['super_admin', 'staff', 'dealer', 'dealer_staff'];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  staff: 'Staff',
  dealer: 'Dealer',
  dealer_staff: 'Dealer Staff',
};

/** Lower index = higher authority */
export const ROLE_ORDER: Role[] = ['super_admin', 'staff', 'dealer', 'dealer_staff'];

export interface User {
  uid: string;
  loginId: string;
  loginIdType: LoginIdType;
  displayName: string;
  role: Role;
  email?: string;
  dealerId?: string;
  zohoCustomerId?: string;
  phone?: string;
  aadhar?: string;
  active: boolean;
  /** YesWeigh staff only */
  staffDepartment?: import('./types/staff-access').StaffDepartment;
  staffAccessMode?: import('./types/staff-access').StaffAccessMode;
  /** Full permission set when staffAccessMode is custom; ignored otherwise */
  staffPermissions?: import('./types/staff-access').StaffPermission[];
  /** Links sales staff to KAM record for dealer scoping */
  staffKamId?: string | null;
  staffTeamId?: string | null;
  /** Dealer portal only */
  dealerTier?: import('./types/dealer-access').DealerTier;
  dealerAccessMode?: import('./types/dealer-access').DealerAccessMode;
  dealerPermissions?: import('./types/dealer-access').DealerPermission[];
}

export interface FirestoreUserDoc {
  loginId?: string;
  loginIdType?: LoginIdType;
  displayName: string;
  role: Role | 'admin' | 'director' | 'director_staff';
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
  staffAccessMode?: import('./types/staff-access').StaffAccessMode;
  staffPermissions?: import('./types/staff-access').StaffPermission[];
  staffKamId?: string | null;
  staffTeamId?: string | null;
  dealerTier?: import('./types/dealer-access').DealerTier;
  dealerAccessMode?: import('./types/dealer-access').DealerAccessMode;
  dealerPermissions?: import('./types/dealer-access').DealerPermission[];
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
    case 'dealer':
      return '/dealer';
    case 'dealer_staff':
      return '/dealer-staff';
  }
}

/** Roles this user may create / manage in the user admin screens */
export function manageableRoles(actor: Role): Role[] {
  switch (actor) {
    case 'super_admin':
      return ['staff', 'dealer', 'dealer_staff'];
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

export function canUseCart(role: Role | undefined): boolean {
  return role === 'dealer' || role === 'dealer_staff';
}
