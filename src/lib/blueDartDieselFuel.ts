import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');

export const BLUE_DART_DIESEL_FUEL_SURCHARGE_URL = 'https://www.bluedart.com/diesel-fuel-surcharge';

export type BlueDartDieselFuelSurchargeResult = {
  sourceUrl: string;
  percent: number;
  effectiveDate: string;
  effectiveLabel: string;
  fetchedAt: string;
  recent: Array<{
    effectiveDate: string;
    effectiveLabel: string;
    percent: number;
  }>;
};

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

/** Fetch current published Diesel Fuel Surcharge % from Blue Dart’s site (via Cloud Function). */
export async function fetchBlueDartDieselFuelSurcharge(): Promise<BlueDartDieselFuelSurchargeResult> {
  try {
    const fn = httpsCallable<Record<string, never>, BlueDartDieselFuelSurchargeResult>(
      functions,
      'fetchBlueDartDieselFuelSurchargeFn',
      { timeout: 60_000 },
    );
    const result = await fn({});
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not fetch Blue Dart diesel fuel surcharge.');
  }
}
