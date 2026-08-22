import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import { compressImageForUpload } from './compressImage';
import { formatStorageUploadError } from './storageErrors';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function dealerStaffPhotoPath(dealerId: string, staffUid: string, ext = 'jpg'): string {
  return `dealerStaff/${dealerId}/${staffUid}/photo.${ext}`;
}

function extFromFile(file: File): string {
  const name = file.name.split('.').pop()?.toLowerCase();
  if (name && ['jpg', 'jpeg', 'png', 'webp'].includes(name)) {
    return name === 'jpeg' ? 'jpg' : name;
  }
  if (file.type.startsWith('image/')) {
    return file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  }
  return 'jpg';
}

export async function uploadDealerStaffPhoto(
  dealerId: string,
  staffUid: string,
  file: File,
): Promise<{ url: string; storagePath: string }> {
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Photo must be under 5 MB.');
  if (!file.type.startsWith('image/')) throw new Error('Photo must be an image.');

  try {
    const compressed = await compressImageForUpload(file);
    const ext = extFromFile(compressed);
    const path = dealerStaffPhotoPath(dealerId, staffUid, ext);
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, compressed, {
      contentType: compressed.type || 'image/jpeg',
    });
    return {
      url: await getDownloadURL(storageRef),
      storagePath: path,
    };
  } catch (err) {
    throw new Error(formatStorageUploadError(err, 'Could not upload photo.'));
  }
}
