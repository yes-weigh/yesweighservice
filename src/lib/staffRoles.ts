import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEPARTMENT_DEFAULT_PERMISSIONS,
  type StaffDepartment,
  type StaffPermission,
} from '../types/staff-access';
import {
  SYSTEM_STAFF_ROLE_IDS,
  type StaffRoleDoc,
  type StaffRoleTemplate,
} from '../types/staff-role';

export { SYSTEM_STAFF_ROLE_IDS };

const ROLES_COLLECTION = 'staffRoles';

export function buildSystemStaffRoles(): StaffRoleTemplate[] {
  const now = new Date().toISOString();
  const mk = (
    id: string,
    name: string,
    department: StaffDepartment,
    permissions: StaffPermission[],
    description: string,
  ): StaffRoleTemplate => ({
    id,
    name,
    description,
    department,
    permissions,
    isSystem: true,
    createdAt: now,
  });

  return [
    mk(
      SYSTEM_STAFF_ROLE_IDS.sales,
      'Sales',
      'sales',
      DEPARTMENT_DEFAULT_PERMISSIONS.sales,
      'Dealers, leads, and account relationships',
    ),
    mk(
      SYSTEM_STAFF_ROLE_IDS.service,
      'Service',
      'service',
      DEPARTMENT_DEFAULT_PERMISSIONS.service,
      'Repairs, complaints, and warranty support',
    ),
    mk(
      SYSTEM_STAFF_ROLE_IDS.logistics,
      'Logistics',
      'logistics',
      DEPARTMENT_DEFAULT_PERMISSIONS.logistics,
      'Orders, RMA, and dispatch',
    ),
    mk(
      SYSTEM_STAFF_ROLE_IDS.admin,
      'Admin',
      'admin',
      DEPARTMENT_DEFAULT_PERMISSIONS.admin,
      'Full internal operations access',
    ),
    mk(
      SYSTEM_STAFF_ROLE_IDS.hrManager,
      'HR Manager',
      'admin',
      [
        'hr.view',
        'hr.manage',
        'staff.manage',
        'dealers.view',
        'dealers.edit',
        'tasks.view',
        'catalog.view',
        'invoices.view',
      ],
      'HR directory, staff records, and dealer visibility',
    ),
  ];
}

export function legacyDepartmentToRoleId(department: StaffDepartment | undefined): string {
  switch (department) {
    case 'sales':
      return SYSTEM_STAFF_ROLE_IDS.sales;
    case 'service':
      return SYSTEM_STAFF_ROLE_IDS.service;
    case 'logistics':
      return SYSTEM_STAFF_ROLE_IDS.logistics;
    default:
      return SYSTEM_STAFF_ROLE_IDS.admin;
  }
}

export async function ensureStaffRolesSeeded(): Promise<void> {
  const snap = await getDocs(collection(db, ROLES_COLLECTION));
  if (!snap.empty) return;

  const batch = writeBatch(db);
  for (const role of buildSystemStaffRoles()) {
    const { id, ...data } = role;
    batch.set(doc(db, ROLES_COLLECTION, id), data);
  }
  await batch.commit();
}

export async function fetchStaffRoles(seedIfEmpty = false): Promise<StaffRoleTemplate[]> {
  if (seedIfEmpty) {
    await ensureStaffRolesSeeded();
  }
  const snap = await getDocs(collection(db, ROLES_COLLECTION));
  if (snap.empty) {
    return buildSystemStaffRoles();
  }
  const roles = snap.docs.map(d => ({ id: d.id, ...(d.data() as StaffRoleDoc) }));
  roles.sort((a, b) => {
    if (a.isSystem && !b.isSystem) return -1;
    if (!a.isSystem && b.isSystem) return 1;
    return a.name.localeCompare(b.name);
  });
  return roles;
}

export async function createStaffRole(
  input: Omit<StaffRoleDoc, 'createdAt' | 'updatedAt'> & { createdByUid: string },
): Promise<string> {
  const ref = doc(collection(db, ROLES_COLLECTION));
  const now = new Date().toISOString();
  await setDoc(ref, {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    department: input.department,
    permissions: input.permissions,
    isSystem: false,
    createdAt: now,
    createdByUid: input.createdByUid,
  });
  return ref.id;
}

export async function updateStaffRole(
  roleId: string,
  patch: Partial<Pick<StaffRoleDoc, 'name' | 'description' | 'department' | 'permissions'>>,
): Promise<void> {
  await updateDoc(doc(db, ROLES_COLLECTION, roleId), {
    ...patch,
    name: patch.name?.trim(),
    description: patch.description?.trim() || null,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteStaffRole(roleId: string, isSystem?: boolean): Promise<void> {
  if (isSystem) throw new Error('System roles cannot be deleted.');
  await deleteDoc(doc(db, ROLES_COLLECTION, roleId));
}

export function findStaffRole(
  roles: StaffRoleTemplate[],
  roleId: string | null | undefined,
): StaffRoleTemplate | null {
  if (!roleId) return null;
  return roles.find(r => r.id === roleId) ?? null;
}
