import { Capacitor } from '@capacitor/core';
import { WhatsAppShare } from 'whatsapp-share';
import type { CatalogMediaFile } from '../../types/catalog-media';

const MAX_NATIVE_SHARE_BYTES = 18 * 1024 * 1024;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not encode file.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not encode file.'));
    reader.readAsDataURL(blob);
  });
}

function fallbackFileName(fileName: string, mimeType: string): string {
  const trimmed = fileName.trim() || 'media';
  if (trimmed.includes('.')) return trimmed;
  if (mimeType.startsWith('video/')) return `${trimmed}.mp4`;
  if (mimeType.startsWith('image/')) return `${trimmed}.jpg`;
  if (mimeType === 'application/pdf') return `${trimmed}.pdf`;
  return trimmed;
}

function looksLikeBrochure(file: CatalogMediaFile): boolean {
  const hay = `${file.caption ?? ''} ${file.fileName}`.toLowerCase();
  return hay.includes('brochure');
}

/** First Firebase media image captioned or named Brochure. */
export function findCatalogBrochureImage(
  files: readonly CatalogMediaFile[],
): CatalogMediaFile | null {
  const images = files.filter(file => file.kind === 'image' && file.url.trim());
  return images.find(looksLikeBrochure) ?? null;
}

/** Open the phone share sheet for a catalog media file (image, video, or PDF). */
export async function shareCatalogMediaFile(input: {
  url: string;
  fileName: string;
  contentType?: string | null;
  title?: string | null;
  blob?: Blob | null;
}): Promise<void> {
  const url = input.url.trim();
  if (!url && !input.blob) throw new Error('Nothing to share.');
  const mimeType = String(input.contentType ?? '').split(';')[0].trim() || 'application/octet-stream';
  const fileName = fallbackFileName(input.fileName, mimeType);
  const title = String(input.title ?? '').trim() || fileName;

  let blob: Blob | null = input.blob && input.blob.size > 0 ? input.blob : null;
  if (!blob && url) {
    try {
      const response = await fetch(url);
      if (response.ok) blob = await response.blob();
    } catch {
      blob = null;
    }
  }

  if (blob && Capacitor.isNativePlatform() && blob.size > 0 && blob.size <= MAX_NATIVE_SHARE_BYTES) {
    const dataBase64 = await blobToBase64(blob);
    await WhatsAppShare.shareImage({
      dataBase64,
      fileName,
      mimeType: blob.type || mimeType,
    });
    return;
  }

  const shareFile = blob && blob.size > 0
    ? new File([blob], fileName, { type: blob.type || mimeType })
    : null;
  if (
    shareFile
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [shareFile] })
  ) {
    await navigator.share({ files: [shareFile], title, text: title });
    return;
  }

  if (typeof navigator.share === 'function') {
    await navigator.share({ title, text: title, url });
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}
