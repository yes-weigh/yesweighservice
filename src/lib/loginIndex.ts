import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { LoginIdType } from '../types';
import { normalizeEmail } from './loginAuth';

export type LoginIndexEntry = {
  uid: string;
  role: string;
  loginIdType: LoginIdType;
  createdAt: string;
};

export function loginIndexDocId(type: LoginIdType, value: string): string {
  if (type === 'email') return `e_${normalizeEmail(value)}`;
  if (type === 'phone') return `p_${value}`;
  return `a_${value}`;
}

export function loginIndexRef(type: LoginIdType, value: string) {
  return doc(db, 'loginIndex', loginIndexDocId(type, value));
}

export function buildLoginIndexEntry(
  uid: string,
  role: string,
  loginIdType: LoginIdType,
): LoginIndexEntry {
  return {
    uid,
    role,
    loginIdType,
    createdAt: new Date().toISOString(),
  };
}

export async function assertLoginIndexAvailable(
  type: LoginIdType,
  value: string,
  excludeUid?: string,
): Promise<void> {
  try {
    const snap = await getDoc(loginIndexRef(type, value));
    if (!snap.exists()) return;
    const ownerUid = (snap.data() as LoginIndexEntry).uid;
    if (ownerUid && ownerUid !== excludeUid) {
      throw new Error('This login ID is already registered.');
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('already registered')) {
      throw err;
    }
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: string }).code)
        : '';
    if (code === 'permission-denied') {
      throw new Error(
        'Could not verify login ID availability. Deploy Firestore rules: firebase deploy --only firestore:rules',
      );
    }
    throw err;
  }
}

export async function reserveLoginIndex(
  type: LoginIdType,
  value: string,
  uid: string,
  role: string,
): Promise<void> {
  await setDoc(loginIndexRef(type, value), buildLoginIndexEntry(uid, role, type));
}

export async function releaseLoginIndex(type: LoginIdType, value: string): Promise<void> {
  await deleteDoc(loginIndexRef(type, value)).catch(() => undefined);
}
