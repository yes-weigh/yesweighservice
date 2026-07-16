import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, storage } from '../firebase';
import { compressImageForUpload } from './compressImage';
import { formatStorageUploadError } from './storageErrors';

const functions = getFunctions(app, 'asia-south1');
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
  // Nested path — matches storage.rules `logistics/{bookingId}/{slot}/{fileName}`
  const safeSlot = slot.replace(/[^\w\-]+/g, '-').slice(0, 80) || 'photo';
  const safeName = fileName.replace(/[^\w.\-]+/g, '-').slice(0, 120) || 'photo.jpg';
  return `logistics/${bookingId}/${safeSlot}/${safeName}`;
}

async function ensureSignedIn(): Promise<void> {
  await auth.authStateReady();
  if (!auth.currentUser) {
    throw new Error('Sign in required.');
  }
  await auth.currentUser.getIdToken();
}

async function fileToBase64(file: File, maxBytes: number): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error(`Image must be under ${Math.round(maxBytes / (1024 * 1024))} MB.`);
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

async function uploadLogisticsPhotoViaFunction(
  bookingId: string,
  slot: string,
  file: File,
): Promise<string> {
  const callable = httpsCallable<
    {
      bookingId: string;
      slot: string;
      contentType: string;
      fileBase64: string;
      fileName: string;
    },
    { storagePath: string }
  >(functions, 'uploadLogisticsPhotoFn', { timeout: 120_000 });

  const result = await callable({
    bookingId,
    slot,
    contentType: file.type || 'image/jpeg',
    fileBase64: await fileToBase64(file, MAX_PHOTO_BYTES),
    fileName: file.name,
  });
  const storagePath = String(result.data?.storagePath ?? '').trim();
  if (!storagePath) {
    throw new Error('Could not upload photo.');
  }
  return storagePath;
}

async function uploadLogisticsPhotoViaClient(
  bookingId: string,
  slot: string,
  file: File,
): Promise<string> {
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extFromFile(file)}`;
  const storagePath = logisticsPhotoStoragePath(bookingId, slot, fileName);
  await uploadBytes(ref(storage, storagePath), file, {
    contentType: file.type || 'image/jpeg',
  });
  return storagePath;
}

export async function uploadLogisticsPhoto(
  bookingId: string,
  slot: string,
  file: File,
): Promise<string> {
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('Image must be under 12 MB.');
  }
  await ensureSignedIn();
  const compressed = await compressImageForUpload(file, { maxBytes: 900_000 });

  try {
    return await uploadLogisticsPhotoViaFunction(bookingId, slot, compressed);
  } catch (fnErr) {
    if (!isCallableUnavailable(fnErr)) {
      throw new Error(formatStorageUploadError(
        fnErr,
        'Could not upload photo.',
        'Could not upload photo. Sign out, sign back in, and try again.',
      ));
    }
    try {
      return await uploadLogisticsPhotoViaClient(bookingId, slot, compressed);
    } catch (clientErr) {
      throw new Error(formatStorageUploadError(
        clientErr,
        'Could not upload photo.',
        'Could not upload photo. Sign out, sign back in, and try again.',
      ));
    }
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
