import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, storage } from '../firebase';
import { compressImageForUpload } from './compressImage';
import type { HrDocumentType, StaffHrProfile } from '../types/staff-hr';
import type { FirestoreUserDoc } from '../types';
import { formatStorageUploadError } from './storageErrors';

const functions = getFunctions(app, 'asia-south1');

const MAX_DOC_BYTES = 15 * 1024 * 1024;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function hrPhotoPath(userId: string, ext = 'jpg'): string {
  return `hr/${userId}/photo.${ext}`;
}

export function hrDocumentPath(userId: string, docType: HrDocumentType, ext: string): string {
  return `hr/${userId}/documents/${docType}.${ext}`;
}

function extFromFile(file: File): string {
  const name = file.name.split('.').pop()?.toLowerCase();
  if (name && ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(name)) {
    return name === 'jpeg' ? 'jpg' : name;
  }
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type.startsWith('image/')) return file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  return 'pdf';
}

async function fileToBase64(file: File, maxBytes: number): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error(`File must be under ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read file.'));
        return;
      }
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('Could not read file.'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function isCallableUnavailable(err: unknown): boolean {
  const code = typeof err === 'object' && err && 'code' in err
    ? String((err as { code?: string }).code ?? '')
    : '';
  return code === 'functions/not-found'
    || code === 'functions/unavailable'
    || code === 'functions/deadline-exceeded';
}

function callableErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '');
    if (message && !message.includes('FirebaseError')) return message;
  }
  return fallback;
}

export function hrUploadErrorMessage(err: unknown, fallback: string): string {
  return formatStorageUploadError(
    err,
    callableErrorMessage(err, fallback),
    'Could not upload file. Sign out, sign back in, and try again.',
  );
}

const HR_PHOTO_EXTENSIONS = ['jpg', 'png', 'webp', 'gif'] as const;

export type HrPhotoUploadResult = {
  url: string;
  storagePath: string;
};

export function hrPhotoStoragePathFromRecord(
  data: Pick<FirestoreUserDoc, 'hrPhotoStoragePath' | 'hrPhotoUrl'>,
): string | null {
  const stored = data.hrPhotoStoragePath?.trim();
  if (stored?.startsWith('hr/')) return stored;

  const legacy = data.hrPhotoUrl?.trim();
  if (legacy?.startsWith('hr/')) return legacy;

  return null;
}

function isSignedStorageUrl(url: string): boolean {
  return url.includes('X-Goog-Signature') || url.includes('GoogleAccessId=');
}

async function probeHrPhotoUrl(userId: string): Promise<string | null> {
  for (const ext of HR_PHOTO_EXTENSIONS) {
    try {
      return await getHrFileUrl(hrPhotoPath(userId, ext));
    } catch {
      // try next extension
    }
  }
  return null;
}

export async function resolveHrPhotoUrl(
  userId: string,
  data: Pick<FirestoreUserDoc, 'hrPhotoStoragePath' | 'hrPhotoUrl'>,
): Promise<string | null> {
  const storagePath = hrPhotoStoragePathFromRecord(data);
  if (storagePath) {
    try {
      return await getHrFileUrl(storagePath);
    } catch {
      // fall through to legacy / probe
    }
  }

  const legacyUrl = data.hrPhotoUrl?.trim();
  if (legacyUrl?.startsWith('https://')) {
    if (isSignedStorageUrl(legacyUrl)) {
      const probed = await probeHrPhotoUrl(userId);
      if (probed) return probed;
    }
    return legacyUrl;
  }

  if (legacyUrl || storagePath) {
    return probeHrPhotoUrl(userId);
  }

  return null;
}

async function uploadHrPhotoViaFunction(userId: string, file: File): Promise<HrPhotoUploadResult> {
  const compressed = await compressImageForUpload(file);
  const callable = httpsCallable<
    {
      staffUserId: string;
      kind: 'photo';
      contentType: string;
      fileBase64: string;
      fileName: string;
    },
    { url: string; storagePath: string }
  >(functions, 'uploadHrStaffFileFn', { timeout: 120_000 });

  const result = await callable({
    staffUserId: userId,
    kind: 'photo',
    contentType: compressed.type || 'image/jpeg',
    fileBase64: await fileToBase64(compressed, MAX_PHOTO_BYTES),
    fileName: compressed.name,
  });
  return {
    url: result.data.url,
    storagePath: result.data.storagePath,
  };
}

async function uploadHrDocumentViaFunction(
  userId: string,
  docType: HrDocumentType,
  file: File,
): Promise<{ storagePath: string; uploadedAt: string; fileName: string }> {
  const callable = httpsCallable<
    {
      staffUserId: string;
      kind: 'document';
      documentType: HrDocumentType;
      contentType: string;
      fileBase64: string;
      fileName: string;
    },
    { storagePath: string; uploadedAt: string; fileName: string }
  >(functions, 'uploadHrStaffFileFn', { timeout: 120_000 });

  const result = await callable({
    staffUserId: userId,
    kind: 'document',
    documentType: docType,
    contentType: file.type || 'application/octet-stream',
    fileBase64: await fileToBase64(file, MAX_DOC_BYTES),
    fileName: file.name,
  });
  return {
    storagePath: result.data.storagePath,
    uploadedAt: result.data.uploadedAt,
    fileName: result.data.fileName,
  };
}

async function uploadHrPhotoViaClient(userId: string, file: File): Promise<HrPhotoUploadResult> {
  const ext = extFromFile(file);
  const path = hrPhotoPath(userId, ext);
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return {
    url: await getDownloadURL(storageRef),
    storagePath: path,
  };
}

async function uploadHrDocumentViaClient(
  userId: string,
  docType: HrDocumentType,
  file: File,
): Promise<{ storagePath: string; uploadedAt: string; fileName: string }> {
  const ext = extFromFile(file);
  const path = hrDocumentPath(userId, docType, ext);
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return {
    storagePath: path,
    uploadedAt: new Date().toISOString(),
    fileName: file.name,
  };
}

export async function uploadHrPhoto(userId: string, file: File): Promise<HrPhotoUploadResult> {
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Photo must be under 5 MB.');
  if (!file.type.startsWith('image/')) throw new Error('Photo must be an image.');

  try {
    return await uploadHrPhotoViaFunction(userId, file);
  } catch (err) {
    if (!isCallableUnavailable(err)) {
      throw new Error(hrUploadErrorMessage(err, 'Could not upload photo.'));
    }
    try {
      const compressed = await compressImageForUpload(file);
      return await uploadHrPhotoViaClient(userId, compressed);
    } catch (clientErr) {
      throw new Error(hrUploadErrorMessage(clientErr, 'Could not upload photo.'));
    }
  }
}

export async function uploadHrDocument(
  userId: string,
  docType: HrDocumentType,
  file: File,
): Promise<{ storagePath: string; uploadedAt: string; fileName: string }> {
  if (file.size > MAX_DOC_BYTES) throw new Error('Document must be under 15 MB.');
  const allowed =
    file.type === 'application/pdf'
    || file.type.startsWith('image/');
  if (!allowed) throw new Error('Upload PDF or image files only.');

  try {
    return await uploadHrDocumentViaFunction(userId, docType, file);
  } catch (err) {
    if (!isCallableUnavailable(err)) {
      throw new Error(hrUploadErrorMessage(err, 'Could not upload document.'));
    }
    try {
      return await uploadHrDocumentViaClient(userId, docType, file);
    } catch (clientErr) {
      throw new Error(hrUploadErrorMessage(clientErr, 'Could not upload document.'));
    }
  }
}

async function getHrFileUrlViaFunction(storagePath: string): Promise<string> {
  const callable = httpsCallable<{ storagePath: string }, { url: string }>(
    functions,
    'getHrStaffFileUrlFn',
    { timeout: 60_000 },
  );
  const result = await callable({ storagePath });
  return result.data.url;
}

export async function getHrFileUrl(storagePath: string): Promise<string> {
  try {
    return await getHrFileUrlViaFunction(storagePath);
  } catch (err) {
    if (!isCallableUnavailable(err)) {
      try {
        return await getDownloadURL(ref(storage, storagePath));
      } catch {
        throw new Error(hrUploadErrorMessage(err, 'Could not load file.'));
      }
    }
    try {
      return await getDownloadURL(ref(storage, storagePath));
    } catch (clientErr) {
      throw new Error(hrUploadErrorMessage(clientErr, 'Could not load file.'));
    }
  }
}

export async function deleteHrStorageFile(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath));
  } catch {
    // ignore missing files
  }
}

export function readHrProfileFromDoc(data: FirestoreUserDoc): StaffHrProfile {
  return {
    hrPhotoUrl: data.hrPhotoUrl ?? null,
    hrPhotoStoragePath: data.hrPhotoStoragePath ?? null,
    hrResidentialAddress: data.hrResidentialAddress ?? null,
    hrPostalCode: data.hrPostalCode ?? null,
    hrBloodGroup: data.hrBloodGroup ?? null,
    hrPoliceStation: data.hrPoliceStation ?? null,
    hrEmergencyContactName: data.hrEmergencyContactName ?? null,
    hrEmergencyContactRelationship: data.hrEmergencyContactRelationship ?? null,
    hrEmergencyContactPhone: data.hrEmergencyContactPhone ?? null,
    hrJoinDate: data.hrJoinDate ?? null,
    hrEmployeeId: data.hrEmployeeId ?? null,
    hrDesignation: data.hrDesignation ?? null,
    hrDocuments: data.hrDocuments ?? {},
  };
}

export function hrProfileToFirestorePatch(profile: StaffHrProfile): Record<string, unknown> {
  return {
    hrPhotoUrl: profile.hrPhotoUrl ?? null,
    hrPhotoStoragePath: profile.hrPhotoStoragePath ?? null,
    hrResidentialAddress: profile.hrResidentialAddress?.trim() || null,
    hrPostalCode: profile.hrPostalCode?.trim() || null,
    hrBloodGroup: profile.hrBloodGroup || null,
    hrPoliceStation: profile.hrPoliceStation?.trim() || null,
    hrEmergencyContactName: profile.hrEmergencyContactName?.trim() || null,
    hrEmergencyContactRelationship: profile.hrEmergencyContactRelationship?.trim() || null,
    hrEmergencyContactPhone: profile.hrEmergencyContactPhone?.trim() || null,
    hrJoinDate: profile.hrJoinDate || null,
    hrEmployeeId: profile.hrEmployeeId?.trim() || null,
    hrDesignation: profile.hrDesignation?.trim() || null,
    hrDocuments: profile.hrDocuments ?? {},
  };
}

export function formatAadharDisplay(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 12) return value ?? '—';
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
}

export function formatJoinDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = Date.parse(value);
  if (Number.isNaN(d)) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(d));
}
