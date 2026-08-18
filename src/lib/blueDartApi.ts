import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { BlueDartApiEnv, BlueDartPublicConfig } from '../types/blue-dart-api';
import type { StCourierTrackResult } from './stCourierTrack';
import type { LogisticsCourierTrack } from '../types/logistics-dispatch';

const functions = getFunctions(app, 'asia-south1');

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

export async function getBlueDartConfig(): Promise<BlueDartPublicConfig> {
  try {
    const fn = httpsCallable<undefined, BlueDartPublicConfig>(
      functions,
      'getBlueDartConfigFn',
      { timeout: 30_000 },
    );
    const result = await fn();
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not load Blue Dart config.');
  }
}

export async function saveBlueDartCredentials(input: {
  env: BlueDartApiEnv;
  loginId: string;
  clientId?: string;
  clientSecret?: string;
  shippingLicenseKey?: string;
  trackingLicenseKey?: string;
  sandboxLicenseKey?: string;
  customerCode: string;
  originArea: string;
  customerPincode: string;
  customerName?: string;
}): Promise<BlueDartPublicConfig> {
  try {
    const fn = httpsCallable<typeof input, { ok: boolean; config: BlueDartPublicConfig }>(
      functions,
      'saveBlueDartCredentialsFn',
      { timeout: 60_000 },
    );
    const result = await fn(input);
    return result.data.config;
  } catch (err) {
    throw callableError(err, 'Could not save Blue Dart credentials.');
  }
}

export type BlueDartPincodeLookup = {
  pin: string;
  ok: boolean;
  error?: string | null;
  description?: string;
  areaCode?: string;
  serviceCenterCode?: string;
  airOutbound?: boolean;
  surfaceOutbound?: boolean;
  dpOutbound?: boolean;
};

export async function lookupBlueDartPincodes(pins: string[]): Promise<{
  ok: boolean;
  account: {
    originArea: string;
    customerPincode: string;
    customerCode: string;
  };
  results: BlueDartPincodeLookup[];
}> {
  try {
    const fn = httpsCallable<{ pins: string[] }, {
      ok: boolean;
      account: {
        originArea: string;
        customerPincode: string;
        customerCode: string;
      };
      results: BlueDartPincodeLookup[];
    }>(functions, 'lookupBlueDartPincodesFn', { timeout: 60_000 });
    const result = await fn({ pins });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not look up Blue Dart pincodes.');
  }
}

export async function testBlueDartConnection(): Promise<{
  ok: boolean;
  message: string;
  env?: BlueDartApiEnv;
  loginId?: string;
}> {
  try {
    const fn = httpsCallable<undefined, {
      ok: boolean;
      message: string;
      env?: BlueDartApiEnv;
      loginId?: string;
    }>(functions, 'testBlueDartConnectionFn', { timeout: 60_000 });
    const result = await fn();
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not test Blue Dart connection.');
  }
}

export type BlueDartBookConsignee = {
  name: string;
  phone: string;
  address: string;
  city?: string;
  state?: string;
  pincode: string;
  email?: string;
  gstin?: string;
};

export type BlueDartBookBox = {
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  weightKg?: number;
  quantity?: number;
};

export type BlueDartBookResult = {
  ok: boolean;
  awb: string;
  env?: BlueDartApiEnv;
  productCode?: string;
  destinationArea?: string | null;
  destinationLocation?: string | null;
  pickupRegistered?: boolean;
  pickupDate?: string | null;
  pickupTime?: string | null;
  pickupAddress?: string | null;
  pickupPin?: string | null;
  originArea?: string | null;
  pickupToken?: string | null;
  pickupMessage?: string | null;
  documents?: {
    awb: string;
    waybill?: {
      storagePath: string;
      fileName: string;
      contentType: string;
      cachedAt: string;
      labelSize?: string;
    };
    awbA4?: {
      storagePath: string;
      fileName: string;
      contentType: string;
      cachedAt: string;
      labelSize?: string;
    };
  } | null;
};

export async function bookBlueDartShipment(input: {
  partnerId: string;
  shipFromSite?: string;
  orderId?: string;
  consignee: BlueDartBookConsignee;
  returnAddress?: BlueDartBookConsignee | null;
  boxes: BlueDartBookBox[];
  invoiceNumber?: string | null;
  invoiceValueInr?: number | null;
  invoiceId?: string | null;
  zohoCustomerId?: string | null;
  sellerGstin?: string | null;
  freightBillingMode?: 'fod' | 'btc' | null;
}): Promise<BlueDartBookResult> {
  try {
    const fn = httpsCallable<typeof input, BlueDartBookResult>(
      functions,
      'bookBlueDartShipmentFn',
      { timeout: 120_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not book Blue Dart shipment.');
  }
}

export async function getBlueDartWaybill(input: {
  bookingId?: string;
  storagePath?: string;
  variant?: 'a4' | 'label';
}): Promise<{ contentBase64: string; contentType: string; fileName: string }> {
  try {
    const fn = httpsCallable<typeof input, {
      contentBase64: string;
      contentType: string;
      fileName: string;
    }>(functions, 'getBlueDartWaybillFn', { timeout: 30_000 });
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not load Blue Dart waybill.');
  }
}

export type BlueDartTrackResult = StCourierTrackResult & {
  statusType?: string | null;
};

export async function fetchBlueDartShipmentTrack(input: {
  awb: string;
  bookingId?: string | null;
}): Promise<BlueDartTrackResult> {
  try {
    const fn = httpsCallable<{ awb: string; bookingId?: string | null }, BlueDartTrackResult>(
      functions,
      'trackBlueDartShipmentFn',
      { timeout: 60_000 },
    );
    const result = await fn({
      awb: input.awb,
      ...(input.bookingId ? { bookingId: input.bookingId } : {}),
    });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not fetch Blue Dart tracking.');
  }
}

export function blueDartTrackFromBooking(
  cached: LogisticsCourierTrack | null | undefined,
): BlueDartTrackResult | null {
  if (!cached) return null;
  return {
    awb: cached.awb,
    ok: cached.ok,
    error: cached.error,
    status: cached.status,
    statusType: cached.statusType ?? null,
    origin: cached.origin,
    destination: cached.destination,
    consignmentType: cached.consignmentType,
    bookedAt: cached.bookedAt,
    deliveredAt: cached.deliveredAt,
    history: cached.history,
    sourceUrl: cached.sourceUrl,
    fetchedAt: cached.fetchedAt,
  };
}
