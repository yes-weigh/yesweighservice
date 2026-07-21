import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, storage } from '../firebase';
import { compressImageForUpload } from './compressImage';
import { formatStorageUploadError } from './storageErrors';

const functions = getFunctions(app, 'asia-south1');
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const resolvedUrlCache = new Map<string, { url: string; at: number }>();
const RESOLVED_URL_CACHE_MS = 55 * 60 * 1000;

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
): Promise<{ storagePath: string; url: string | null }> {
  const callable = httpsCallable<
    {
      bookingId: string;
      slot: string;
      contentType: string;
      fileBase64: string;
      fileName: string;
    },
    { storagePath: string; url?: string }
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
  const url = String(result.data?.url ?? '').trim() || null;
  if (url) {
    resolvedUrlCache.set(storagePath, { url, at: Date.now() });
  }
  return { storagePath, url };
}

async function uploadLogisticsPhotoViaClient(
  bookingId: string,
  slot: string,
  file: File,
): Promise<{ storagePath: string; url: string | null }> {
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extFromFile(file)}`;
  const storagePath = logisticsPhotoStoragePath(bookingId, slot, fileName);
  await uploadBytes(ref(storage, storagePath), file, {
    contentType: file.type || 'image/jpeg',
  });
  return { storagePath, url: null };
}

/** Capture defaults: small JPEG, no GPS/time overlay — keeps Next/upload snappy. */
export const LOGISTICS_PHOTO_COMPRESS = {
  maxWidth: 960,
  maxHeight: 960,
  quality: 0.7,
  maxBytes: 280_000,
} as const;

/** Resize camera capture to a compact data URL (no stamp / GPS wait). */
export async function logisticsCaptureToDataUrl(file: File): Promise<string> {
  const compressed = await compressImageForUpload(file, { ...LOGISTICS_PHOTO_COMPRESS });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read photo.'));
    };
    reader.onerror = () => reject(new Error('Could not read photo.'));
    reader.readAsDataURL(compressed);
  });
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
  const compressed = await compressImageForUpload(file, { ...LOGISTICS_PHOTO_COMPRESS });

  try {
    const uploaded = await uploadLogisticsPhotoViaFunction(bookingId, slot, compressed);
    return uploaded.storagePath;
  } catch (fnErr) {
    if (!isCallableUnavailable(fnErr)) {
      throw new Error(formatStorageUploadError(
        fnErr,
        'Could not upload photo.',
        'Could not upload photo. Sign out, sign back in, and try again.',
      ));
    }
    try {
      const uploaded = await uploadLogisticsPhotoViaClient(bookingId, slot, compressed);
      return uploaded.storagePath;
    } catch (clientErr) {
      throw new Error(formatStorageUploadError(
        clientErr,
        'Could not upload photo.',
        'Could not upload photo. Sign out, sign back in, and try again.',
      ));
    }
  }
}

async function resolveViaFunction(storagePath: string): Promise<string> {
  const callable = httpsCallable<
    { storagePath: string },
    { url: string }
  >(functions, 'getLogisticsPhotoUrlFn', { timeout: 60_000 });
  const result = await callable({ storagePath });
  const url = String(result.data?.url ?? '').trim();
  if (!url) throw new Error('Could not resolve photo URL.');
  return url;
}

async function resolveLogisticsPhotoUrlUncached(path: string): Promise<string | null> {
  try {
    const url = await resolveViaFunction(path);
    resolvedUrlCache.set(path, { url, at: Date.now() });
    return url;
  } catch (fnErr) {
    if (!isCallableUnavailable(fnErr)) {
      // Fall through to client getDownloadURL for environments without the callable.
    }
    try {
      const url = await getDownloadURL(ref(storage, path));
      resolvedUrlCache.set(path, { url, at: Date.now() });
      return url;
    } catch {
      return null;
    }
  }
}

export async function resolveLogisticsPhotoUrl(storagePath: string | null | undefined): Promise<string | null> {
  const path = storagePath?.trim();
  if (!path) return null;

  const cached = resolvedUrlCache.get(path);
  if (cached && Date.now() - cached.at < RESOLVED_URL_CACHE_MS) {
    return cached.url;
  }

  await ensureSignedIn().catch(() => undefined);
  return resolveLogisticsPhotoUrlUncached(path);
}

/** Resolve many storage paths with one auth check; results keyed by path. */
export async function resolveLogisticsPhotoUrls(
  storagePaths: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(
    storagePaths
      .map(path => path?.trim() ?? '')
      .filter(Boolean),
  ));
  const result = new Map<string, string | null>();
  if (!unique.length) return result;

  const missing: string[] = [];
  for (const path of unique) {
    const cached = resolvedUrlCache.get(path);
    if (cached && Date.now() - cached.at < RESOLVED_URL_CACHE_MS) {
      result.set(path, cached.url);
    } else {
      missing.push(path);
    }
  }

  if (!missing.length) return result;

  await ensureSignedIn().catch(() => undefined);
  const resolved = await Promise.all(
    missing.map(async path => [path, await resolveLogisticsPhotoUrlUncached(path)] as const),
  );
  for (const [path, url] of resolved) {
    result.set(path, url);
  }
  return result;
}

export async function deleteLogisticsPhoto(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath?.trim()) return;
  resolvedUrlCache.delete(storagePath.trim());
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
