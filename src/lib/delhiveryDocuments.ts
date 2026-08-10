import { Capacitor } from '@capacitor/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { WhatsAppShare } from 'whatsapp-share';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

export type DelhiveryBookingDocument = {
  id: string;
  label: string;
  kind: string;
  urls?: string[];
  note?: string;
};

export type DelhiveryBookingDocumentsResult = {
  lrn: string;
  documents: DelhiveryBookingDocument[];
  skipped: Array<{ id: string; reason: string }>;
};

export type DelhiveryBinaryDocument = {
  available: boolean;
  contentType: string | null;
  base64: string | null;
  fileName?: string | null;
  /** Durable Firebase Storage URL when cached (or just saved). */
  url?: string | null;
  cached?: boolean;
  error: string | null;
};

export type DelhiveryLabelImage = {
  contentType: string;
  base64?: string;
  fileName: string;
  url?: string;
};

export type DelhiveryLabelImagesResult = {
  available: boolean;
  images: DelhiveryLabelImage[];
  urls?: string[];
  cached?: boolean;
  error: string | null;
};

export async function listDelhiveryBookingDocuments(input: {
  bookingId?: string;
  lrn?: string;
}): Promise<DelhiveryBookingDocumentsResult> {
  try {
    const fn = httpsCallable<
      { bookingId?: string; lrn?: string },
      DelhiveryBookingDocumentsResult
    >(functions, 'listDelhiveryBookingDocumentsFn', { timeout: 60_000 });
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not list Delhivery documents.');
  }
}

export async function fetchDelhiveryPod(input: {
  lrn: string;
  bookingId?: string;
}): Promise<{
  available: boolean;
  urls: string[];
  cached?: boolean;
  error: string | null;
}> {
  try {
    const fn = httpsCallable<
      { lrn: string; bookingId?: string },
      {
        available: boolean;
        urls: string[];
        cached?: boolean;
        error: string | null;
      }
    >(functions, 'fetchDelhiveryPodFn', { timeout: 90_000 });
    const result = await fn({
      lrn: input.lrn,
      ...(input.bookingId ? { bookingId: input.bookingId } : {}),
    });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not fetch Delhivery POD.');
  }
}

export async function fetchDelhiveryDocumentImage(
  lrn: string,
  docType: 'POD' | 'COD' = 'POD',
  bookingId?: string,
): Promise<{
  available: boolean;
  contentType: string | null;
  base64: string | null;
  url?: string | null;
  urls?: string[];
  cached?: boolean;
  error: string | null;
}> {
  try {
    const fn = httpsCallable<
      { lrn: string; docType: 'POD' | 'COD'; bookingId?: string },
      {
        available: boolean;
        contentType: string | null;
        base64: string | null;
        url?: string | null;
        urls?: string[];
        cached?: boolean;
        error: string | null;
      }
    >(functions, 'fetchDelhiveryDocumentImageFn', { timeout: 90_000 });
    const result = await fn({
      lrn,
      docType,
      ...(bookingId ? { bookingId } : {}),
    });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not download Delhivery document.');
  }
}

export async function fetchDelhiveryLrCopy(
  lrn: string,
  lrCopyType: string = 'all',
  bookingId?: string,
): Promise<DelhiveryBinaryDocument> {
  try {
    const fn = httpsCallable<
      { lrn: string; lrCopyType?: string; bookingId?: string },
      DelhiveryBinaryDocument
    >(functions, 'fetchDelhiveryLrCopyFn', { timeout: 90_000 });
    const result = await fn({
      lrn,
      lrCopyType,
      ...(bookingId ? { bookingId } : {}),
    });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not download Delhivery LR copy.');
  }
}

export async function fetchDelhiveryShippingLabels(
  lrn: string,
  size: 'std' | 'md' | 'sm' | 'a4' = 'a4',
  bookingId?: string,
): Promise<DelhiveryLabelImagesResult> {
  try {
    const fn = httpsCallable<
      { lrn: string; size?: string; bookingId?: string },
      DelhiveryLabelImagesResult
    >(functions, 'fetchDelhiveryShippingLabelsFn', { timeout: 120_000 });
    const result = await fn({
      lrn,
      size,
      ...(bookingId ? { bookingId } : {}),
    });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not download Delhivery shipping labels.');
  }
}

export function delhiveryBase64ToObjectUrl(
  base64: string,
  contentType: string,
): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
}

export function delhiveryBase64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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

/**
 * Native / Web Share for a Delhivery document (PDF or image).
 * APK uses the system share sheet; browsers use navigator.share when files are supported.
 */
export async function shareDelhiveryDocumentFile(input: {
  blob: Blob;
  fileName: string;
  title?: string;
}): Promise<void> {
  const fileName = String(input.fileName || 'document.pdf').trim() || 'document.pdf';
  const mimeType = input.blob.type || 'application/pdf';
  const title = String(input.title || fileName).trim() || fileName;

  if (Capacitor.isNativePlatform()) {
    const dataBase64 = await blobToBase64(input.blob);
    await WhatsAppShare.shareImage({
      dataBase64,
      fileName,
      mimeType,
    });
    return;
  }

  const file = new File([input.blob], fileName, { type: mimeType });
  const shareData: ShareData = {
    files: [file],
    title,
  };
  if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    await navigator.share(shareData);
    return;
  }

  // Fallback: download when Web Share can't attach files.
  const url = URL.createObjectURL(input.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
