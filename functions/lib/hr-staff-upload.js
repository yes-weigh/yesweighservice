import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';

const READ_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_DOC_BYTES = 15 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_DOC_TYPES = new Set([...ALLOWED_IMAGE_TYPES, 'application/pdf']);

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

function staffUsesExplicitPermissions(userData) {
  const mode = userData?.staffAccessMode;
  const perms = userData?.staffPermissions;
  return (mode === 'custom' || mode === 'role')
    && Array.isArray(perms)
    && perms.length > 0;
}

function staffHasHrManage(userData) {
  if (staffUsesExplicitPermissions(userData)) {
    return Array.isArray(userData.staffPermissions) && userData.staffPermissions.includes('hr.manage');
  }
  return userData?.staffDepartment === 'admin';
}

function staffHasHrView(userData) {
  if (staffHasHrManage(userData)) return true;
  if (staffUsesExplicitPermissions(userData)) {
    return Array.isArray(userData.staffPermissions) && userData.staffPermissions.includes('hr.view');
  }
  return userData?.staffDepartment === 'admin';
}

export async function requireHrManageUser(uid) {
  const { role, data } = await readActiveUser(uid);
  if (role === 'super_admin') return { role, data };
  if (role !== 'staff' || !staffHasHrManage(data)) {
    throw new HttpsError('permission-denied', 'You do not have HR manage access.');
  }
  return { role, data };
}

async function requireHrFileReadAccess(uid, storagePath) {
  const match = /^hr\/([^/]+)\//.exec(storagePath);
  if (!match) {
    throw new HttpsError('invalid-argument', 'Invalid HR storage path.');
  }
  const targetUserId = match[1];
  const { role, data } = await readActiveUser(uid);
  if (role === 'super_admin' || uid === targetUserId) return;
  if (role === 'staff' && staffHasHrView(data)) return;
  throw new HttpsError('permission-denied', 'You do not have access to this file.');
}

async function assertStaffTarget(staffUserId) {
  const snap = await getFirestore().doc(`users/${staffUserId}`).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Staff member not found.');
  }
  const role = normalizeRole(String(snap.data()?.role ?? ''));
  if (role !== 'staff') {
    throw new HttpsError('invalid-argument', 'Target must be a staff account.');
  }
}

function extFromContentType(contentType, fileName) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  if (type === 'application/pdf') return 'pdf';
  const lower = String(fileName ?? '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.webp')) return 'webp';
  if (lower.endsWith('.gif')) return 'gif';
  return 'jpg';
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

export async function uploadHrStaffFile(callerUid, input) {
  await requireHrManageUser(callerUid);

  const staffUserId = String(input?.staffUserId ?? '').trim();
  const kind = String(input?.kind ?? 'photo').trim();
  const documentType = String(input?.documentType ?? '').trim();
  const contentType = String(input?.contentType ?? 'image/jpeg').trim();
  const fileBase64 = String(input?.fileBase64 ?? '').trim();
  const fileName = String(input?.fileName ?? 'file').trim();

  if (!staffUserId || !fileBase64) {
    throw new HttpsError('invalid-argument', 'staffUserId and fileBase64 are required.');
  }

  await assertStaffTarget(staffUserId);

  let buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    throw new HttpsError('invalid-argument', 'Invalid file data.');
  }

  const maxBytes = kind === 'photo' ? MAX_PHOTO_BYTES : MAX_DOC_BYTES;
  if (!buffer.length || buffer.length > maxBytes) {
    throw new HttpsError('invalid-argument', `File must be under ${maxBytes / (1024 * 1024)} MB.`);
  }

  const mediaType = contentType.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  if (kind === 'photo') {
    if (!mediaType.startsWith('image/')) {
      throw new HttpsError('invalid-argument', 'Photo must be an image.');
    }
    if (!ALLOWED_IMAGE_TYPES.has(mediaType)) {
      throw new HttpsError('invalid-argument', 'Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
    }
  } else if (!ALLOWED_DOC_TYPES.has(mediaType)) {
    throw new HttpsError('invalid-argument', 'Upload PDF or image files only.');
  }

  const ext = extFromContentType(mediaType, fileName);
  let storagePath;
  if (kind === 'photo') {
    storagePath = `hr/${staffUserId}/photo.${ext}`;
  } else {
    if (!documentType) {
      throw new HttpsError('invalid-argument', 'documentType is required for documents.');
    }
    storagePath = `hr/${staffUserId}/documents/${documentType}.${ext}`;
  }

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

  if (kind === 'photo') {
    return { url, storagePath };
  }

  return {
    storagePath,
    fileName,
    uploadedAt: new Date().toISOString(),
    url,
  };
}

export async function getHrStaffFileUrl(callerUid, input) {
  const storagePath = String(input?.storagePath ?? '').trim();
  if (!storagePath.startsWith('hr/')) {
    throw new HttpsError('invalid-argument', 'storagePath is required.');
  }
  await requireHrFileReadAccess(callerUid, storagePath);
  const url = await signedReadUrl(storagePath);
  return { url };
}
