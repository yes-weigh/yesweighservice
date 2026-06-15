import { signOut, type UserCredential } from 'firebase/auth';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { secondaryAuth } from '../firebase';
import {
  assertLoginIdAvailable,
  createAuthUserForLoginId,
  parseLoginId,
} from './loginAuth';
import { authErrorMessage } from './authErrors';
import { reserveLoginIndex } from './loginIndex';
import { contactFieldsForLogin } from './profileLogin';
import type { FirestoreUserDoc, Role } from '../types';

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

export type CreateUserInput = {
  loginId: string;
  password: string;
  displayName: string;
  role: Role;
  phone?: string;
  email?: string;
  dealerId?: string;
  createdByUid: string;
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

  const docData: FirestoreUserDoc = {
    loginId: parsed.value,
    loginIdType: parsed.type,
    displayName: input.displayName.trim(),
    role: input.role,
    aadhar: contacts.aadhar,
    phone: contacts.phone ?? (input.phone?.trim() || undefined),
    email: contacts.email ?? (input.email?.trim().toLowerCase() || undefined),
    dealerId: input.role === 'dealer_staff' ? input.dealerId : undefined,
    active: true,
    createdAt: new Date().toISOString(),
    createdByUid: input.createdByUid,
    clearTextPassword: input.password,
  };

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
  patch: Partial<Pick<FirestoreUserDoc, 'displayName' | 'phone' | 'email' | 'active' | 'dealerId'>>,
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    ...patch,
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
