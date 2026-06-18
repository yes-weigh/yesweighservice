import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { compressImageForUpload } from './compressImage';
import type { SupportAttachment, SupportAttachmentKind } from '../types/dealer-support';

export const MAX_SUPPORT_ATTACHMENTS = 5;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export interface PendingSupportFile {
  id: string;
  file: File;
  previewUrl: string;
  kind: SupportAttachmentKind;
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function validateSupportFile(file: File): string | null {
  if (!isImageFile(file) && !isVideoFile(file)) {
    return `${file.name}: only images and videos are allowed.`;
  }
  if (isVideoFile(file) && file.size > MAX_VIDEO_BYTES) {
    return `${file.name}: video must be under 50 MB.`;
  }
  if (isImageFile(file) && file.size > 15 * 1024 * 1024) {
    return `${file.name}: image must be under 15 MB.`;
  }
  return null;
}

export function createPendingSupportFile(file: File): PendingSupportFile {
  const kind: SupportAttachmentKind = isVideoFile(file) ? 'video' : 'image';
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    kind,
  };
}

export function revokePendingSupportFiles(files: PendingSupportFile[]): void {
  files.forEach(item => URL.revokeObjectURL(item.previewUrl));
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'file';
}

export async function uploadSupportAttachments(
  requestId: string,
  messageId: string,
  files: File[],
): Promise<SupportAttachment[]> {
  const uploads: SupportAttachment[] = [];

  for (const original of files) {
    const err = validateSupportFile(original);
    if (err) throw new Error(err);

    const file = isImageFile(original)
      ? await compressImageForUpload(original)
      : original;
    const attachmentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const storagePath = `support/${requestId}/${messageId}/${attachmentId}-${safeFileName(file.name)}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, { contentType: file.type });
    const url = await getDownloadURL(storageRef);
    uploads.push({
      id: attachmentId,
      kind: isVideoFile(file) ? 'video' : 'image',
      url,
      storagePath,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });
  }

  return uploads;
}
