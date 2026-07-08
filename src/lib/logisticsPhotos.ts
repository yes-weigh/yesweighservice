import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import { compressImageForUpload } from './compressImage';
import { formatStorageUploadError } from './storageErrors';

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

function extFromFile(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

export function logisticsPhotoStoragePath(
  bookingId: string,
  slot: string,
  fileName: string,
): string {
  return `logistics/${bookingId}/${slot}/${fileName}`;
}

export async function uploadLogisticsPhoto(
  bookingId: string,
  slot: string,
  file: File,
): Promise<string> {
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('Image must be under 12 MB.');
  }
  const compressed = await compressImageForUpload(file, { maxBytes: 900_000 });
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extFromFile(compressed)}`;
  const storagePath = logisticsPhotoStoragePath(bookingId, slot, fileName);
  try {
    await uploadBytes(ref(storage, storagePath), compressed, {
      contentType: compressed.type || 'image/jpeg',
    });
    return storagePath;
  } catch (err) {
    throw new Error(formatStorageUploadError(
      err,
      'Could not upload photo.',
      'Could not upload photo. Sign out, sign back in, and try again.',
    ));
  }
}

export async function resolveLogisticsPhotoUrl(storagePath: string | null | undefined): Promise<string | null> {
  if (!storagePath?.trim()) return null;
  try {
    return await getDownloadURL(ref(storage, storagePath));
  } catch {
    return null;
  }
}

export async function deleteLogisticsPhoto(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath?.trim()) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch {
    // ignore missing objects
  }
}

export async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
}
