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

async function requireOpsUser(uid) {
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
  if (role !== 'super_admin' && role !== 'staff') {
    throw new HttpsError('permission-denied', 'Only staff can upload logistics photos.');
  }

  return { role, data };
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
  await requireOpsUser(callerUid);
  const storagePath = assertLogisticsStoragePath(input?.storagePath);
  const url = await durableReadUrl(storagePath);
  return { url };
}
