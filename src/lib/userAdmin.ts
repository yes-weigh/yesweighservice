import { signOut, type UserCredential } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
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
import type { FirestoreUserDoc, Role } from '../types';
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
    | 'staffDepartment'
    | 'staffRoleId'
    | 'staffAccessMode'
    | 'staffPermissions'
    | 'staffKamId'
    | 'staffTeamId'
    | 'dealerTier'
    | 'dealerAccessMode'
    | 'dealerPermissions'
    | 'hrPhotoUrl'
    | 'hrResidentialAddress'
    | 'hrPostalCode'
    | 'hrBloodGroup'
    | 'hrPoliceStation'
    | 'hrEmergencyContactName'
    | 'hrEmergencyContactRelationship'
    | 'hrEmergencyContactPhone'
    | 'hrJoinDate'
    | 'hrEmployeeId'
    | 'hrDesignation'
    | 'hrDocuments'
  >
>;

export type CreateStaffHrInput = {
  hrPhotoUrl?: string | null;
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
  staffDepartment?: StaffDepartment;
  staffRoleId?: string | null;
  staffAccessMode?: 'role' | 'department' | 'custom';
  staffPermissions?: StaffPermission[];
  staffKamId?: string | null;
  staffTeamId?: string | null;
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
    dealerId: input.role === 'dealer_staff' ? input.dealerId?.trim() : undefined,
    zohoCustomerId: input.zohoCustomerId?.trim() || undefined,
    staffDepartment: input.role === 'staff' ? input.staffDepartment : undefined,
    staffRoleId: input.role === 'staff' ? input.staffRoleId ?? null : undefined,
    staffAccessMode: input.role === 'staff' ? input.staffAccessMode ?? 'role' : undefined,
    staffPermissions: input.role === 'staff' ? input.staffPermissions ?? [] : undefined,
    staffKamId: input.role === 'staff' ? input.staffKamId ?? null : undefined,
    staffTeamId: input.role === 'staff' ? input.staffTeamId ?? null : undefined,
    dealerTier: input.role === 'dealer' || input.role === 'dealer_staff' ? input.dealerTier ?? 'standard' : undefined,
    dealerAccessMode: input.role === 'dealer' || input.role === 'dealer_staff' ? input.dealerAccessMode ?? 'tier' : undefined,
    dealerPermissions: input.role === 'dealer' || input.role === 'dealer_staff' ? input.dealerPermissions ?? [] : undefined,
    active: true,
    createdAt: new Date().toISOString(),
    createdByUid: input.createdByUid,
    clearTextPassword: input.password,
    ...(input.role === 'staff' && input.hr ? {
      hrPhotoUrl: input.hr.hrPhotoUrl ?? null,
      hrResidentialAddress: input.hr.hrResidentialAddress ?? null,
      hrPostalCode: input.hr.hrPostalCode ?? null,
      hrBloodGroup: input.hr.hrBloodGroup ?? null,
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

/** @deprecated Use deleteUserPermanently */
export const deleteDealerPermanently = deleteUserPermanently;
