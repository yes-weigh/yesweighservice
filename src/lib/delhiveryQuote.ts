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

export type DelhiveryServiceability = {
  ok: boolean;
  serviceable: boolean;
  failOnDemand: boolean;
  error: string | null;
  pincode: string;
  center: string | null;
  city: string | null;
  state: string | null;
  oda: boolean | null;
  paymentTypes: string[];
};

export type DelhiveryTat = {
  ok: boolean;
  tatDays: number | null;
  error: string | null;
  originPin: string;
  destinationPin: string;
};

export type DelhiveryEstimateQuote = {
  ok: boolean;
  error: string | null;
  totalInr: number | null;
  preTaxInr: number | null;
  toPayInr: number | null;
  chargedWeightKg: number | null;
};

export type DelhiveryLaneQuote = {
  ok: boolean;
  originPin: string | null;
  destinationPin: string | null;
  weightG: number;
  freightBillingMode: 'fod' | 'btc';
  serviceability: DelhiveryServiceability;
  tat: DelhiveryTat;
  estimate: DelhiveryEstimateQuote;
};

export type DelhiveryQuoteDimension = {
  box_count?: number;
  length_cm?: number;
  width_cm?: number;
  height_cm?: number;
};

export async function quoteDelhiveryLane(input: {
  originPin?: string | null;
  destinationPin: string;
  weightG?: number | null;
  invAmount?: number | null;
  dimensions?: DelhiveryQuoteDimension[];
  freightBillingMode?: 'fod' | 'btc' | null;
  includeEstimate?: boolean;
}): Promise<DelhiveryLaneQuote> {
  try {
    const fn = httpsCallable<typeof input, DelhiveryLaneQuote>(
      functions,
      'quoteDelhiveryLaneFn',
      { timeout: 60_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not quote Delhivery lane.');
  }
}

export async function checkDelhiveryPincodeServiceability(input: {
  pincode: string;
  weightG?: number | null;
}): Promise<DelhiveryServiceability> {
  try {
    const fn = httpsCallable<typeof input, DelhiveryServiceability>(
      functions,
      'checkDelhiveryPincodeServiceabilityFn',
      { timeout: 45_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not check Delhivery serviceability.');
  }
}

export async function fetchDelhiveryTat(input: {
  originPin: string;
  destinationPin: string;
}): Promise<DelhiveryTat> {
  try {
    const fn = httpsCallable<typeof input, DelhiveryTat>(
      functions,
      'fetchDelhiveryTatFn',
      { timeout: 45_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not fetch Delhivery TAT.');
  }
}

/** Extract first 6-digit Indian pin from free text. */
export function pinFromText(raw: string | null | undefined): string {
  const match = /\b(\d{6})\b/.exec(String(raw ?? ''));
  return match?.[1] || '';
}
