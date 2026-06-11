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
import { authErrorMessage } from '../lib/authErrors';

const INACTIVE_MESSAGE = 'Your account is inactive. Contact YesWeigh super admin.';

async function resolveUser(fbUser: FirebaseUser): Promise<User | null> {
  try {
    const snap = await getDoc(doc(db, 'users', fbUser.uid));
    if (!snap.exists()) return null;

    const data = snap.data() as FirestoreUserDoc;
    const role = normalizeRole(String(data.role ?? ''));
    if (!role || !data.active) return null;

    return {
      uid: fbUser.uid,
      email: data.email.trim().toLowerCase(),
      displayName: data.displayName.trim() || 'User',
      role,
      dealerId: readDealerId(data),
      phone: data.phone?.trim() || undefined,
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

  const login = async (emailInput: string, password: string) => {
    setError(null);
    setLoading(true);
    const email = emailInput.trim().toLowerCase();
    if (!email.includes('@')) {
      const msg = 'Enter a valid email address.';
      setError(msg);
      setLoading(false);
      throw new Error(msg);
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
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
