import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { collection, doc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, db, app, storage } from '../../firebase';
import { compressImageForUpload } from '../compressImage';
import { formatStorageUploadError } from '../storageErrors';
import type { YesStorePhoto } from '../../types/yes-store';

const functions = getFunctions(app, 'asia-south1');
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const YES_STORE_PATH_RE = /^yesStore\/(rack|row|bin|item)\/[^/]+\/[^/]+$/;

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const resolvedUrlCache = new Map<string, { url: string; at: number }>();
const RESOLVED_URL_CACHE_MS = 55 * 60 * 1000;

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

/** Recover storage path from Firestore when only an old signed URL was saved. */
export function inferYesStoreStoragePath(
  photo: Pick<YesStorePhoto, 'storagePath' | 'url'>,
): string | null {
  const direct = photo.storagePath?.trim();
  if (direct && YES_STORE_PATH_RE.test(direct)) return direct;

  const url = photo.url?.trim() ?? '';
  if (!url) return null;

  const gcs = /storage\.googleapis\.com\/[^/]+\/(yesStore\/[^?]+)/i.exec(url);
  if (gcs?.[1]) return decodeURIComponent(gcs[1]);

  const fb = /firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/i.exec(url);
  if (fb?.[1]) return decodeURIComponent(fb[1].replace(/\+/g, ' '));

  return null;
}

function isUsableLegacyPhotoUrl(url: string): boolean {
  if (/X-Goog-Algorithm=/i.test(url)) return false;
  if (/storage\.googleapis\.com/i.test(url) && !/token=/i.test(url)) return false;
  return true;
}

function storagePathForPhoto(level: string, parentId: string, photoId: string, ext: string): string {
  return `yesStore/${level}/${parentId}/${photoId}.${ext}`;
}

async function ensureSignedIn(): Promise<void> {
  await auth.authStateReady();
  if (!auth.currentUser) {
    throw new Error('Sign in required.');
  }
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
  const storagePath = inferYesStoreStoragePath(photo);
  if (!storagePath) return;
  await deleteObject(ref(storage, storagePath)).catch(() => undefined);
}

export async function deleteYesStorePhotos(photos: YesStorePhoto[]): Promise<void> {
  await Promise.all(photos.map(photo => deleteYesStorePhotoFile(photo)));
}

async function refreshYesStorePhotoUrlViaFunction(storagePath: string): Promise<string> {
  const callable = httpsCallable<{ storagePath: string }, { url: string }>(
    functions,
    'getYesStorePhotoUrlFn',
    { timeout: 60_000 },
  );
  const result = await callable({ storagePath });
  return result.data.url;
}

async function resolveFromStoragePath(storagePath: string): Promise<string> {
  const cached = resolvedUrlCache.get(storagePath);
  if (cached && Date.now() - cached.at < RESOLVED_URL_CACHE_MS) {
    return cached.url;
  }

  let url: string;
  try {
    url = await refreshYesStorePhotoUrlViaFunction(storagePath);
  } catch (fnErr) {
    if (!isCallableUnavailable(fnErr)) {
      await ensureSignedIn();
      try {
        url = await getDownloadURL(ref(storage, storagePath));
      } catch {
        throw fnErr;
      }
    } else {
      await ensureSignedIn();
      url = await getDownloadURL(ref(storage, storagePath));
    }
  }

  resolvedUrlCache.set(storagePath, { url, at: Date.now() });
  return url;
}

/** Resolve a display URL from storagePath — never returns expired GCS signed URLs from Firestore. */
export async function resolveYesStorePhotoUrl(photo: YesStorePhoto): Promise<string> {
  const storagePath = inferYesStoreStoragePath(photo);
  if (storagePath) {
    return resolveFromStoragePath(storagePath);
  }

  const legacy = photo.url?.trim();
  if (legacy && isUsableLegacyPhotoUrl(legacy)) {
    return legacy;
  }

  throw new Error('Photo unavailable.');
}

export async function resolveYesStorePhotoUrls(photos: YesStorePhoto[]): Promise<string[]> {
  return Promise.all(photos.map(photo => resolveYesStorePhotoUrl(photo)));
}
