import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';

const MAX_BYTES = 40 * 1024 * 1024;
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/octet-stream',
]);

function normalizeRole(role) {
  if (role === 'admin') return 'super_admin';
  return role;
}

async function requireMediaWriter(uid) {
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
  if (role !== 'super_admin' && role !== 'media') {
    throw new HttpsError('permission-denied', 'Only media users can manage product media.');
  }

  return {
    role,
    displayName: String(data?.displayName ?? data?.name ?? '').trim() || null,
  };
}

function assertSafeSegment(value, label) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed.length > 96 || !SAFE_SEGMENT.test(trimmed)) {
    throw new HttpsError('invalid-argument', `Invalid ${label}.`);
  }
  return trimmed;
}

function kindFromContentType(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('video/')) return 'video';
  return 'other';
}

function extFromContentType(contentType, fileName) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/heic') return 'heic';
  if (type === 'image/heif') return 'heif';
  if (type === 'application/pdf') return 'pdf';
  if (type === 'video/mp4') return 'mp4';
  if (type === 'video/webm') return 'webm';
  if (type === 'video/quicktime') return 'mov';
  const lower = String(fileName ?? '').toLowerCase();
  const match = /\.([a-z0-9]{1,8})$/i.exec(lower);
  if (match) return match[1].toLowerCase();
  return 'bin';
}

function firebaseDownloadUrl(bucketName, storagePath, token) {
  const encoded = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media&token=${token}`;
}

function assertCatalogMediaStoragePath(storagePath) {
  const path = String(storagePath ?? '').trim();
  const match = /^catalogMedia\/([^/]+)\/([^/]+)$/.exec(path);
  if (!match) {
    throw new HttpsError('invalid-argument', 'Invalid media storage path.');
  }
  return path;
}

export async function uploadCatalogMediaFile(callerUid, input) {
  const actor = await requireMediaWriter(callerUid);

  const catalogProductId = assertSafeSegment(input?.catalogProductId, 'catalogProductId');
  const contentType = String(input?.contentType ?? 'application/octet-stream').trim();
  const fileBase64 = String(input?.fileBase64 ?? '').trim();
  const fileNameHint = String(input?.fileName ?? 'file').trim();
  const fileId = String(input?.fileId ?? '').trim()
    || `media_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const caption = String(input?.caption ?? '').trim() || null;

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
    throw new HttpsError('invalid-argument', `File must be under ${MAX_BYTES / (1024 * 1024)} MB.`);
  }

  const mediaType = contentType.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  if (!ALLOWED_TYPES.has(mediaType)) {
    throw new HttpsError('invalid-argument', 'Unsupported file type. Use image, PDF, or video.');
  }

  const ext = extFromContentType(mediaType, fileNameHint);
  const safeFileId = assertSafeSegment(fileId, 'fileId');
  const fileName = `${safeFileId}.${ext}`;
  const storagePath = `catalogMedia/${catalogProductId}/${fileName}`;
  const token = randomUUID();
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const resolvedType = mediaType === 'application/octet-stream'
    ? (ext === 'pdf' ? 'application/pdf' : ext === 'mp4' ? 'video/mp4' : 'image/jpeg')
    : mediaType;

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: resolvedType,
      metadata: {
        firebaseStorageDownloadTokens: token,
        uploadedByUid: callerUid,
      },
    },
  });

  return {
    id: safeFileId,
    fileName: fileNameHint || fileName,
    contentType: resolvedType,
    kind: kindFromContentType(resolvedType),
    url: firebaseDownloadUrl(bucket.name, storagePath, token),
    storagePath,
    sizeBytes: buffer.length,
    caption,
    uploadedAt: new Date().toISOString(),
    uploadedByUid: callerUid,
    uploadedByName: actor.displayName,
  };
}

export async function deleteCatalogMediaFile(callerUid, input) {
  await requireMediaWriter(callerUid);
  const storagePath = assertCatalogMediaStoragePath(input?.storagePath);
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return { deleted: false };
  await file.delete({ ignoreNotFound: true });
  return { deleted: true };
}
