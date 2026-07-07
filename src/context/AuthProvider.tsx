import React, { useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  signInWithCustomToken,
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
import { clearInvoiceCacheForUser } from '../lib/invoice-cache';
import { FIRM_NAME } from '../constants/brand';
import type { DealerTier, DealerPermission, DealerAccessMode } from '../types/dealer-access';

const INACTIVE_MESSAGE = `Your account is inactive. Contact ${FIRM_NAME} super admin.`;

async function readParentDealerAccess(dealerId: string): Promise<{
  dealerTier?: DealerTier;
  dealerAccessMode?: DealerAccessMode;
  dealerPermissions?: DealerPermission[];
} | null> {
  try {
    const parentSnap = await getDoc(doc(db, 'users', dealerId));
    if (!parentSnap.exists()) return null;
    const parent = parentSnap.data() as FirestoreUserDoc;
    return {
      dealerTier: parent.dealerTier,
      dealerAccessMode: parent.dealerAccessMode,
      dealerPermissions: parent.dealerPermissions,
    };
  } catch {
    return null;
  }
}

async function resolveUser(fbUser: FirebaseUser): Promise<User | null> {
  try {
    const snap = await getDoc(doc(db, 'users', fbUser.uid));
    if (!snap.exists()) return null;

    const data = snap.data() as FirestoreUserDoc;
    const role = normalizeRole(String(data.role ?? ''));
    const login = resolveProfileLogin(data);
    if (!role || !data.active || !login) return null;

    const contacts = contactFieldsForLogin(login);

    let dealerTier = data.dealerTier;
    let dealerAccessMode = data.dealerAccessMode;
    let dealerPermissions = data.dealerPermissions;

    if (role === 'dealer_staff' && !dealerTier) {
      const parentId = readDealerId(data);
      if (parentId) {
        const inherited = await readParentDealerAccess(parentId);
        if (inherited) {
          dealerTier = inherited.dealerTier;
          dealerAccessMode = inherited.dealerAccessMode;
          dealerPermissions = inherited.dealerPermissions;
        }
      }
    }

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
      staffDepartment: data.staffDepartment,
      staffRoleId: data.staffRoleId ?? null,
      staffAccessMode: data.staffAccessMode,
      staffPermissions: data.staffPermissions,
      staffKamId: data.staffKamId ?? null,
      staffTeamId: data.staffTeamId ?? null,
      staffLogisticsSite: data.staffLogisticsSite ?? null,
      dealerTier,
      dealerAccessMode,
      dealerPermissions,
      hrPhotoUrl: data.hrPhotoUrl ?? null,
      hrResidentialAddress: data.hrResidentialAddress ?? null,
      hrPostalCode: data.hrPostalCode ?? null,
      hrBloodGroup: data.hrBloodGroup ?? null,
      hrPoliceStation: data.hrPoliceStation ?? null,
      hrEmergencyContactName: data.hrEmergencyContactName ?? null,
      hrEmergencyContactRelationship: data.hrEmergencyContactRelationship ?? null,
      hrEmergencyContactPhone: data.hrEmergencyContactPhone ?? null,
      hrJoinDate: data.hrJoinDate ?? null,
      hrEmployeeId: data.hrEmployeeId ?? null,
      hrDesignation: data.hrDesignation ?? null,
      hrDocuments: data.hrDocuments ?? {},
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
        throw new Error(`No profile found for this account. Contact ${FIRM_NAME} super admin.`);
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

  const loginWithCustomToken = async (token: string) => {
    setError(null);
    setLoading(true);
    try {
      const cred = await signInWithCustomToken(auth, token);
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
        throw new Error(`No profile found for this account. Contact ${FIRM_NAME} super admin.`);
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
    const uid = auth.currentUser?.uid;
    if (uid) clearInvoiceCacheForUser(uid);
    await signOut(auth);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, login, loginWithCustomToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
