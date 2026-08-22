/**
 * Per-dealer catalog MRP (incl. GST).
 * Path: dealerCatalogMrp/{dealerUid}/products/{productId}
 * Shared by dealer_staff via the parent dealer’s Firebase uid.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

const MAX_MRP = 99_999_999;
const PRODUCT_ID_MAX = 64;

function nowIso() {
  return new Date().toISOString();
}

function normalizeRole(role) {
  if (role === 'director') return 'dealer';
  if (role === 'director_staff') return 'dealer_staff';
  return role;
}

async function loadUser(uid) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await getFirestore().doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User profile not found.');
  const data = snap.data() || {};
  if (data.active === false) throw new HttpsError('permission-denied', 'Your account is inactive.');
  return { uid, role: normalizeRole(String(data.role ?? '')), data };
}

function resolveDealerUid(user) {
  if (user.role === 'dealer') return user.uid;
  if (user.role === 'dealer_staff') {
    const parent = String(user.data?.dealerId ?? user.data?.directorId ?? '').trim();
    if (!parent) {
      throw new HttpsError('failed-precondition', 'This staff account is not linked to a dealer.');
    }
    return parent;
  }
  throw new HttpsError('permission-denied', 'Only dealers can set a custom MRP.');
}

function parseProductId(raw) {
  const productId = String(raw ?? '').trim();
  if (!productId || productId.length > PRODUCT_ID_MAX) {
    throw new HttpsError('invalid-argument', 'productId is required.');
  }
  return productId;
}

function parseMrp(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const mrp = Number(raw);
  if (!Number.isFinite(mrp) || mrp < 0) {
    throw new HttpsError('invalid-argument', 'MRP must be a valid number.');
  }
  if (mrp === 0) return null;
  if (mrp > MAX_MRP) {
    throw new HttpsError('invalid-argument', 'MRP is too large.');
  }
  return Math.round(mrp * 100) / 100;
}

function productRef(dealerUid, productId) {
  return getFirestore().doc(`dealerCatalogMrp/${dealerUid}/products/${productId}`);
}

export async function setDealerCatalogMrp(uid, input) {
  const user = await loadUser(uid);
  const dealerUid = resolveDealerUid(user);
  const productId = parseProductId(input?.productId);
  const mrp = parseMrp(input?.mrp);

  const productSnap = await getFirestore().doc(`catalogProducts/${productId}`).get();
  if (!productSnap.exists) {
    throw new HttpsError('not-found', 'Product not found.');
  }

  const ref = productRef(dealerUid, productId);
  if (mrp == null) {
    await ref.delete();
    return { mrp: null, productId };
  }

  await ref.set({
    mrp,
    productId,
    dealerId: dealerUid,
    updatedAt: nowIso(),
    updatedByUid: uid,
  });
  return { mrp, productId };
}
