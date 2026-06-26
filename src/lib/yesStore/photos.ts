import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { collection, doc } from 'firebase/firestore';
import { db, storage } from '../../firebase';
import type { YesStorePhoto } from '../../types/yes-store';

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

export async function uploadYesStorePhoto(
  level: string,
  parentId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<YesStorePhoto> {
  const err = validateYesStoreImage(file);
  if (err) throw new Error(err);

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

export async function deleteYesStorePhotoFile(photo: YesStorePhoto): Promise<void> {
  if (!photo.storagePath) return;
  await deleteObject(ref(storage, photo.storagePath)).catch(() => undefined);
}

export async function deleteYesStorePhotos(photos: YesStorePhoto[]): Promise<void> {
  await Promise.all(photos.map(photo => deleteYesStorePhotoFile(photo)));
}
