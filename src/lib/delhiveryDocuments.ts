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

export async function fetchDelhiveryPod(lrn: string): Promise<{
  available: boolean;
  urls: string[];
  error: string | null;
}> {
  try {
    const fn = httpsCallable<{ lrn: string }, {
      available: boolean;
      urls: string[];
      error: string | null;
    }>(functions, 'fetchDelhiveryPodFn', { timeout: 60_000 });
    const result = await fn({ lrn });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not fetch Delhivery POD.');
  }
}

export async function fetchDelhiveryDocumentImage(
  lrn: string,
  docType: 'POD' | 'COD' = 'POD',
): Promise<{
  available: boolean;
  contentType: string | null;
  base64: string | null;
  error: string | null;
}> {
  try {
    const fn = httpsCallable<
      { lrn: string; docType: 'POD' | 'COD' },
      {
        available: boolean;
        contentType: string | null;
        base64: string | null;
        error: string | null;
      }
    >(functions, 'fetchDelhiveryDocumentImageFn', { timeout: 60_000 });
    const result = await fn({ lrn, docType });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not download Delhivery document.');
  }
}
