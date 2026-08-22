import { signOut, type UserCredential } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  deleteField,
  type Firestore,
} from 'firebase/firestore';
import { secondaryAuth, app } from '../firebase';
import {
  assertLoginIdAvailable,
  createAuthUserForLoginId,
  parseLoginId,
} from './loginAuth';
import { authErrorMessage } from './authErrors';
import { reserveLoginIndex } from './loginIndex';
import { contactFieldsForLogin } from './profileLogin';
import type { FirestoreUserDoc, Role, SuperAdminAccess } from '../types';
import { roleSupportsZohoSalespersonLinks } from './zohoSalespersonStaff';
import { normalizeRole, normalizeSuperAdminAccess } from '../types';
import type { StaffDepartment, StaffPermission } from '../types/staff-access';
import type { DealerTier, DealerPermission, DealerAccessMode } from '../types/dealer-access';

function omitUndefined<T extends Record<string, unknown>>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export async function createAuthUser(
  loginId: string,
  password: string,
): Promise<UserCredential> {
  const parsed = parseLoginId(loginId);
  if (!parsed) throw new Error('Invalid login ID.');
  return createAuthUserForLoginId(parsed, password);
}

export async function rollbackCreatedAuthUser(): Promise<void> {
  await signOut(secondaryAuth);
}

export type UpdateUserProfilePatch = Partial<
  Pick<
    FirestoreUserDoc,
    | 'displayName'
    | 'phone'
    | 'email'
    | 'active'
    | 'dealerId'
    | 'superAdminAccess'
    | 'staffDepartment'
    | 'dealerTeams'
    | 'staffRoleId'
    | 'staffAccessMode'
    | 'staffPermissions'
    | 'staffTeamId'
    | 'zohoSalespersonIds'
    | 'zohoSalespersonLinks'
    | 'zohoSalespersonId'
    | 'zohoSalespersonName'
    | 'dealerTier'
    | 'dealerAccessMode'
    | 'dealerPermissions'
    | 'hrPhotoUrl'
    | 'hrPhotoStoragePath'
    | 'hrResidentialAddress'
    | 'hrPostalCode'
    | 'hrBloodGroup'
    | 'hrDateOfBirth'
    | 'hrPoliceStation'
    | 'hrEmergencyContactName'
    | 'hrEmergencyContactRelationship'
    | 'hrEmergencyContactPhone'
    | 'hrJoinDate'
    | 'hrEmployeeId'
    | 'hrDesignation'
    | 'hrDocuments'
    | 'managerUid'
  >
>;

export type CreateStaffHrInput = {
  hrPhotoUrl?: string | null;
  hrPhotoStoragePath?: string | null;
  hrResidentialAddress?: string | null;
  hrPostalCode?: string | null;
  hrBloodGroup?: string | null;
  hrDateOfBirth?: string | null;
  hrPoliceStation?: string | null;
  hrEmergencyContactName?: string | null;
  hrEmergencyContactRelationship?: string | null;
  hrEmergencyContactPhone?: string | null;
  hrJoinDate?: string | null;
  hrEmployeeId?: string | null;
  hrDesignation?: string | null;
  hrDocuments?: FirestoreUserDoc['hrDocuments'];
};

export type CreateUserInput = {
  loginId: string;
  password: string;
  displayName: string;
  role: Role;
  phone?: string;
  email?: string;
  dealerId?: string;
  zohoCustomerId?: string;
  /** Super admin only; defaults to full. */
  superAdminAccess?: SuperAdminAccess;
  staffDepartment?: StaffDepartment;
  dealerTeams?: Array<'sales' | 'service'> | null;
  staffRoleId?: string | null;
  staffAccessMode?: 'role' | 'department' | 'custom';
  staffPermissions?: StaffPermission[];
  staffTeamId?: string | null;
  zohoSalespersonIds?: string[] | null;
  zohoSalespersonLinks?: Array<{ id: string; name: string | null }> | null;
  zohoSalespersonId?: string | null;
  zohoSalespersonName?: string | null;
  /** Optional reporting manager (usually a super_admin). */
  managerUid?: string | null;
  dealerTier?: DealerTier;
  dealerAccessMode?: DealerAccessMode;
  dealerPermissions?: DealerPermission[];
  createdByUid: string;
  hr?: CreateStaffHrInput;
};

export async function createUserProfile(
  db: Firestore,
  uid: string,
  input: CreateUserInput,
): Promise<void> {
  const parsed = parseLoginId(input.loginId);
  if (!parsed) throw new Error('Invalid login ID.');
  if (input.role === 'dealer_staff' && !input.dealerId?.trim()) {
    throw new Error('Dealer staff must be linked to a dealer.');
  }

  const contacts = contactFieldsForLogin(parsed);
  const contactPhone = contacts.phone ?? input.phone?.trim();
  const contactEmail = contacts.email ?? input.email?.trim().toLowerCase();

  const docData = omitUndefined({
    loginId: parsed.value,
    loginIdType: parsed.type,
    displayName: input.displayName.trim(),
    role: input.role,
    aadhar: contacts.aadhar,
    phone: contactPhone || undefined,
    email: contactEmail || undefined,
    superAdminAccess: input.role === 'super_admin'
      ? normalizeSuperAdminAccess(input.superAdminAccess)
      : undefined,
    dealerId: input.role === 'dealer_staff' ? input.dealerId?.trim() : undefined,
    zohoCustomerId: input.zohoCustomerId?.trim() || undefined,
    staffDepartment: input.role === 'staff' || input.role === 'dealer_staff'
      ? input.staffDepartment
      : undefined,
    dealerTeams: input.role === 'dealer_staff' ? input.dealerTeams ?? null : undefined,
    staffRoleId: input.role === 'staff' ? input.staffRoleId ?? null : undefined,
    staffAccessMode: input.role === 'staff' ? input.staffAccessMode ?? 'role' : undefined,
    staffPermissions: input.role === 'staff' ? input.staffPermissions ?? [] : undefined,
    staffTeamId: input.role === 'staff' ? input.staffTeamId ?? null : undefined,
    zohoSalespersonIds: roleSupportsZohoSalespersonLinks(input.role)
      ? input.zohoSalespersonIds ?? []
      : undefined,
    zohoSalespersonLinks: roleSupportsZohoSalespersonLinks(input.role)
      ? input.zohoSalespersonLinks ?? []
      : undefined,
    zohoSalespersonId: roleSupportsZohoSalespersonLinks(input.role)
      ? input.zohoSalespersonId ?? null
      : undefined,
    zohoSalespersonName: roleSupportsZohoSalespersonLinks(input.role)
      ? input.zohoSalespersonName ?? null
      : undefined,
    managerUid: input.role === 'staff' && input.managerUid?.trim()
      ? input.managerUid.trim()
      : undefined,
    dealerTier: input.role === 'dealer' || input.role === 'dealer_staff' ? input.dealerTier ?? 'standard' : undefined,
    dealerAccessMode: input.role === 'dealer' || input.role === 'dealer_staff' ? input.dealerAccessMode ?? 'tier' : undefined,
    dealerPermissions: input.role === 'dealer' || input.role === 'dealer_staff' ? input.dealerPermissions ?? [] : undefined,
    active: true,
    createdAt: new Date().toISOString(),
    createdByUid: input.createdByUid,
    clearTextPassword: input.password,
    ...((input.role === 'staff' || input.role === 'super_admin' || input.role === 'dealer_staff') && input.hr ? {
      hrPhotoUrl: input.hr.hrPhotoUrl ?? null,
      hrPhotoStoragePath: input.hr.hrPhotoStoragePath ?? null,
      hrResidentialAddress: input.hr.hrResidentialAddress ?? null,
      hrPostalCode: input.hr.hrPostalCode ?? null,
      hrBloodGroup: input.hr.hrBloodGroup ?? null,
      hrDateOfBirth: input.hr.hrDateOfBirth ?? null,
      hrPoliceStation: input.hr.hrPoliceStation ?? null,
      hrEmergencyContactName: input.hr.hrEmergencyContactName ?? null,
      hrEmergencyContactRelationship: input.hr.hrEmergencyContactRelationship ?? null,
      hrEmergencyContactPhone: input.hr.hrEmergencyContactPhone ?? null,
      hrJoinDate: input.hr.hrJoinDate ?? null,
      hrEmployeeId: input.hr.hrEmployeeId ?? null,
      hrDesignation: input.hr.hrDesignation ?? null,
      hrDocuments: input.hr.hrDocuments ?? {},
    } : {}),
  });

  await setDoc(doc(db, 'users', uid), docData);
}

export async function registerUser(
  db: Firestore,
  input: CreateUserInput,
): Promise<string> {
  const parsed = parseLoginId(input.loginId);
  if (!parsed) throw new Error('Invalid login ID.');

  await assertLoginIdAvailable(parsed);

  try {
    const cred = await createAuthUser(input.loginId, input.password);
    await createUserProfile(db, cred.user.uid, input);
    await reserveLoginIndex(parsed.type, parsed.value, cred.user.uid, input.role);
    await signOut(secondaryAuth);
    return cred.user.uid;
  } catch (err) {
    await rollbackCreatedAuthUser();
    throw new Error(authErrorMessage(err, 'Failed to create user'), { cause: err });
  }
}

export async function updateUserProfile(
  db: Firestore,
  uid: string,
  patch: UpdateUserProfilePatch,
): Promise<void> {
  await updateDoc(
    doc(db, 'users', uid),
    omitUndefined({
      ...patch,
      updatedAt: new Date().toISOString(),
    }),
  );
}

/** Promote an existing staff account to super_admin. Keeps login/HR profile and Zoho salesperson links. */
export async function promoteStaffToSuperAdmin(
  db: Firestore,
  uid: string,
): Promise<void> {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('User not found.');
  const data = snap.data() as FirestoreUserDoc;
  const role = normalizeRole(String(data.role ?? ''));
  if (role !== 'staff') {
    throw new Error('Only staff accounts can be promoted to Super Admin.');
  }
  if (data.active === false) {
    throw new Error('Reactivate this staff member before promoting to Super Admin.');
  }
  await updateDoc(ref, {
    role: 'super_admin',
    superAdminAccess: 'full',
    staffDepartment: deleteField(),
    staffRoleId: deleteField(),
    staffAccessMode: deleteField(),
    staffPermissions: deleteField(),
    staffTeamId: deleteField(),
    staffLogisticsSite: deleteField(),
    updatedAt: new Date().toISOString(),
  });
}

export async function deactivateUser(db: Firestore, uid: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    active: false,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteUserProfile(db: Firestore, uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid));
}

export async function deleteUserPermanently(uid: string): Promise<void> {
  const functions = getFunctions(app, 'asia-south1');
  const callable = httpsCallable<{ uid: string }, { deleted: boolean }>(
    functions,
    'deleteManagedUser',
  );
  try {
    await callable({ uid });
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && 'message' in err) {
      const fbErr = err as { code: string; message: string };
      if (fbErr.code.startsWith('functions/') && fbErr.message) {
        throw new Error(fbErr.message);
      }
    }
    throw new Error(authErrorMessage(err, 'Could not delete user'));
  }
}

/** Super admin: set a new Auth password for a managed portal user. */
export async function setManagedUserPassword(uid: string, password: string): Promise<void> {
  const trimmed = password.trim();
  if (trimmed.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  const functions = getFunctions(app, 'asia-south1');
  const callable = httpsCallable<{ uid: string; password: string }, { ok: boolean }>(
    functions,
    'setManagedUserPassword',
  );
  try {
    await callable({ uid, password: trimmed });
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && 'message' in err) {
      const fbErr = err as { code: string; message: string };
      if (fbErr.code.startsWith('functions/') && fbErr.message) {
        throw new Error(fbErr.message);
      }
    }
    throw new Error(authErrorMessage(err, 'Could not update password'));
  }
}

/** Dealer owner: set a new Auth password for their own team staff. */
export async function resetDealerStaffPassword(uid: string, password: string): Promise<void> {
  const trimmed = password.trim();
  if (trimmed.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  const functions = getFunctions(app, 'asia-south1');
  const callable = httpsCallable<{ uid: string; password: string }, { ok: boolean }>(
    functions,
    'resetDealerStaffPassword',
  );
  try {
    await callable({ uid, password: trimmed });
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && 'message' in err) {
      const fbErr = err as { code: string; message: string };
      if (fbErr.code.startsWith('functions/') && fbErr.message) {
        throw new Error(fbErr.message);
      }
    }
    throw new Error(authErrorMessage(err, 'Could not reset password'));
  }
}

/** @deprecated Use deleteUserPermanently */
export const deleteDealerPermanently = deleteUserPermanently;
