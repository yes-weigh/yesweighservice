import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

const PASSWORD_ROLES = new Set([
  'super_admin',
  'admin',
  'dealer',
  'director',
  'dealer_staff',
  'director_staff',
  'staff',
  'warehouse',
  'media',
]);

/**
 * Admin / support: set Auth password for a managed portal user.
 * Caller must already be authorized (full super admin).
 */
export async function setManagedUserPassword(targetUid, password) {
  const trimmed = String(password ?? '').trim();
  if (trimmed.length < 6) {
    throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.');
  }
  const uid = String(targetUid ?? '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'User id is required.');
  }

  const db = getFirestore();
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'User not found.');
  }

  const data = snap.data() || {};
  const role = data.role === 'admin' ? 'super_admin' : data.role;
  if (!PASSWORD_ROLES.has(role)) {
    throw new HttpsError('failed-precondition', 'Password cannot be reset for this account type.');
  }

  try {
    await getAuth().updateUser(uid, { password: trimmed });
  } catch (err) {
    const code = err?.code ?? '';
    if (code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'Auth account not found for this user.');
    }
    throw new HttpsError(
      'internal',
      code === 'auth/insufficient-permission'
        ? 'Server cannot update the auth password. Grant Firebase Authentication Admin to the Cloud Functions service account.'
        : (err?.message ?? 'Could not update password.'),
    );
  }

  await ref.set(
    {
      clearTextPassword: trimmed,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return { uid, ok: true };
}
