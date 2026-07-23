/**
 * Payment screenshot uploads for dealer orders.
 */
import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';

const MAX_BYTES = 12 * 1024 * 1024;
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

function normalizeRole(role) {
  if (role === 'admin') return 'super_admin';
  if (role === 'director') return 'dealer';
  if (role === 'director_staff') return 'dealer_staff';
  return role;
}

async function loadActiveUser(uid) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await getFirestore().doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User profile not found.');
  const data = snap.data() || {};
  if (data.active === false) throw new HttpsError('permission-denied', 'Your account is inactive.');
  return { role: normalizeRole(String(data.role ?? '')), data };
}

function resolvedDealerIdForUser(uid, role, data) {
  if (role === 'dealer') return uid;
  if (role === 'dealer_staff') {
    return data?.dealerId != null ? String(data.dealerId) : (data?.directorId != null ? String(data.directorId) : uid);
  }
  return null;
}

function assertSafeSegment(value, label) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed.length > 96 || !SAFE_SEGMENT.test(trimmed)) {
    throw new HttpsError('invalid-argument', `Invalid ${label}.`);
  }
  return trimmed;
}

function extFromContentType(contentType, fileName) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/heic' || type === 'image/heif') return 'heic';
  const fromName = String(fileName ?? '').split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  return 'jpg';
}

async function requireOrderPaymentAccess(uid, orderId) {
  const user = await loadActiveUser(uid);
  const snap = await getFirestore().doc(`dealerOrders/${orderId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
  const order = snap.data() || {};

  if (user.role === 'super_admin' || user.role === 'staff') {
    return { user, order };
  }

  const dealerId = resolvedDealerIdForUser(uid, user.role, user.data);
  if (!dealerId || String(order.dealerId) !== dealerId) {
    throw new HttpsError('permission-denied', 'You do not have access to this order.');
  }
  return { user, order };
}

export async function uploadDealerOrderPaymentScreenshot(uid, {
  orderId,
  contentType,
  dataBase64,
  fileName,
}) {
  const id = assertSafeSegment(orderId, 'order id');
  const { user, order } = await requireOrderPaymentAccess(uid, id);

  if (user.role !== 'dealer' && user.role !== 'dealer_staff') {
    throw new HttpsError('permission-denied', 'Only dealers can upload payment screenshots.');
  }

  if (order.status !== 'waiting_for_payment' && order.status !== 'payment_submitted') {
    throw new HttpsError(
      'failed-precondition',
      'Payment screenshot can only be uploaded when waiting for payment.',
    );
  }

  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    throw new HttpsError('invalid-argument', 'Payment proof must be an image.');
  }

  const buffer = Buffer.from(String(dataBase64 ?? ''), 'base64');
  if (!buffer.length) throw new HttpsError('invalid-argument', 'Empty file.');
  if (buffer.length > MAX_BYTES) {
    throw new HttpsError('invalid-argument', 'Image must be under 12 MB.');
  }

  const ext = extFromContentType(type, fileName);
  const storagePath = `dealer-orders/${id}/payment-${randomUUID()}.${ext}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: type,
      metadata: {
        uploadedByUid: uid,
        orderId: id,
      },
    },
  });

  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000,
  });

  return { storagePath, url: signedUrl };
}

export async function getDealerOrderPaymentUrl(uid, storagePath) {
  const path = String(storagePath ?? '').trim();
  const match = path.match(/^dealer-orders\/([^/]+)\//);
  if (!match) throw new HttpsError('invalid-argument', 'Invalid storage path.');
  await requireOrderPaymentAccess(uid, match[1]);

  const file = getStorage().bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'Payment screenshot not found.');

  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000,
  });
  return signedUrl;
}
