import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, storage } from '../firebase';
import { compressImageForUpload } from './compressImage';
import { captureVideoPoster } from './captureMedia';
import { formatStorageUploadError } from './storageErrors';
import { applyGpsOverlayToImage, formatGpsLabel, getCurrentGpsCoords } from './supportGeolocation';
import type { SupportAttachment, SupportAttachmentKind } from '../types/dealer-support';

const functions = getFunctions(app, 'asia-south1');

export const MAX_SUPPORT_ATTACHMENTS = 5;
export const REQUIRED_EVIDENCE_PHOTO_SLOTS: EvidencePhotoSlot[] = ['serial', 'label'];
export const MAX_EVIDENCE_PHOTOS = REQUIRED_EVIDENCE_PHOTO_SLOTS.length;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** Must match functions/lib/support-attachments.js MAX_SERVER_UPLOAD_BYTES */
const MAX_SERVER_UPLOAD_BYTES = 20 * 1024 * 1024;

export type SupportSubmitProgress = {
  phase: 'preparing' | 'uploading' | 'finalizing';
  label: string;
  percent: number | null;
  fileIndex?: number;
  fileCount?: number;
};

export type EvidencePhotoSlot = 'serial' | 'label';

export interface PendingSupportFile {
  id: string;
  file: File;
  previewUrl: string;
  kind: SupportAttachmentKind;
  gpsLabel?: string | null;
  photoSlot?: EvidencePhotoSlot | null;
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(webm|mp4|m4v|mov)$/i.test(file.name);
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || /\.(webm|ogg|m4a|mp3|aac)$/i.test(file.name);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
}

export function validateSupportFile(file: File): string | null {
  if (!isImageFile(file) && !isVideoFile(file) && !isAudioFile(file)) {
    return `${file.name}: only images, videos, and voice notes are allowed.`;
  }
  if (isVideoFile(file) && file.size > MAX_VIDEO_BYTES) {
    return `${file.name}: video must be under 50 MB.`;
  }
  if (isAudioFile(file) && file.size > 10 * 1024 * 1024) {
    return `${file.name}: voice note must be under 10 MB.`;
  }
  if (isImageFile(file) && file.size > 15 * 1024 * 1024) {
    return `${file.name}: image must be under 15 MB.`;
  }
  return null;
}

export function createPendingSupportFile(
  file: File,
  options?: { gpsLabel?: string | null; photoSlot?: EvidencePhotoSlot | null },
): PendingSupportFile {
  const kind: SupportAttachmentKind = isVideoFile(file)
    ? 'video'
    : isAudioFile(file)
      ? 'audio'
      : 'image';
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    kind,
    gpsLabel: options?.gpsLabel ?? null,
    photoSlot: options?.photoSlot ?? null,
  };
}

export async function createPendingEvidencePhoto(
  file: File,
  photoSlot?: EvidencePhotoSlot,
): Promise<PendingSupportFile> {
  const err = validateSupportFile(file);
  if (err) throw new Error(err);
  if (!isImageFile(file)) throw new Error('Only image files are allowed for photo evidence.');

  const coords = await getCurrentGpsCoords();
  const gpsLabel = formatGpsLabel(coords);
  const overlaid = await applyGpsOverlayToImage(file, gpsLabel);
  return createPendingSupportFile(overlaid, { gpsLabel, photoSlot });
}

export function hasEvidenceVideo(files: PendingSupportFile[]): boolean {
  return files.some(file => file.kind === 'video');
}

export function validateEvidenceFiles(files: PendingSupportFile[]): string | null {
  if (!hasEvidenceVideo(files)) {
    return 'Record a video for evidence.';
  }
  for (const slot of REQUIRED_EVIDENCE_PHOTO_SLOTS) {
    if (!files.some(file => file.kind === 'image' && file.photoSlot === slot)) {
      if (slot === 'serial') return 'Add a serial number / MAC ID photo.';
      return 'Add a product label photo.';
    }
  }
  return null;
}

export function countEvidencePhotos(files: PendingSupportFile[]): number {
  return files.filter(file => file.kind === 'image').length;
}

export function revokePendingSupportFiles(files: PendingSupportFile[]): void {
  files.forEach(item => URL.revokeObjectURL(item.previewUrl));
}

export async function getSupportAttachmentUrl(storagePath: string): Promise<string> {
  if (!storagePath.trim()) {
    throw new Error('Missing storage path.');
  }
  return getDownloadURL(ref(storage, storagePath));
}

export function supportUploadErrorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (message.includes('signBlob') || message.includes('Server upload signing')) {
    return 'Could not upload evidence. Please try again.';
  }
  return formatStorageUploadError(
    err,
    fallback,
    'Could not upload evidence. Sign out, sign back in, and try again.',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read file.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
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

interface PreparedSupportUpload {
  uploadUrl: string;
  downloadUrl: string;
  storagePath: string;
  attachmentId: string;
  contentType: string;
}

export interface UploadSupportAttachmentsOptions {
  isInitial?: boolean;
}

function isStorageUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: string }).code ?? '');
  const message = String((err as { message?: string }).message ?? '');
  return code === 'storage/unauthorized'
    || code === 'storage/unauthenticated'
    || message.includes('storage/unauthorized')
    || message.includes('storage/unauthenticated')
    || message.includes('User does not have permission');
}

function isSignedUploadUnavailable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: string }).code ?? '');
  const message = String((err as { message?: string }).message ?? '');
  return code === 'functions/not-found'
    || code === 'functions/unavailable'
    || code === 'functions/deadline-exceeded'
    || code === 'functions/internal'
    || message.includes('signBlob')
    || message.includes('serviceAccounts.signBlob')
    || message.includes('Max allowed expiration is seven days');
}

async function uploadViaCloudFunction(
  requestId: string,
  messageId: string,
  file: File,
  contentType: string,
  options: UploadSupportAttachmentsOptions | undefined,
  onFileProgress?: (percent: number) => void,
): Promise<{ attachmentId: string; storagePath: string; url: string }> {
  const callable = httpsCallable<
    {
      requestId: string;
      messageId: string;
      fileName: string;
      contentType: string;
      fileBase64: string;
      isInitial?: boolean;
    },
    { attachmentId: string; storagePath: string; url: string; contentType: string }
  >(functions, 'uploadSupportAttachmentFn', { timeout: 120_000 });

  onFileProgress?.(5);
  const fileBase64 = await fileToBase64(file);
  onFileProgress?.(35);

  const result = await callable({
    requestId,
    messageId,
    fileName: file.name,
    contentType,
    fileBase64,
    isInitial: options?.isInitial === true ? true : undefined,
  });

  onFileProgress?.(100);
  return {
    attachmentId: result.data.attachmentId,
    storagePath: result.data.storagePath,
    url: result.data.url,
  };
}

async function uploadViaSignedUrl(
  requestId: string,
  messageId: string,
  file: File,
  contentType: string,
  options: UploadSupportAttachmentsOptions | undefined,
  onFileProgress?: (percent: number) => void,
): Promise<PreparedSupportUpload & { url: string }> {
  const callable = httpsCallable<
    {
      requestId: string;
      messageId: string;
      fileName: string;
      contentType: string;
      size: number;
      isInitial?: boolean;
    },
    PreparedSupportUpload
  >(functions, 'prepareSupportAttachmentUploadFn');

  onFileProgress?.(0);

  const prep = await callable({
    requestId,
    messageId,
    fileName: file.name,
    contentType,
    size: file.size,
    isInitial: options?.isInitial === true ? true : undefined,
  });

  await uploadFileViaPut(prep.data.uploadUrl, file, prep.data.contentType, onFileProgress);

  return { ...prep.data, url: prep.data.downloadUrl };
}

function uploadFileViaPut(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      const detail = xhr.responseText?.trim().slice(0, 160);
      reject(new Error(
        detail
          ? `Could not upload ${file.name} (${xhr.status}: ${detail})`
          : `Could not upload ${file.name} (${xhr.status}).`,
      ));
    };
    xhr.onerror = () => reject(new Error(`Could not upload ${file.name}.`));
    void file.arrayBuffer().then(buffer => xhr.send(buffer)).catch(reject);
  });
}

async function uploadViaClientStorageWithRetry(
  requestId: string,
  messageId: string,
  file: File,
  contentType: string,
  onFileProgress?: (percent: number) => void,
): Promise<{ attachmentId: string; storagePath: string; url: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await uploadViaClientStorage(requestId, messageId, file, contentType, onFileProgress);
    } catch (err) {
      lastError = err;
      if (!isStorageUnauthorized(err) || attempt === 2) break;
      await sleep(350 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not upload attachment.');
}

async function uploadSingleSupportFile(
  requestId: string,
  messageId: string,
  file: File,
  contentType: string,
  options: UploadSupportAttachmentsOptions | undefined,
  onFileProgress?: (percent: number) => void,
): Promise<{ attachmentId: string; storagePath: string; url: string }> {
  try {
    return await uploadViaClientStorageWithRetry(
      requestId,
      messageId,
      file,
      contentType,
      onFileProgress,
    );
  } catch (directErr) {
    if (!isStorageUnauthorized(directErr)) {
      throw directErr instanceof Error ? directErr : new Error('Could not upload attachment.');
    }
  }

  if (file.size <= MAX_SERVER_UPLOAD_BYTES) {
    try {
      return await uploadViaCloudFunction(
        requestId,
        messageId,
        file,
        contentType,
        options,
        onFileProgress,
      );
    } catch (serverErr) {
      if (!isSignedUploadUnavailable(serverErr)) {
        throw serverErr instanceof Error ? serverErr : new Error('Could not upload attachment.');
      }
    }
  }

  try {
    const signed = await uploadViaSignedUrl(
      requestId,
      messageId,
      file,
      contentType,
      options,
      onFileProgress,
    );
    return {
      attachmentId: signed.attachmentId,
      storagePath: signed.storagePath,
      url: signed.url,
    };
  } catch (signedErr) {
    throw signedErr instanceof Error ? signedErr : new Error('Could not upload attachment.');
  }
}

async function uploadViaClientStorage(
  requestId: string,
  messageId: string,
  file: File,
  contentType: string,
  onFileProgress?: (percent: number) => void,
): Promise<{ attachmentId: string; storagePath: string; url: string }> {
  const attachmentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const storagePath = `support/${requestId}/${messageId}/${attachmentId}-${safeFileName(file.name)}`;
  const storageRef = ref(storage, storagePath);
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, { contentType });
    task.on(
      'state_changed',
      snapshot => {
        if (snapshot.totalBytes > 0) {
          onFileProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
        }
      },
      reject,
      () => resolve(),
    );
  });
  onFileProgress?.(100);
  const url = await getDownloadURL(storageRef);
  return { attachmentId, storagePath, url };
}

function reportBatchUploadProgress(
  onProgress: ((progress: SupportSubmitProgress) => void) | undefined,
  fileIndex: number,
  fileCount: number,
  fileName: string,
  filePercent: number,
  fileSizes: number[],
): void {
  if (!onProgress) return;

  const totalBytes = fileSizes.reduce((sum, size) => sum + size, 0);
  let percent: number | null = null;

  if (totalBytes > 0) {
    const completedBefore = fileSizes.slice(0, fileIndex).reduce((sum, size) => sum + size, 0);
    const currentBytes = fileSizes[fileIndex] ?? 0;
    const uploaded = completedBefore + (currentBytes * filePercent) / 100;
    percent = Math.min(95, Math.max(6, Math.round((uploaded / totalBytes) * 89) + 6));
  }

  onProgress({
    phase: 'uploading',
    label: `Uploading ${fileName} (${fileIndex + 1} of ${fileCount})…`,
    percent,
    fileIndex: fileIndex + 1,
    fileCount,
  });
}

export async function uploadSupportAttachments(
  requestId: string,
  messageId: string,
  files: File[],
  onProgress?: (progress: SupportSubmitProgress) => void,
  options?: UploadSupportAttachmentsOptions,
): Promise<SupportAttachment[]> {
  const uploads: SupportAttachment[] = [];
  const preparedFiles: File[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const original = files[index];
    const err = validateSupportFile(original);
    if (err) throw new Error(err);

    onProgress?.({
      phase: 'uploading',
      label: isImageFile(original)
        ? `Preparing photo ${index + 1} of ${files.length}…`
        : `Preparing video ${index + 1} of ${files.length}…`,
      percent: null,
      fileIndex: index + 1,
      fileCount: files.length,
    });

    const file = isImageFile(original)
      ? await compressImageForUpload(original)
      : original;
    preparedFiles.push(file);
  }

  const fileSizes = preparedFiles.map(file => file.size);

  for (let index = 0; index < preparedFiles.length; index += 1) {
    const file = preparedFiles[index];
    const contentType = uploadContentType(file);
    const fileName = file.name;

    const onFileProgress = (filePercent: number) => {
      reportBatchUploadProgress(onProgress, index, preparedFiles.length, fileName, filePercent, fileSizes);
    };

    const uploaded = await uploadSingleSupportFile(
      requestId,
      messageId,
      file,
      contentType,
      options,
      onFileProgress,
    );

    let posterUrl: string | null = null;
    if (isVideoFile(file)) {
      const posterBlob = await captureVideoPoster(file);
      if (posterBlob) {
        const posterFile = new File(
          [posterBlob],
          `${safeFileName(file.name)}.poster.jpg`,
          { type: 'image/jpeg', lastModified: Date.now() },
        );
        const posterUpload = await uploadSingleSupportFile(
          requestId,
          messageId,
          posterFile,
          'image/jpeg',
          options,
        );
        posterUrl = posterUpload.url;
      }
    }

    uploads.push({
      id: uploaded.attachmentId,
      kind: isVideoFile(file) ? 'video' : isAudioFile(file) ? 'audio' : 'image',
      url: uploaded.url,
      storagePath: uploaded.storagePath,
      fileName: file.name,
      mimeType: contentType,
      size: file.size,
      posterUrl,
    });
  }

  return uploads;
}
