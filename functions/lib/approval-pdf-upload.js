import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';

const SETTINGS_DOC = 'appSettings/productSettings';
const MAX_BYTES = 15 * 1024 * 1024;
const PATH_PREFIX = 'productSettings/approvalPdfs/';

function normalizeRole(role) {
  if (role === 'admin') return 'super_admin';
  return role;
}

async function requireSuperAdmin(uid) {
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
  if (role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only super admins can manage approval PDFs.');
  }

  return { role, data };
}

function sanitizeApprovalPathSegment(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || 'approval';
}

function firebaseDownloadUrl(bucketName, storagePath, token) {
  const encoded = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media&token=${token}`;
}

function normalizeApprovalNumbers(values) {
  if (!Array.isArray(values)) return [];

  const byValue = new Map();
  for (const raw of values) {
    if (typeof raw === 'string') {
      const value = raw.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (!byValue.has(key)) byValue.set(key, { value });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const value = String(raw.value ?? raw.label ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    const pdfUrl = typeof raw.pdfUrl === 'string' && raw.pdfUrl.trim()
      ? raw.pdfUrl.trim()
      : null;
    const pdfStoragePath = typeof raw.pdfStoragePath === 'string' && raw.pdfStoragePath.trim()
      ? raw.pdfStoragePath.trim()
      : null;
    const pdfFileName = typeof raw.pdfFileName === 'string' && raw.pdfFileName.trim()
      ? raw.pdfFileName.trim()
      : null;
    byValue.set(key, {
      value,
      ...(pdfUrl ? { pdfUrl } : {}),
      ...(pdfStoragePath ? { pdfStoragePath } : {}),
      ...(pdfFileName ? { pdfFileName } : {}),
    });
  }

  return [...byValue.values()].sort((a, b) =>
    a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }),
  );
}

async function loadApprovalNumbers() {
  const snap = await getFirestore().doc(SETTINGS_DOC).get();
  if (!snap.exists) return [];
  return normalizeApprovalNumbers(snap.data()?.approvalNumbers);
}

async function saveApprovalNumbers(approvalNumbers, updatedBy) {
  const updatedAt = new Date().toISOString();
  await getFirestore().doc(SETTINGS_DOC).set(
    {
      approvalNumbers,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );
  return approvalNumbers;
}

async function deleteStoragePath(storagePath) {
  const path = String(storagePath ?? '').trim();
  if (!path.startsWith(PATH_PREFIX)) return;
  const bucket = getStorage().bucket();
  await bucket.file(path).delete({ ignoreNotFound: true });
}

export async function uploadApprovalNumberPdf(callerUid, input) {
  await requireSuperAdmin(callerUid);

  const approvalValue = String(input?.approvalValue ?? '').trim();
  const fileBase64 = String(input?.fileBase64 ?? '').trim();
  const fileName = String(input?.fileName ?? 'approval.pdf').trim().slice(0, 180) || 'approval.pdf';
  const contentType = String(input?.contentType ?? 'application/pdf').split(';')[0].trim().toLowerCase()
    || 'application/pdf';

  if (!approvalValue) {
    throw new HttpsError('invalid-argument', 'Approval number is required.');
  }
  if (!fileBase64) {
    throw new HttpsError('invalid-argument', 'PDF data is required.');
  }
  if (
    contentType !== 'application/pdf'
    && contentType !== 'application/x-pdf'
    && contentType !== 'application/octet-stream'
    && !fileName.toLowerCase().endsWith('.pdf')
  ) {
    throw new HttpsError('invalid-argument', 'Only PDF files are allowed.');
  }

  let buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    throw new HttpsError('invalid-argument', 'Invalid PDF data.');
  }

  if (!buffer.length || buffer.length > MAX_BYTES) {
    throw new HttpsError('invalid-argument', 'PDF must be between 1 byte and 15 MB.');
  }

  const approvalNumbers = await loadApprovalNumbers();
  const existing = approvalNumbers.find(
    option => option.value.toLowerCase() === approvalValue.toLowerCase(),
  );
  if (!existing) {
    throw new HttpsError('not-found', `Approval number "${approvalValue}" was not found.`);
  }

  if (existing.pdfStoragePath) {
    await deleteStoragePath(existing.pdfStoragePath);
  }

  const stamp = Date.now();
  const storagePath = `${PATH_PREFIX}${sanitizeApprovalPathSegment(approvalValue)}-${stamp}.pdf`;
  const token = randomUUID();
  const bucket = getStorage().bucket();

  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: 'application/pdf',
      metadata: {
        firebaseStorageDownloadTokens: token,
        uploadedByUid: callerUid,
        approvalNumber: approvalValue.slice(0, 120),
      },
    },
  });

  const pdfUrl = firebaseDownloadUrl(bucket.name, storagePath, token);
  const next = approvalNumbers.map(option => (
    option.value.toLowerCase() === approvalValue.toLowerCase()
      ? {
          value: option.value,
          pdfUrl,
          pdfStoragePath: storagePath,
          pdfFileName: fileName,
        }
      : option
  ));

  return {
    approvalNumbers: await saveApprovalNumbers(next, callerUid),
  };
}

export async function removeApprovalNumberPdf(callerUid, input) {
  await requireSuperAdmin(callerUid);

  const approvalValue = String(input?.approvalValue ?? '').trim();
  if (!approvalValue) {
    throw new HttpsError('invalid-argument', 'Approval number is required.');
  }

  const approvalNumbers = await loadApprovalNumbers();
  const existing = approvalNumbers.find(
    option => option.value.toLowerCase() === approvalValue.toLowerCase(),
  );
  if (!existing) {
    throw new HttpsError('not-found', `Approval number "${approvalValue}" was not found.`);
  }

  if (existing.pdfStoragePath) {
    await deleteStoragePath(existing.pdfStoragePath);
  }

  const next = approvalNumbers.map(option => (
    option.value.toLowerCase() === approvalValue.toLowerCase()
      ? { value: option.value }
      : option
  ));

  return {
    approvalNumbers: await saveApprovalNumbers(next, callerUid),
  };
}

/** Best-effort Storage delete when an approval number row is removed. */
export async function deleteApprovalPdfObject(callerUid, input) {
  await requireSuperAdmin(callerUid);
  const storagePath = String(input?.storagePath ?? '').trim();
  if (!storagePath) {
    return { deleted: false };
  }
  if (!storagePath.startsWith(PATH_PREFIX)) {
    throw new HttpsError('invalid-argument', 'Invalid approval PDF path.');
  }
  await deleteStoragePath(storagePath);
  return { deleted: true };
}
