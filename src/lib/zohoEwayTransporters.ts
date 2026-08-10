import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');

export type ZohoEwayTransporterOption = {
  id: string;
  name: string;
  gstin: string | null;
};

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

export async function listZohoEwayTransporters(): Promise<ZohoEwayTransporterOption[]> {
  try {
    const fn = httpsCallable<Record<string, never>, { transporters: ZohoEwayTransporterOption[] }>(
      functions,
      'listZohoEwayTransportersFn',
      { timeout: 60_000 },
    );
    const result = await fn({});
    return Array.isArray(result.data?.transporters) ? result.data.transporters : [];
  } catch (err) {
    throw callableError(err, 'Could not load Zoho transporters.');
  }
}
