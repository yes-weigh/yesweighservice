import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

const DELETABLE_ROLES = new Set(['super_admin', 'dealer', 'staff', 'dealer_staff', 'warehouse']);

function normalizeRole(role) {
  if (role === 'admin') return 'super_admin';
  if (role === 'director') return 'dealer';
  if (role === 'director_staff') return 'dealer_staff';
  return role;
}

function loginIndexDocId(type, value) {
  if (type === 'email') return `e_${String(value).trim().toLowerCase()}`;
  if (type === 'phone') return `p_${value}`;
  if (type === 'username') return `u_${value}`;
  return `a_${value}`;
}

/** Login used for sign-in — avoid treating contact email/phone as login. */
function resolveProfileLogin(data) {
  if (data.loginId && data.loginIdType) {
    return { type: data.loginIdType, value: data.loginId };
  }
  if (data.aadhar && String(data.aadhar).length === 12) {
    return { type: 'aadhar', value: String(data.aadhar) };
  }
  return null;
}

async function listDealerStaffUids(db, dealerUid) {
  const [byDealerId, byDirectorId] = await Promise.all([
    db.collection('users').where('dealerId', '==', dealerUid).get(),
    db.collection('users').where('directorId', '==', dealerUid).get(),
  ]);

  const ids = new Set();
  for (const doc of byDealerId.docs) ids.add(doc.id);
  for (const doc of byDirectorId.docs) ids.add(doc.id);
  return [...ids];
}

async function purgeUserIndexes(db, data) {
  const login = resolveProfileLogin(data);
  if (login) {
    await db.doc(`loginIndex/${loginIndexDocId(login.type, login.value)}`).delete().catch(() => undefined);
  }
  if (data.aadhar && String(data.aadhar).length === 12) {
    await db.doc(`aadharIndex/${String(data.aadhar)}`).delete().catch(() => undefined);
  }
}

async function purgeUserRecord(db, targetUid, data) {
  await purgeUserIndexes(db, data);
  await db.doc(`users/${targetUid}`).delete();

  try {
    await getAuth().deleteUser(targetUid);
  } catch (err) {
    const code = err?.code ?? '';
    if (code === 'auth/user-not-found') return;
    throw new HttpsError(
      'internal',
      code === 'auth/insufficient-permission'
        ? 'Server cannot delete the auth account. Grant Firebase Authentication Admin to the Cloud Functions service account.'
        : (err?.message ?? 'Could not delete auth user.'),
    );
  }
}

export async function deleteManagedUserAccount(targetUid) {
  const db = getFirestore();
  const targetRef = db.doc(`users/${targetUid}`);
  const targetSnap = await targetRef.get();

  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'User not found.');
  }

  const data = targetSnap.data();
  const role = normalizeRole(String(data?.role ?? ''));
  if (!DELETABLE_ROLES.has(role)) {
    throw new HttpsError(
      'failed-precondition',
      `Cannot permanently delete ${role || 'this user'}.`,
    );
  }

  if (role === 'super_admin') {
    const superAdminSnap = await db.collection('users')
      .where('role', 'in', ['super_admin', 'admin'])
      .get();
    if (superAdminSnap.size <= 1) {
      throw new HttpsError(
        'failed-precondition',
        'Cannot delete the last super admin account.',
      );
    }
  }

  if (role === 'dealer') {
    const staffUids = await listDealerStaffUids(db, targetUid);
    for (const staffUid of staffUids) {
      await deleteManagedUserAccount(staffUid);
    }
  }

  await purgeUserRecord(db, targetUid, data);
  return { deleted: true };
}
