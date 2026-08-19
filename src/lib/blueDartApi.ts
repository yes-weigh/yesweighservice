import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { BlueDartApiEnv, BlueDartPublicConfig } from '../types/blue-dart-api';
import type { StCourierTrackResult } from './stCourierTrack';
import type { LogisticsCourierTrack } from '../types/logistics-dispatch';

const functions = getFunctions(app, 'asia-south1');

function blueDartCallableErrorText(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (typeof err !== 'object') return String(err);
  const row = err as {
    message?: unknown;
    details?: unknown;
    customData?: { message?: unknown } | null;
  };
  return [
    row.message,
    row.details,
    row.customData?.message,
  ].map(part => (part == null ? '' : String(part))).filter(Boolean).join('\n');
}

function callableError(err: unknown, fallback: string): Error {
  const message = blueDartCallableErrorText(err)
    .replace(/^Firebase(Error)?:\s*/i, '')
    .trim();
  if (message) return new Error(message);
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

export async function cancelBlueDartWaybill(awb: string): Promise<{
  ok: boolean;
  awb: string;
  alreadyCancelled?: boolean;
}> {
  const number = String(awb || '').replace(/\D/g, '').trim();
  if (!number) throw new Error('AWB is required to cancel.');
  try {
    const fn = httpsCallable<{ awb: string }, { ok: boolean; awb: string; alreadyCancelled?: boolean }>(
      functions,
      'cancelBlueDartWaybillFn',
      { timeout: 60_000 },
    );
    const result = await fn({ awb: number });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not cancel Blue Dart waybill.');
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

const PICKUP_REGISTERED_RE = /pickup\s+has\s+been\s+registered/i;
const BLUE_DART_DELIVERED_RE = /\bdelivered\b|\bdelivery\s+(completed|done|successful)\b|\bpod\b/i;
const BLUE_DART_RETURNED_RE = /\b(rto|return\s*to\s*origin|returned)\b/i;
const BLUE_DART_CANCELLED_RE = /\b(cancel+ed|cancelled)\b/i;
const BLUE_DART_TRANSIT_RE = /\b(in\s*transit|out\s*for\s*delivery|ofd|reached|arrived|dispatched|manifest|transit|hub|branch|undelivered|on\s*hold|held|attempted|outscanned)\b|shipment\s+picked|\bpicked\s+up\b/i;

function blueDartActivityLines(
  track: Pick<BlueDartTrackResult, 'status' | 'history'>,
): string[] {
  const lines = [String(track.status || '')];
  if (Array.isArray(track.history)) {
    for (const item of track.history) {
      lines.push(String(item?.activity || ''));
    }
  }
  return lines.map(line => line.trim()).filter(Boolean);
}

function isBlueDartPickupRegisteredOnly(
  track: Pick<BlueDartTrackResult, 'status' | 'history'>,
): boolean {
  const lines = blueDartActivityLines(track);
  if (!lines.length) return false;
  const hasRegistered = lines.some(line => PICKUP_REGISTERED_RE.test(line));
  if (!hasRegistered) return false;
  const moved = lines.some((line) => {
    const rest = line.replace(/pickup\s+has\s+been\s+registered/gi, ' ').trim();
    if (!rest) return false;
    return BLUE_DART_TRANSIT_RE.test(rest)
      || BLUE_DART_DELIVERED_RE.test(rest)
      || BLUE_DART_RETURNED_RE.test(rest);
  });
  return !moved;
}

/**
 * Optimistic UI status after a live Blue Dart refresh.
 * Pickup registered stays Booked; actual pickup / transit → In Transit.
 */
export function inferBlueDartUiStatus(
  track: Pick<BlueDartTrackResult, 'ok' | 'status' | 'statusType' | 'deliveredAt' | 'history'>,
  currentStatus: string,
): string {
  if (currentStatus === 'returned' || currentStatus === 'cancelled') return currentStatus;
  if (!track.ok) return 'label_generated';

  const statusType = String(track.statusType || '').trim().toUpperCase();
  const bits = blueDartActivityLines(track).join(' ');

  if (statusType === 'DL' || Boolean(String(track.deliveredAt || '').trim()) || BLUE_DART_DELIVERED_RE.test(bits)) {
    return 'delivered';
  }
  if (statusType === 'RT' || BLUE_DART_RETURNED_RE.test(bits)) return 'returned';
  if (statusType === 'CN' || BLUE_DART_CANCELLED_RE.test(bits)) return 'cancelled';
  if (currentStatus === 'delivered') return 'delivered';

  if (isBlueDartPickupRegisteredOnly(track)) return 'label_generated';

  if (
    statusType === 'IT'
    || statusType === 'UD'
    || BLUE_DART_TRANSIT_RE.test(bits.replace(/pickup\s+has\s+been\s+registered/gi, ' '))
  ) {
    return 'in_transit';
  }

  return 'label_generated';
}

export type BlueDartAlreadyGenerated = {
  awb: string;
  destinationArea: string | null;
  destinationLocation: string | null;
};

/**
 * Blue Dart returns an error when trying to GenerateWayBill twice for the same
 * CreditReferenceNo (orderId).
 *
 * Example:
 * "Waybill already generated for this CreditReferenceNo. Waybill No : 21094582725 Dest Area : GGN Dest Scrcd : GDC"
 */
export function parseBlueDartAlreadyGenerated(raw: string): BlueDartAlreadyGenerated | null {
  const msg = String(raw ?? '').replace(/\u00a0/g, ' ');
  if (!/already\s+generated/i.test(msg) || !/waybill/i.test(msg)) return null;
  const awbMatch = /waybill\s*no\s*[:.\-–—]?\s*'?(\d{8,})/i.exec(msg)
    || /\b(\d{11,12})\b/.exec(msg);
  const awb = String(awbMatch?.[1] ?? '').replace(/\D/g, '').trim();
  if (!awb) return null;
  const destinationArea = /dest\s*area\s*[:.\-–—]?\s*([A-Z]{3,6})/i.exec(msg)?.[1]?.toUpperCase()
    ?? null;
  const destinationLocation = /dest\s*scrcd\s*[:.\-–—]?\s*([A-Z0-9]{3,8})/i.exec(msg)?.[1]?.toUpperCase()
    ?? null;
  return { awb, destinationArea, destinationLocation };
}

export function parseBlueDartAlreadyGeneratedWaybillNo(message: string): string | null {
  return parseBlueDartAlreadyGenerated(message)?.awb ?? null;
}

