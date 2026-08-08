import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { delhiveryAppTrackingUrl, delhiveryOfficialTrackingUrl } from './logisticsTracking';
import type { StCourierTrackResult } from './stCourierTrack';

const functions = getFunctions(app, 'asia-south1');

/** Same shape as ST — persisted on booking.courierTrack. */
export type DelhiveryTrackResult = StCourierTrackResult;

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

/** Fetch live Delhivery B2B status via Cloud Function. */
export async function fetchDelhiveryShipmentTrack(
  awb: string,
  options?: { bookingId?: string | null },
): Promise<DelhiveryTrackResult> {
  try {
    const fn = httpsCallable<
      { awb: string; bookingId?: string },
      DelhiveryTrackResult
    >(
      functions,
      'trackDelhiveryShipmentFn',
      { timeout: 60_000 },
    );
    const bookingId = options?.bookingId?.trim();
    const result = await fn({
      awb: awb.trim(),
      ...(bookingId ? { bookingId } : {}),
    });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not fetch Delhivery shipment status.');
  }
}

/** Map a persisted booking.courierTrack snapshot into the live track result shape. */
export function delhiveryTrackFromBooking(
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
): DelhiveryTrackResult | null {
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

export function openDelhiveryTrackPage(awb: string): void {
  const origin = /localhost|127\.0\.0\.1/i.test(window.location.hostname)
    ? undefined
    : window.location.origin;
  const url = delhiveryAppTrackingUrl(awb, origin);
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function openDelhiveryOfficialTrackPage(awb?: string): void {
  window.open(delhiveryOfficialTrackingUrl(awb), '_blank', 'noopener,noreferrer');
}
