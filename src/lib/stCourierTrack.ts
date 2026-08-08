import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { stCourierAppTrackingUrl, stCourierOfficialTrackingUrl } from './logisticsTracking';

const functions = getFunctions(app, 'asia-south1');

export type StCourierTrackResult = {
  awb: string;
  ok: boolean;
  error: string | null;
  status: string | null;
  origin: string | null;
  destination: string | null;
  consignmentType: string | null;
  bookedAt: string | null;
  deliveredAt: string | null;
  history: Array<{ at: string; location: string; activity: string }>;
  sourceUrl: string;
  fetchedAt: string;
};

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

/** Fetch live ST Courier status via Cloud Function (scrapes official site). */
export async function fetchStCourierShipmentTrack(
  awb: string,
  options?: { bookingId?: string | null },
): Promise<StCourierTrackResult> {
  try {
    const fn = httpsCallable<
      { awb: string; bookingId?: string },
      StCourierTrackResult
    >(
      functions,
      'trackStCourierShipmentFn',
      { timeout: 60_000 },
    );
    const bookingId = options?.bookingId?.trim();
    const result = await fn({
      awb: awb.trim(),
      ...(bookingId ? { bookingId } : {}),
    });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not fetch ST Courier shipment status.');
  }
}

/** Map a persisted booking.courierTrack snapshot into the live track result shape. */
export function stCourierTrackFromBooking(
  track: {
    awb?: string;
    ok?: boolean;
    error?: string | null;
    status?: string | null;
    origin?: string | null;
    destination?: string | null;
    consignmentType?: string | null;
    bookedAt?: string | null;
    deliveredAt?: string | null;
    history?: Array<{ at: string; location: string; activity: string }>;
    sourceUrl?: string;
    fetchedAt?: string;
  } | null | undefined,
): StCourierTrackResult | null {
  if (!track) return null;
  return {
    awb: String(track.awb ?? ''),
    ok: Boolean(track.ok),
    error: track.error == null ? null : String(track.error),
    status: track.status ?? null,
    origin: track.origin ?? null,
    destination: track.destination ?? null,
    consignmentType: track.consignmentType ?? null,
    bookedAt: track.bookedAt ?? null,
    deliveredAt: track.deliveredAt ?? null,
    history: Array.isArray(track.history) ? track.history : [],
    sourceUrl: String(track.sourceUrl ?? ''),
    fetchedAt: String(track.fetchedAt ?? ''),
  };
}

export function openStCourierTrackPage(awb: string): void {
  // Prefer current origin (hosting rewrite) in production; fall back to absolute app URL.
  const origin = /localhost|127\.0\.0\.1/i.test(window.location.hostname)
    ? undefined
    : window.location.origin;
  const url = stCourierAppTrackingUrl(awb, origin);
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function openStCourierOfficialTrackPage(): void {
  window.open(stCourierOfficialTrackingUrl(), '_blank', 'noopener,noreferrer');
}

export type StCourierDeliveryOfficeResult = {
  pincode: string;
  ok: boolean;
  error: string | null;
  communication: string | null;
  serviceCenter: string | null;
  hubCenter: string | null;
  sourceUrl: string;
  fetchedAt: string;
};

/** Extract the first 6-digit Indian PIN from free-text address. */
export function extractIndianPincode(text: string | null | undefined): string | null {
  const match = /\b(\d{6})\b/.exec(String(text ?? ''));
  return match?.[1] ?? null;
}

/** Fetch ST Courier delivery-office Communication for a destination pincode. */
export async function fetchStCourierDeliveryOffice(
  pincode: string,
): Promise<StCourierDeliveryOfficeResult> {
  try {
    const fn = httpsCallable<
      { pincode: string },
      StCourierDeliveryOfficeResult
    >(
      functions,
      'lookupStCourierDeliveryOfficeFn',
      { timeout: 45_000 },
    );
    const result = await fn({ pincode: pincode.replace(/\D/g, '').slice(0, 6) });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not fetch ST Courier delivery office.');
  }
}
