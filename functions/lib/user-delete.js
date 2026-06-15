import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

const DELETABLE_ROLES = new Set(['dealer', 'staff']);

function normalizeRole(role) {
  if (role === 'admin') return 'super_admin';
  if (role === 'director') return 'dealer';
  if (role === 'director_staff') return 'dealer_staff';
  return role;
}

function loginIndexDocId(type, value) {
  if (type === 'email') return `e_${String(value).trim().toLowerCase()}`;
  if (type === 'phone') return `p_${value}`;
  return `a_${value}`;
}

function resolveProfileLogin(data) {
  if (data.loginId && data.loginIdType) {
    return { type: data.loginIdType, value: data.loginId };
  }
  if (data.aadhar && String(data.aadhar).length === 12) {
    return { type: 'aadhar', value: String(data.aadhar) };
  }
  if (data.phone && String(data.phone).replace(/\D/g, '').length === 10) {
    return { type: 'phone', value: String(data.phone).replace(/\D/g, '') };
  }
  if (data.email && String(data.email).includes('@')) {
    return { type: 'email', value: String(data.email).trim().toLowerCase() };
  }
  return null;
}

async function dealerHasStaff(db, dealerUid) {
  const byDealerId = await db.collection('users').where('dealerId', '==', dealerUid).limit(1).get();
  if (!byDealerId.empty) return true;

  const byDirectorId = await db.collection('users').where('directorId', '==', dealerUid).limit(1).get();
  return !byDirectorId.empty;
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
    throw new HttpsError('failed-precondition', 'This user cannot be permanently deleted.');
  }

  if (role === 'dealer' && (await dealerHasStaff(db, targetUid))) {
    throw new HttpsError(
      'failed-precondition',
      'Remove or reassign all dealer staff before deleting this dealer.',
    );
  }

  const batch = db.batch();

  const login = resolveProfileLogin(data);
  if (login) {
    batch.delete(db.doc(`loginIndex/${loginIndexDocId(login.type, login.value)}`));
  }

  if (data.aadhar && String(data.aadhar).length === 12) {
    batch.delete(db.doc(`aadharIndex/${String(data.aadhar)}`));
  }

  batch.delete(targetRef);
  await batch.commit();

  try {
    await getAuth().deleteUser(targetUid);
  } catch (err) {
    const code = err?.code ?? '';
    if (code !== 'auth/user-not-found') {
      throw err;
    }
  }

  return { deleted: true };
}
