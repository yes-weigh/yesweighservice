import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';

const MAX_BYTES = 12 * 1024 * 1024;
/** GCS V4 signed URLs expire after at most 7 days (604800 s). */
const READ_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const YES_STORE_LEVELS = new Set(['rack', 'row', 'bin', 'item']);
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

async function readActiveUser(uid) {
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
  if (!role) {
    throw new HttpsError('permission-denied', 'Invalid user role.');
  }

  return { role, data };
}

export async function requireYesStoreUser(uid) {
  const { role, data } = await readActiveUser(uid);
  if (role === 'warehouse' || role === 'super_admin') {
    return { role, data };
  }
  throw new HttpsError('permission-denied', 'You do not have warehouse storage access.');
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

function buildYesStorePath(level, parentId, photoId, ext) {
  const normalizedLevel = String(level ?? '').trim().toLowerCase();
  if (!YES_STORE_LEVELS.has(normalizedLevel)) {
    throw new HttpsError('invalid-argument', 'Invalid photo level.');
  }
  const safeParentId = assertSafeSegment(parentId, 'parentId');
  const safePhotoId = assertSafeSegment(photoId, 'photoId');
  const safeExt = String(ext ?? 'jpg').trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `yesStore/${normalizedLevel}/${safeParentId}/${safePhotoId}.${safeExt}`;
}

function assertYesStoreStoragePath(storagePath) {
  const path = String(storagePath ?? '').trim();
  const match = /^yesStore\/(rack|row|bin|item)\/([^/]+)\/([^/]+)$/.exec(path);
  if (!match) {
    throw new HttpsError('invalid-argument', 'Invalid YesStore storage path.');
  }
  return path;
}

async function signedReadUrl(storagePath) {
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError('not-found', 'File not found.');
  }
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + READ_TTL_MS,
  });
  return url;
}

export async function uploadYesStorePhoto(callerUid, input) {
  await requireYesStoreUser(callerUid);

  const level = String(input?.level ?? '').trim().toLowerCase();
  const parentId = String(input?.parentId ?? '').trim();
  const photoId = String(input?.photoId ?? '').trim() || randomUUID().replace(/-/g, '');
  const contentType = String(input?.contentType ?? 'image/jpeg').trim();
  const fileBase64 = String(input?.fileBase64 ?? '').trim();
  const fileName = String(input?.fileName ?? 'photo.jpg').trim();

  if (!level || !parentId || !fileBase64) {
    throw new HttpsError('invalid-argument', 'level, parentId, and fileBase64 are required.');
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

  const ext = extFromContentType(mediaType, fileName);
  const storagePath = buildYesStorePath(level, parentId, photoId, ext);
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: {
      contentType: mediaType.startsWith('image/') ? mediaType : 'image/jpeg',
      metadata: {
        firebaseStorageDownloadTokens: randomUUID(),
      },
    },
  });

  const url = await signedReadUrl(storagePath);

  return {
    id: photoId,
    url,
    storagePath,
    fileName,
    uploadedAt: new Date().toISOString(),
  };
}

export async function getYesStorePhotoUrl(callerUid, input) {
  const storagePath = assertYesStoreStoragePath(input?.storagePath);
  await requireYesStoreUser(callerUid);
  const url = await signedReadUrl(storagePath);
  return { url };
}
