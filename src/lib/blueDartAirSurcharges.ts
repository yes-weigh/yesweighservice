import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');

export const BLUE_DART_FUEL_SURCHARGE_URL = 'https://www.bluedart.com/fuel-surcharge';
export const BLUE_DART_CAF_URL = 'https://www.bluedart.com/currency-adjustment-factor';

export type BlueDartSurchargeSlice = {
  sourceUrl: string;
  percent: number;
  effectiveDate: string;
  effectiveLabel: string;
  recent: Array<{
    effectiveDate: string;
    effectiveLabel: string;
    percent: number;
  }>;
};

export type BlueDartAirSurchargesResult = {
  fuel: BlueDartSurchargeSlice;
  caf: BlueDartSurchargeSlice;
  fetchedAt: string;
};

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

/** Fetch current published Domestic FS % and CAF % from Blue Dart (via Cloud Function). */
export async function fetchBlueDartAirSurcharges(): Promise<BlueDartAirSurchargesResult> {
  try {
    const fn = httpsCallable<Record<string, never>, BlueDartAirSurchargesResult>(
      functions,
      'fetchBlueDartAirSurchargesFn',
      { timeout: 60_000 },
    );
    const result = await fn({});
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not fetch Blue Dart FS / CAF surcharges.');
  }
}
