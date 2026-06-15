import React, { useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { User, FirestoreUserDoc } from '../types';
import { normalizeRole, readDealerId } from '../types';
import { AuthContext } from './auth-context';
import { authEmailForLoginId, parseLoginId } from '../lib/loginAuth';
import { contactFieldsForLogin, resolveProfileLogin } from '../lib/profileLogin';
import { authErrorMessage } from '../lib/authErrors';

const INACTIVE_MESSAGE = 'Your account is inactive. Contact YesWeigh super admin.';

async function resolveUser(fbUser: FirebaseUser): Promise<User | null> {
  try {
    const snap = await getDoc(doc(db, 'users', fbUser.uid));
    if (!snap.exists()) return null;

    const data = snap.data() as FirestoreUserDoc;
    const role = normalizeRole(String(data.role ?? ''));
    const login = resolveProfileLogin(data);
    if (!role || !data.active || !login) return null;

    const contacts = contactFieldsForLogin(login);

    return {
      uid: fbUser.uid,
      loginId: login.value,
      loginIdType: login.type,
      displayName: data.displayName.trim() || 'User',
      role,
      email: data.email?.trim().toLowerCase() || contacts.email,
      phone: data.phone?.trim() || contacts.phone,
      aadhar: data.aadhar || contacts.aadhar,
      dealerId: readDealerId(data),
      active: true,
    };
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async fbUser => {
      if (fbUser) {
        setUser(await resolveUser(fbUser));
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async (loginIdInput: string, password: string) => {
    setError(null);
    setLoading(true);
    const parsed = parseLoginId(loginIdInput);
    if (!parsed) {
      const msg = 'Enter a valid email, 10-digit phone, or 12-digit Aadhaar number.';
      setError(msg);
      setLoading(false);
      throw new Error(msg);
    }

    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        authEmailForLoginId(parsed.type, parsed.value),
        password,
      );
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      if (snap.exists()) {
        const data = snap.data() as FirestoreUserDoc;
        if (data.active === false) {
          await signOut(auth);
          throw new Error(INACTIVE_MESSAGE);
        }
      }
      const resolved = await resolveUser(cred.user);
      if (!resolved) {
        await signOut(auth);
        throw new Error('No profile found for this account. Contact YesWeigh super admin.');
      }
      setUser(resolved);
    } catch (err: unknown) {
      const friendly = authErrorMessage(err, 'Login failed');
      setError(friendly);
      throw new Error(friendly, { cause: err });
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
