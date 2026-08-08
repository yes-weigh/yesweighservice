import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { trackonAppTrackingUrl, trackonOfficialTrackingUrl } from './logisticsTracking';
import type { StCourierTrackResult } from './stCourierTrack';

const functions = getFunctions(app, 'asia-south1');

/** Same shape as ST — persisted on booking.courierTrack. */
export type TrackonTrackResult = StCourierTrackResult;

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

/** Fetch live Trackon status via Cloud Function (scrapes official site). */
export async function fetchTrackonShipmentTrack(
  awb: string,
  options?: { bookingId?: string | null },
): Promise<TrackonTrackResult> {
  try {
    const fn = httpsCallable<
      { awb: string; bookingId?: string },
      TrackonTrackResult
    >(
      functions,
      'trackTrackonShipmentFn',
      { timeout: 60_000 },
    );
    const bookingId = options?.bookingId?.trim();
    const result = await fn({
      awb: awb.trim(),
      ...(bookingId ? { bookingId } : {}),
    });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not fetch Trackon shipment status.');
  }
}

/** Map a persisted booking.courierTrack snapshot into the live track result shape. */
export function trackonTrackFromBooking(
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
): TrackonTrackResult | null {
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

export function openTrackonTrackPage(awb: string): void {
  const origin = /localhost|127\.0\.0\.1/i.test(window.location.hostname)
    ? undefined
    : window.location.origin;
  const url = trackonAppTrackingUrl(awb, origin);
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function openTrackonOfficialTrackPage(): void {
  window.open(trackonOfficialTrackingUrl(), '_blank', 'noopener,noreferrer');
}
