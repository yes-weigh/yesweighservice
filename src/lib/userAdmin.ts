import {
  createUserWithEmailAndPassword,
  signOut,
  type UserCredential,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { secondaryAuth } from '../firebase';
import { authErrorMessage, isValidEmail, normalizeEmail } from './authErrors';
import type { FirestoreUserDoc, Role } from '../types';

export async function createAuthUser(email: string, password: string): Promise<UserCredential> {
  return createUserWithEmailAndPassword(secondaryAuth, normalizeEmail(email), password);
}

export async function rollbackCreatedAuthUser(): Promise<void> {
  await signOut(secondaryAuth);
}

export type CreateUserInput = {
  email: string;
  password: string;
  displayName: string;
  role: Role;
  phone?: string;
  dealerId?: string;
  createdByUid: string;
};

export async function createUserProfile(
  db: Firestore,
  uid: string,
  input: CreateUserInput,
): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw new Error('Invalid email address.');
  if (input.role === 'dealer_staff' && !input.dealerId?.trim()) {
    throw new Error('Dealer staff must be linked to a dealer.');
  }

  const docData: FirestoreUserDoc = {
    email,
    displayName: input.displayName.trim(),
    role: input.role,
    phone: input.phone?.trim() || undefined,
    dealerId: input.role === 'dealer_staff' ? input.dealerId : undefined,
    active: true,
    createdAt: new Date().toISOString(),
    createdByUid: input.createdByUid,
  };

  await setDoc(doc(db, 'users', uid), docData);
}

export async function registerUser(
  db: Firestore,
  input: CreateUserInput,
): Promise<string> {
  try {
    const cred = await createAuthUser(input.email, input.password);
    await createUserProfile(db, cred.user.uid, input);
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
  patch: Partial<Pick<FirestoreUserDoc, 'displayName' | 'phone' | 'active' | 'dealerId'>>,
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
