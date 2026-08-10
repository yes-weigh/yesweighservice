import { getFunctions, httpsCallable } from 'firebase/functions';
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
