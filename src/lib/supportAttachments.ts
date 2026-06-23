import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { compressImageForUpload } from './compressImage';
import { applyGpsOverlayToImage, formatGpsLabel, getCurrentGpsCoords } from './supportGeolocation';
import type { SupportAttachment, SupportAttachmentKind } from '../types/dealer-support';

export const MAX_SUPPORT_ATTACHMENTS = 5;
export const MAX_EVIDENCE_PHOTOS = 4;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export interface PendingSupportFile {
  id: string;
  file: File;
  previewUrl: string;
  kind: SupportAttachmentKind;
  gpsLabel?: string | null;
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

export function createPendingSupportFile(file: File, gpsLabel?: string | null): PendingSupportFile {
  const kind: SupportAttachmentKind = isVideoFile(file) ? 'video' : 'image';
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    kind,
    gpsLabel: gpsLabel ?? null,
  };
}

export async function createPendingEvidencePhoto(file: File): Promise<PendingSupportFile> {
  const err = validateSupportFile(file);
  if (err) throw new Error(err);
  if (!isImageFile(file)) throw new Error('Only image files are allowed for photo evidence.');

  const coords = await getCurrentGpsCoords();
  const gpsLabel = formatGpsLabel(coords);
  const overlaid = await applyGpsOverlayToImage(file, gpsLabel);
  return createPendingSupportFile(overlaid, gpsLabel);
}

export function hasEvidenceVideo(files: PendingSupportFile[]): boolean {
  return files.some(file => file.kind === 'video');
}

export function validateEvidenceFiles(files: PendingSupportFile[]): string | null {
  if (!hasEvidenceVideo(files)) {
    return 'Record a video for evidence.';
  }
  return null;
}

export function countEvidencePhotos(files: PendingSupportFile[]): number {
  return files.filter(file => file.kind === 'image').length;
}

export function revokePendingSupportFiles(files: PendingSupportFile[]): void {
  files.forEach(item => URL.revokeObjectURL(item.previewUrl));
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'file';
}

function uploadContentType(file: File): string {
  const raw = file.type?.split(';')[0]?.trim() ?? '';
  if (raw.startsWith('video/')) return raw;
  if (raw.startsWith('image/')) return raw;
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return isVideoFile(file) ? 'video/webm' : 'image/jpeg';
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
    const contentType = uploadContentType(file);
    const attachmentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const storagePath = `support/${requestId}/${messageId}/${attachmentId}-${safeFileName(file.name)}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, { contentType });
    const url = await getDownloadURL(storageRef);
    uploads.push({
      id: attachmentId,
      kind: isVideoFile(file) ? 'video' : 'image',
      url,
      storagePath,
      fileName: file.name,
      mimeType: contentType,
      size: file.size,
    });
  }

  return uploads;
}
