import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { storage } from '../firebase';
import type { HrDocumentType, StaffHrProfile } from '../types/staff-hr';
import type { FirestoreUserDoc } from '../types';
import { formatStorageUploadError } from './storageErrors';

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

export function hrUploadErrorMessage(err: unknown, fallback: string): string {
  return formatStorageUploadError(
    err,
    fallback,
    'Could not upload file. Sign out, sign back in, and try again.',
  );
}

export async function uploadHrPhoto(userId: string, file: File): Promise<string> {
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Photo must be under 5 MB.');
  if (!file.type.startsWith('image/')) throw new Error('Photo must be an image.');
  const ext = extFromFile(file);
  const path = hrPhotoPath(userId, ext);
  const storageRef = ref(storage, path);
  try {
    await uploadBytes(storageRef, file, { contentType: file.type });
    return getDownloadURL(storageRef);
  } catch (err) {
    throw new Error(hrUploadErrorMessage(err, 'Could not upload photo.'));
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
  const ext = extFromFile(file);
  const path = hrDocumentPath(userId, docType, ext);
  const storageRef = ref(storage, path);
  try {
    await uploadBytes(storageRef, file, { contentType: file.type });
  } catch (err) {
    throw new Error(hrUploadErrorMessage(err, 'Could not upload document.'));
  }
  return {
    storagePath: path,
    uploadedAt: new Date().toISOString(),
    fileName: file.name,
  };
}

export async function getHrFileUrl(storagePath: string): Promise<string> {
  return getDownloadURL(ref(storage, storagePath));
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
