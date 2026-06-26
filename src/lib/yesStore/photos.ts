import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { collection, doc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, app, storage } from '../../firebase';
import { compressImageForUpload } from '../compressImage';
import { formatStorageUploadError } from '../storageErrors';
import type { YesStorePhoto } from '../../types/yes-store';

const functions = getFunctions(app, 'asia-south1');
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function extFromFile(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/gif') return 'gif';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/heic' || file.type === 'image/heif') return 'heic';
  return 'jpg';
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

function uploadErrorMessage(err: unknown, fallback: string): string {
  return formatStorageUploadError(
    err,
    err instanceof Error ? err.message : fallback,
    'Could not upload photo. Sign out, sign back in, and try again.',
  );
}

export function validateYesStoreImage(file: File): string | null {
  if (file.size > MAX_PHOTO_BYTES) return 'Image must be under 12 MB.';
  if (file.type && !ALLOWED_TYPES.has(file.type) && !file.type.startsWith('image/')) {
    return 'Upload a standard image file (JPEG, PNG, GIF, WebP, HEIC).';
  }
  return null;
}

function storagePathForPhoto(level: string, parentId: string, photoId: string, ext: string): string {
  return `yesStore/${level}/${parentId}/${photoId}.${ext}`;
}

async function uploadYesStorePhotoViaFunction(
  level: string,
  parentId: string,
  photoId: string,
  file: File,
): Promise<YesStorePhoto> {
  const compressed = await compressImageForUpload(file);
  const callable = httpsCallable<
    {
      level: string;
      parentId: string;
      photoId: string;
      contentType: string;
      fileBase64: string;
      fileName: string;
    },
    YesStorePhoto
  >(functions, 'uploadYesStorePhotoFn', { timeout: 120_000 });

  const result = await callable({
    level,
    parentId,
    photoId,
    contentType: compressed.type || 'image/jpeg',
    fileBase64: await fileToBase64(compressed, MAX_PHOTO_BYTES),
    fileName: compressed.name || file.name,
  });
  return result.data;
}

async function uploadYesStorePhotoViaClient(
  level: string,
  parentId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<YesStorePhoto> {
  const photoId = doc(collection(db, 'yesStoreItems')).id;
  const ext = extFromFile(file);
  const storagePath = storagePathForPhoto(level, parentId, photoId, ext);
  const storageRef = ref(storage, storagePath);

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || 'image/jpeg',
    });
    task.on(
      'state_changed',
      snap => {
        if (onProgress && snap.totalBytes > 0) {
          onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      reject,
      () => resolve(),
    );
  });

  const url = await getDownloadURL(storageRef);
  return {
    id: photoId,
    url,
    storagePath,
    fileName: file.name,
    uploadedAt: new Date().toISOString(),
  };
}

export async function uploadYesStorePhoto(
  level: string,
  parentId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<YesStorePhoto> {
  const err = validateYesStoreImage(file);
  if (err) throw new Error(err);

  const photoId = doc(collection(db, 'yesStoreItems')).id;

  try {
    if (onProgress) onProgress(5);
    const photo = await uploadYesStorePhotoViaFunction(level, parentId, photoId, file);
    if (onProgress) onProgress(100);
    return photo;
  } catch (fnErr) {
    if (!isCallableUnavailable(fnErr)) {
      throw new Error(uploadErrorMessage(fnErr, 'Could not upload photo.'));
    }
    try {
      const compressed = await compressImageForUpload(file);
      return await uploadYesStorePhotoViaClient(level, parentId, compressed, onProgress);
    } catch (clientErr) {
      throw new Error(uploadErrorMessage(clientErr, 'Could not upload photo.'));
    }
  }
}

export async function deleteYesStorePhotoFile(photo: YesStorePhoto): Promise<void> {
  if (!photo.storagePath) return;
  await deleteObject(ref(storage, photo.storagePath)).catch(() => undefined);
}

export async function deleteYesStorePhotos(photos: YesStorePhoto[]): Promise<void> {
  await Promise.all(photos.map(photo => deleteYesStorePhotoFile(photo)));
}
