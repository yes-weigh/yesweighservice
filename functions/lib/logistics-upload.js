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
  return role;
}

async function loadActiveUser(uid) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const snap = await getFirestore().doc(`users/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }

  const data = snap.data();
  if (data?.active === false) {
    throw new HttpsError('permission-denied', 'Your account is inactive.');
  }

  const role = normalizeRole(String(data?.role ?? ''));
  return { role, data };
}

async function requireOpsUser(uid) {
  const user = await loadActiveUser(uid);
  if (user.role !== 'super_admin' && user.role !== 'staff') {
    throw new HttpsError('permission-denied', 'Only staff can upload logistics photos.');
  }
  return user;
}

function resolvedDealerIdForUser(uid, role, data) {
  if (role === 'dealer' || role === 'director') return uid;
  if (role === 'dealer_staff' || role === 'director_staff') {
    const linked = data?.dealerId != null ? data.dealerId : data?.directorId;
    return linked != null ? String(linked) : uid;
  }
  return null;
}

/** Ops, or the dealer (staff) that owns the booking for this storage path. */
async function requireLogisticsPhotoReadAccess(uid, storagePath) {
  const user = await loadActiveUser(uid);
  if (user.role === 'super_admin' || user.role === 'staff') {
    return user;
  }

  const match = String(storagePath).match(/^logistics\/([^/]+)\//);
  const bookingId = match?.[1];
  if (!bookingId) {
    throw new HttpsError('permission-denied', 'You do not have access to this photo.');
  }

  const bookingSnap = await getFirestore().doc(`logisticsBookings/${bookingId}`).get();
  if (!bookingSnap.exists) {
    throw new HttpsError('not-found', 'Shipment not found.');
  }
  const booking = bookingSnap.data() || {};
  const dealerId = resolvedDealerIdForUser(uid, user.role, user.data);
  const zohoCustomerId = String(user.data?.zohoCustomerId ?? '').trim();
  const bookingDealerId = String(booking.dealerId ?? '').trim();
  const bookingZohoId = String(booking.zohoCustomerId ?? '').trim();

  const allowed = (dealerId && bookingDealerId && dealerId === bookingDealerId)
    || (zohoCustomerId && bookingZohoId && zohoCustomerId === bookingZohoId);

  if (!allowed) {
    throw new HttpsError('permission-denied', 'You do not have access to this photo.');
  }
  return user;
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
  if (type === 'image/heic') return 'heic';
  if (type === 'image/heif') return 'heif';
  const lower = String(fileName ?? '').toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.webp')) return 'webp';
  if (lower.endsWith('.gif')) return 'gif';
  if (lower.endsWith('.heic')) return 'heic';
  if (lower.endsWith('.heif')) return 'heif';
  return 'jpg';
}

function firebaseDownloadUrl(bucketName, storagePath, token) {
  const encoded = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media&token=${token}`;
}

function logisticsPhotoStoragePath(bookingId, slot, fileName) {
  return `logistics/${bookingId}/${slot}/${fileName}`;
}

function assertLogisticsStoragePath(storagePath) {
  const path = String(storagePath ?? '').trim();
  // Nested or flat legacy paths under logistics/{bookingId}/…
  if (!/^logistics\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/.+/.test(path)) {
    throw new HttpsError('invalid-argument', 'Invalid logistics storage path.');
  }
  if (path.includes('..')) {
    throw new HttpsError('invalid-argument', 'Invalid logistics storage path.');
  }
  return path;
}

async function durableReadUrl(storagePath) {
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError('not-found', 'File not found.');
  }

  const [metadata] = await file.getMetadata();
  let token = metadata?.metadata?.firebaseStorageDownloadTokens;
  if (Array.isArray(token)) token = token[0];
  if (typeof token === 'string' && token.includes(',')) {
    token = token.split(',')[0].trim();
  }
  if (!token) {
    token = randomUUID();
    await file.setMetadata({
      metadata: {
        ...(metadata.metadata || {}),
        firebaseStorageDownloadTokens: token,
      },
    });
  }

  return firebaseDownloadUrl(bucket.name, storagePath, token);
}

/**
 * Ops logistics photo upload via Admin SDK — bypasses client Storage rules.
 */
export async function uploadLogisticsPhoto(callerUid, input) {
  await requireOpsUser(callerUid);

  const bookingId = assertSafeSegment(input?.bookingId, 'bookingId');
  const slotRaw = String(input?.slot ?? 'photo').trim().replace(/[^\w\-]+/g, '-').slice(0, 80);
  const slot = assertSafeSegment(slotRaw || 'photo', 'slot');
  const contentType = String(input?.contentType ?? 'image/jpeg').trim();
  const fileBase64 = String(input?.fileBase64 ?? '').trim();
  const fileNameHint = String(input?.fileName ?? 'photo.jpg').trim();

  if (!fileBase64) {
    throw new HttpsError('invalid-argument', 'fileBase64 is required.');
  }

  let buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    throw new HttpsError('invalid-argument', 'Invalid file data.');
  }

  if (!buffer.length || buffer.length > MAX_BYTES) {
    throw new HttpsError('invalid-argument', `Image must be under ${MAX_BYTES / (1024 * 1024)} MB.`);
  }

  const mediaType = contentType.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  if (!mediaType.startsWith('image/') && mediaType !== 'application/octet-stream') {
    throw new HttpsError('invalid-argument', 'Upload an image file.');
  }
  if (mediaType !== 'application/octet-stream' && !ALLOWED_IMAGE_TYPES.has(mediaType)) {
    throw new HttpsError('invalid-argument', 'Unsupported image type.');
  }

  const ext = extFromContentType(mediaType, fileNameHint);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const storagePath = logisticsPhotoStoragePath(bookingId, slot, fileName);
  const token = randomUUID();
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: mediaType === 'application/octet-stream' ? 'image/jpeg' : mediaType,
      metadata: {
        firebaseStorageDownloadTokens: token,
        uploadedByUid: callerUid,
      },
    },
  });

  return {
    storagePath,
    url: firebaseDownloadUrl(bucket.name, storagePath, token),
    fileName,
    uploadedAt: new Date().toISOString(),
  };
}

/** Durable token URL for logistics photos — bypasses client Storage read rules. */
export async function getLogisticsPhotoUrl(callerUid, input) {
  const storagePath = assertLogisticsStoragePath(input?.storagePath);
  await requireLogisticsPhotoReadAccess(callerUid, storagePath);
  const url = await durableReadUrl(storagePath);
  return { url };
}

/**
 * Public package-contents lookup for shipping-label QR short links.
 * Resolves logisticsBookings/{bookingId}.boxes[boxIndex-1].photos[0].
 */
export async function getPublicLogisticsInsidePhotoUrl(bookingIdRaw, boxIndexRaw) {
  const bookingId = assertSafeSegment(bookingIdRaw, 'bookingId');
  const boxIndex = Math.max(1, Math.floor(Number(boxIndexRaw) || 1));

  const snap = await getFirestore().doc(`logisticsBookings/${bookingId}`).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Shipment not found.');
  }

  const data = snap.data() || {};
  const boxes = Array.isArray(data.boxes) ? data.boxes : [];
  const box = boxes[boxIndex - 1] || boxes[0];
  if (!box) {
    throw new HttpsError('not-found', 'Box not found.');
  }

  const photos = Array.isArray(box.photos) ? box.photos : [];
  const storagePath = String(photos[0]?.storagePath ?? '').trim();
  if (!storagePath) {
    throw new HttpsError('not-found', 'Package photo not found.');
  }

  const url = await durableReadUrl(assertLogisticsStoragePath(storagePath));
  return { url, bookingId, boxIndex };
}
