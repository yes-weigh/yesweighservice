import type { SupportRequestType } from '../types/dealer-support';
import type { User, Role } from '../types';
import { normalizeSuperAdminAccess } from '../types';
import {
  ALL_STAFF_PERMISSIONS,
  DEPARTMENT_DEFAULT_PERMISSIONS,
  DEPARTMENT_SUPPORT_TYPES,
  DEFAULT_STAFF_ACCESS,
  STAFF_DEPARTMENT_LABELS,
  type StaffAccessProfile,
  type StaffDepartment,
  type StaffPermission,
} from '../types/staff-access';

/** Staff permissions that imply mutation / sync (denied for view-only super admins). */
const SUPER_ADMIN_WRITE_PERMISSIONS = new Set<StaffPermission>([
  'dealers.edit',
  'dealers.sync',
  'leads.manage',
  'support.manage',
  'support.service',
  'support.return',
  'support.complaint',
  'orders.manage',
  'catalog.manage',
  'catalog.sync',
  'staff.manage',
  'hr.manage',
  'verification.manage',
]);

export function isStaffUser(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'staff';
}

export function isPlatformAdmin(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'super_admin';
}

/** Super admin with full write access (missing tier → full). */
export function isFullSuperAdmin(
  user: Pick<User, 'role' | 'superAdminAccess'> | null | undefined,
): boolean {
  return user?.role === 'super_admin'
    && normalizeSuperAdminAccess(user.superAdminAccess) === 'full';
}

/** Alias — use for any mutate/sync UI that currently checks super_admin. */
export function canSuperAdminWrite(
  user: Pick<User, 'role' | 'superAdminAccess'> | null | undefined,
): boolean {
  return isFullSuperAdmin(user);
}

export function isViewOnlySuperAdmin(
  user: Pick<User, 'role' | 'superAdminAccess'> | null | undefined,
): boolean {
  return user?.role === 'super_admin'
    && normalizeSuperAdminAccess(user.superAdminAccess) === 'view_only';
}

export function readStaffAccessProfile(user: User | null | undefined): StaffAccessProfile {
  if (!user || user.role !== 'staff') return DEFAULT_STAFF_ACCESS;
  return {
    department: user.staffDepartment ?? 'admin',
    accessMode: user.staffAccessMode ?? 'role',
    roleId: user.staffRoleId ?? null,
    permissions: user.staffPermissions ?? [],
    kamId: user.staffKamId ?? null,
    teamId: user.staffTeamId ?? null,
  };
}

export function resolveStaffPermissions(user: User | null | undefined): StaffPermission[] {
  if (!user) return [];
  if (user.role === 'super_admin') {
    if (isFullSuperAdmin(user)) return ALL_STAFF_PERMISSIONS;
    // View-only: keep view / non-mutating permissions for nav + screens.
    return ALL_STAFF_PERMISSIONS.filter(p => !SUPER_ADMIN_WRITE_PERMISSIONS.has(p));
  }
  if (user.role !== 'staff') return [];

  const profile = readStaffAccessProfile(user);
  if (
    (profile.accessMode === 'custom' || profile.accessMode === 'role')
    && profile.permissions.length > 0
  ) {
    const set = new Set(profile.permissions);
    return ALL_STAFF_PERMISSIONS.filter(permission => set.has(permission));
  }
  return DEPARTMENT_DEFAULT_PERMISSIONS[profile.department];
}

export function hasStaffPermission(
  user: User | null | undefined,
  permission: StaffPermission,
): boolean {
  return resolveStaffPermissions(user).includes(permission);
}

export function canViewHr(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (user.role !== 'staff') return false;
  return hasStaffPermission(user, 'hr.view') || hasStaffPermission(user, 'hr.manage');
}

export function canManageHr(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return canSuperAdminWrite(user);
  if (user.role !== 'staff') return false;
  return hasStaffPermission(user, 'hr.manage');
}

export function canManageWarehouseUsers(user: User | null | undefined): boolean {
  return canManageHr(user);
}

export function canManageStaffRolesInHr(user: User | null | undefined): boolean {
  return canSuperAdminWrite(user);
}

/** Open Super Admins page (view-only can browse; writes gated in UI). */
export function canManageSuperAdminsInHr(user: User | null | undefined): boolean {
  return user?.role === 'super_admin';
}

/** Salary calculation role gate (super-admin). Tab also requires localhost / isLocalhostDev(). */
export function canViewHrSalary(user: User | null | undefined): boolean {
  return user?.role === 'super_admin';
}

/** Persist salary / share mutations (full super admin only). */
export function canEditHrSalary(user: User | null | undefined): boolean {
  return canSuperAdminWrite(user);
}

export function canViewDealersInHr(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (user.role !== 'staff') return false;
  return hasStaffPermission(user, 'dealers.view') || hasStaffPermission(user, 'dealers.edit');
}

export function hasAnyStaffPermission(
  user: User | null | undefined,
  permissions: StaffPermission[],
): boolean {
  const resolved = resolveStaffPermissions(user);
  return permissions.some(permission => resolved.includes(permission));
}

/** Staff or super admin with access to internal ops features. */
export function isInternalOpsUser(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return user.role === 'staff';
}

export function canManageSupportOps(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return canSuperAdminWrite(user);
  return hasStaffPermission(user, 'support.manage');
}

export function canCreateSupportOnBehalf(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return canSuperAdminWrite(user);
  if (user.role !== 'staff') return false;
  return hasAnyStaffPermission(user, [
    'support.view',
    'support.manage',
    'support.service',
    'support.return',
    'support.complaint',
  ]);
}

export function allowedSupportTypesForUser(user: User | null | undefined): SupportRequestType[] | 'all' {
  if (!user) return [];
  if (user.role === 'super_admin') return 'all';
  if (user.role !== 'staff') return [];

  const profile = readStaffAccessProfile(user);
  const deptTypes = DEPARTMENT_SUPPORT_TYPES[profile.department];
  if (deptTypes === 'all') return 'all';

  const allowed = new Set<SupportRequestType>(deptTypes);
  if (hasStaffPermission(user, 'support.service')) allowed.add('service');
  if (hasStaffPermission(user, 'support.return')) allowed.add('return');
  if (hasStaffPermission(user, 'support.complaint')) allowed.add('complaint');
  if (
    hasStaffPermission(user, 'support.complaint')
    || hasStaffPermission(user, 'support.service')
    || hasStaffPermission(user, 'support.manage')
  ) {
    allowed.add('chat');
  }

  if (!hasStaffPermission(user, 'support.view') && !hasStaffPermission(user, 'support.manage')) {
    return [];
  }

  return [...allowed];
}

export function filterSupportRequestsForUser<T extends { type: SupportRequestType }>(
  user: User | null | undefined,
  requests: T[],
): T[] {
  const allowed = allowedSupportTypesForUser(user);
  if (allowed === 'all') return requests;
  if (allowed.length === 0) return [];
  const set = new Set(allowed);
  return requests.filter(request => set.has(request.type));
}

export type StaffNavFeature =
  | 'dashboard'
  | 'tasks'
  | 'dealers'
  | 'leads'
  | 'catalog'
  | 'orders'
  | 'warranty-support'
  | 'verification'
  | 'advertisements'
  | 'invoices'
  | 'sales-orders'
  | 'purchase-orders'
  | 'logistics'
  | 'loyalty'
  | 'ai-assistant'
  | 'notifications'
  | 'training'
  | 'reports'
  | 'staff';

const NAV_FEATURE_PERMISSIONS: Record<StaffNavFeature, StaffPermission[] | 'always'> = {
  dashboard: 'always',
  tasks: ['tasks.view'],
  dealers: ['dealers.view'],
  leads: ['leads.view'],
  catalog: ['catalog.view'],
  orders: ['orders.view'],
  'warranty-support': ['support.view', 'support.manage'],
  verification: ['verification.view'],
  advertisements: ['advertisements.view'],
  invoices: ['invoices.view'],
  'sales-orders': ['orders.view', 'orders.manage', 'invoices.view'],
  // Purchase orders are super-admin only — staff must not see this nav/feature.
  'purchase-orders': [],
  logistics: ['logistics.view'],
  loyalty: ['loyalty.view'],
  'ai-assistant': 'always',
  notifications: 'always',
  training: 'always',
  reports: 'always',
  staff: ['staff.manage', 'hr.view', 'hr.manage'],
};

export function canAccessNavFeature(user: User | null | undefined, feature: StaffNavFeature): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return feature !== 'staff' || true;
  if (user.role === 'dealer' || user.role === 'dealer_staff') return true;
  if (user.role !== 'staff') return false;

  const rule = NAV_FEATURE_PERMISSIONS[feature];
  if (rule === 'always') return true;
  return hasAnyStaffPermission(user, rule);
}

export function staffDepartmentLabel(department: StaffDepartment | undefined): string {
  if (!department) return STAFF_DEPARTMENT_LABELS.admin;
  return STAFF_DEPARTMENT_LABELS[department];
}

export function effectivePermissionSet(
  accessMode: 'role' | 'custom' | 'department',
  department: StaffDepartment,
  permissions: StaffPermission[],
): StaffPermission[] {
  if ((accessMode === 'custom' || accessMode === 'role') && permissions.length > 0) {
    const custom = new Set(permissions);
    return ALL_STAFF_PERMISSIONS.filter(permission => custom.has(permission));
  }
  return DEPARTMENT_DEFAULT_PERMISSIONS[department];
}

export function roleCanAccessStaffAdmin(role: Role): boolean {
  return role === 'super_admin' || role === 'staff';
}
