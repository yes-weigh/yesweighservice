import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';

const MAX_BYTES = 52 * 1024 * 1024;
/** Callable request body limit — keep raw file under this for base64 server uploads. */
const MAX_SERVER_UPLOAD_BYTES = 20 * 1024 * 1024;
const UPLOAD_TTL_MS = 15 * 60 * 1000;
/** GCS V4 signed URLs expire after at most 7 days (604800 s). */
const READ_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PORTAL_ROLES = new Set(['dealer', 'dealer_staff', 'director', 'director_staff']);
const OPS_ROLES = new Set(['staff', 'super_admin', 'admin']);

function normalizeRole(role) {
  if (role === 'admin') return 'super_admin';
  if (role === 'director') return 'dealer';
  if (role === 'director_staff') return 'dealer_staff';
  return role;
}

function readDealerId(data) {
  return data?.dealerId ?? data?.directorId ?? null;
}

function resolveDealerIdForUser(uid, role, userData) {
  const normalized = normalizeRole(role);
  if (normalized === 'dealer') return uid;
  if (normalized === 'dealer_staff') {
    const parentId = readDealerId(userData);
    return parentId || uid;
  }
  return null;
}

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
]);

function isAllowedMediaType(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!type) return true;
  return (
    type.startsWith('image/')
    || type.startsWith('video/')
    || type.startsWith('audio/')
    || type === 'application/octet-stream'
    || DOCUMENT_MIME_TYPES.has(type)
  );
}

function safeFileName(name) {
  return String(name ?? 'file').replace(/[^\w.-]+/g, '_').slice(0, 120) || 'file';
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

export async function assertSupportRequestAccess(uid, requestId, options = {}) {
  const { role, data: userData } = await readActiveUser(uid);
  const normalized = normalizeRole(role);

  const reqSnap = await getFirestore().doc(`dealerSupportRequests/${requestId}`).get();
  if (!reqSnap.exists) {
    throw new HttpsError('not-found', 'Support request not found.');
  }

  const req = reqSnap.data();
  if (OPS_ROLES.has(role) || OPS_ROLES.has(normalized)) {
    return { role: normalized, req };
  }

  if (!PORTAL_ROLES.has(role) && !PORTAL_ROLES.has(normalized)) {
    throw new HttpsError('permission-denied', 'You do not have access to this request.');
  }

  const dealerId = resolveDealerIdForUser(uid, role, userData);
  if (req.dealerId !== dealerId && req.createdByUid !== uid) {
    throw new HttpsError('permission-denied', 'You do not have access to this request.');
  }

  if (
    (req.lifecycle === 'draft' || req.status === 'draft')
    && options.isInitial !== true
    && options.forUpload !== true
  ) {
    throw new HttpsError('failed-precondition', 'Submit the draft before uploading evidence.');
  }

  return { role: normalized, req };
}

async function signedReadUrl(storagePath) {
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + READ_TTL_MS,
  });
  return url;
}

function assertValidVideoBuffer(buffer, contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('video/')) return;

  if (buffer.length >= 4
    && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return;
  }

  const scanLength = Math.min(buffer.length - 4, 512);
  for (let i = 0; i <= scanLength; i += 1) {
    if (buffer[i] === 0x66 && buffer[i + 1] === 0x74 && buffer[i + 2] === 0x79 && buffer[i + 3] === 0x70) {
      return;
    }
  }

  throw new HttpsError('invalid-argument', 'Invalid video file. Please record again.');
}

export async function uploadSupportAttachment(uid, input) {
  const requestId = String(input?.requestId ?? '').trim();
  const messageId = String(input?.messageId ?? '').trim();
  const fileName = String(input?.fileName ?? 'file').trim();
  const contentType = String(input?.contentType ?? 'application/octet-stream').trim();
  const fileBase64 = String(input?.fileBase64 ?? '').trim();

  if (!requestId || !messageId || !fileName || !fileBase64) {
    throw new HttpsError('invalid-argument', 'requestId, messageId, fileName, and fileBase64 are required.');
  }

  if (!isAllowedMediaType(contentType)) {
    throw new HttpsError('invalid-argument', 'File type is not allowed.');
  }

  await assertSupportRequestAccess(uid, requestId, {
    isInitial: input?.isInitial === true,
    forUpload: true,
  });

  let buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    throw new HttpsError('invalid-argument', 'Invalid file data.');
  }

  if (!buffer.length || buffer.length > MAX_SERVER_UPLOAD_BYTES) {
    throw new HttpsError(
      'invalid-argument',
      `File must be under ${MAX_SERVER_UPLOAD_BYTES / (1024 * 1024)} MB for server upload.`,
    );
  }

  assertValidVideoBuffer(buffer, contentType);

  const mediaType = contentType.split(';')[0].trim() || 'application/octet-stream';
  const attachmentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const storagePath = `support/${requestId}/${messageId}/${attachmentId}-${safeFileName(fileName)}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: {
      contentType: mediaType,
      metadata: {
        firebaseStorageDownloadTokens: randomUUID(),
      },
    },
  });

  const url = await signedReadUrl(storagePath);

  return {
    attachmentId,
    storagePath,
    url,
    contentType: mediaType,
  };
}

export async function prepareSupportAttachmentUpload(uid, input) {
  const requestId = String(input?.requestId ?? '').trim();
  const messageId = String(input?.messageId ?? '').trim();
  const fileName = String(input?.fileName ?? 'file').trim();
  const contentType = String(input?.contentType ?? 'application/octet-stream').trim();
  const size = Number(input?.size ?? 0);

  if (!requestId || !messageId || !fileName) {
    throw new HttpsError('invalid-argument', 'requestId, messageId, and fileName are required.');
  }

  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    throw new HttpsError('invalid-argument', 'File must be between 1 byte and 52 MB.');
  }

  if (!isAllowedMediaType(contentType)) {
    throw new HttpsError('invalid-argument', 'File type is not allowed.');
  }

  await assertSupportRequestAccess(uid, requestId, {
    isInitial: input?.isInitial === true,
    forUpload: true,
  });

  const attachmentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const storagePath = `support/${requestId}/${messageId}/${attachmentId}-${safeFileName(fileName)}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const mediaType = contentType.split(';')[0].trim() || 'application/octet-stream';

  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + UPLOAD_TTL_MS,
    contentType: mediaType,
  });

  const downloadUrl = await signedReadUrl(storagePath);

  return {
    uploadUrl,
    downloadUrl,
    storagePath,
    attachmentId,
    contentType: mediaType,
  };
}
