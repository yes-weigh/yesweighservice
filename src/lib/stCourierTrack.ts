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

const OFD_RE = /\bout\s*for\s*delivery\b|\bofd\b|\bout\s*for\s*dlvy\b|\bof\s*delivery\b/i;

export function isOutForDeliveryActivity(text: string | null | undefined): boolean {
  return OFD_RE.test(String(text || ''));
}

function isDeliveredActivity(text: string | null | undefined): boolean {
  const raw = String(text || '');
  if (isOutForDeliveryActivity(raw)) return false;
  const bits = raw.toLowerCase();
  return /\bdelivered\b/.test(bits) || /\bdelivery\s+(completed|done|successful)\b/.test(bits);
}

function isInTransitActivity(text: string | null | undefined): boolean {
  const bits = String(text || '').toLowerCase();
  if (isOutForDeliveryActivity(bits)) return true;
  return /\b(in\s*transit|reached|arrived|dispatched|manifest|transit|hub|branch)\b/.test(bits)
    || /\b(undelivered|on\s*hold|held|attempted)\b/.test(bits)
    || /\b(picked\s*up|pickup|booked|accepted|shipment\s*created|consignment\s*booked)\b/.test(bits);
}

function latestTrackActivityText(track: {
  status?: string | null;
  history?: Array<{ activity?: string }>;
}): string {
  const history = Array.isArray(track.history) ? track.history : [];
  const newest = history.length ? String(history[0]?.activity || '').trim() : '';
  return newest || String(track.status || '').trim();
}

/** Newest scan wins. Out for Delivery is in transit even if Delivery Date/Time is filled. */
export function resolveStCourierPipelineStatus(
  track: Pick<StCourierTrackResult, 'ok' | 'status' | 'deliveredAt' | 'history'>,
): 'in_transit' | 'delivered' | null {
  if (!track.ok) return null;
  const newest = latestTrackActivityText(track);
  const status = String(track.status || '').trim();
  if (isOutForDeliveryActivity(newest) || isOutForDeliveryActivity(status)) {
    return 'in_transit';
  }
  if (isDeliveredActivity(newest) || isDeliveredActivity(status)) {
    return 'delivered';
  }
  if (isInTransitActivity(newest) || isInTransitActivity(status)) {
    return 'in_transit';
  }
  if (String(track.deliveredAt || '').trim()) return 'delivered';
  if (status) return 'in_transit';
  return null;
}

export function inferStCourierUiStatus(
  track: Pick<StCourierTrackResult, 'ok' | 'status' | 'deliveredAt' | 'history'>,
  currentStatus: string,
): string {
  if (currentStatus === 'returned' || currentStatus === 'cancelled') return currentStatus;
  const resolved = resolveStCourierPipelineStatus(track);
  if (resolved) return resolved;
  return currentStatus;
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
