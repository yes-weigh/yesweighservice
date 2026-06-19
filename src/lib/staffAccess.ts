import type { SupportRequestType } from '../types/dealer-support';
import type { User, Role } from '../types';
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

export function isStaffUser(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'staff';
}

export function isPlatformAdmin(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'super_admin';
}

export function readStaffAccessProfile(user: User | null | undefined): StaffAccessProfile {
  if (!user || user.role !== 'staff') return DEFAULT_STAFF_ACCESS;
  return {
    department: user.staffDepartment ?? 'admin',
    accessMode: user.staffAccessMode ?? 'department',
    permissions: user.staffPermissions ?? [],
    kamId: user.staffKamId ?? null,
    teamId: user.staffTeamId ?? null,
  };
}

export function resolveStaffPermissions(user: User | null | undefined): StaffPermission[] {
  if (!user) return [];
  if (user.role === 'super_admin') return ALL_STAFF_PERMISSIONS;
  if (user.role !== 'staff') return [];

  const profile = readStaffAccessProfile(user);
  if (profile.accessMode === 'custom' && profile.permissions.length > 0) {
    const custom = new Set(profile.permissions);
    return ALL_STAFF_PERMISSIONS.filter(permission => custom.has(permission));
  }
  return DEPARTMENT_DEFAULT_PERMISSIONS[profile.department];
}

export function hasStaffPermission(
  user: User | null | undefined,
  permission: StaffPermission,
): boolean {
  return resolveStaffPermissions(user).includes(permission);
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
  if (user.role === 'super_admin') return true;
  return hasStaffPermission(user, 'support.manage');
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
  | 'ai-assistant'
  | 'notifications'
  | 'training'
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
  'ai-assistant': 'always',
  notifications: 'always',
  training: 'always',
  staff: ['staff.manage'],
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
  department: StaffDepartment,
  accessMode: 'department' | 'custom',
  permissions: StaffPermission[],
): StaffPermission[] {
  if (accessMode === 'custom' && permissions.length > 0) {
    const custom = new Set(permissions);
    return ALL_STAFF_PERMISSIONS.filter(permission => custom.has(permission));
  }
  return DEPARTMENT_DEFAULT_PERMISSIONS[department];
}

export function roleCanAccessStaffAdmin(role: Role): boolean {
  return role === 'super_admin' || role === 'staff';
}
