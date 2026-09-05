import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { delhiveryAppTrackingUrl, delhiveryOfficialTrackingUrl } from './logisticsTracking';
import { isOutForDeliveryActivity, type StCourierTrackResult } from './stCourierTrack';

const functions = getFunctions(app, 'asia-south1');

/** Normalize Delhivery LRN / MWB input. */
export function normalizeDelhiveryId(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/[^\dA-Za-z]/g, '').trim().toUpperCase();
}

/** Classic Delhivery B2B Lorry Receipt Number (9 digits) — preferred single user entry. */
export function isDelhiveryB2bLrn(raw: string | null | undefined): boolean {
  return /^\d{9}$/.test(normalizeDelhiveryId(raw));
}

/** Master AWB / waybill (longer than LRN). */
export function isDelhiveryMasterAwb(raw: string | null | undefined): boolean {
  const id = normalizeDelhiveryId(raw);
  if (!id || isDelhiveryB2bLrn(id)) return false;
  return /^\d{12,}$/.test(id);
}

/**
 * Split a single Delhivery number into LRN vs Master AWB.
 * Users enter one value; we store LRN as consignment and MWB as tracking when known.
 */
export function splitDelhiveryEntryId(raw: string | null | undefined): {
  lrn: string | null;
  masterAwb: string | null;
  displayId: string;
} {
  const id = normalizeDelhiveryId(raw);
  if (!id) return { lrn: null, masterAwb: null, displayId: '' };
  if (isDelhiveryB2bLrn(id)) return { lrn: id, masterAwb: null, displayId: id };
  if (isDelhiveryMasterAwb(id)) return { lrn: null, masterAwb: id, displayId: id };
  return { lrn: id, masterAwb: null, displayId: id };
}

/** Resolve LRN / Master AWB already stored on a logistics booking. */
export function resolveDelhiveryBookingIds(booking: {
  consignmentNo?: string | null;
  trackingNo?: string | null;
  masterAwb?: string | null;
  courierTrack?: { awb?: string | null; masterAwb?: string | null } | null;
}): {
  lrn: string | null;
  masterAwb: string | null;
  missingLrn: boolean;
  missingMasterAwb: boolean;
} {
  const candidates = [
    booking.consignmentNo,
    booking.trackingNo,
    booking.masterAwb,
    booking.courierTrack?.masterAwb,
    booking.courierTrack?.awb,
  ];
  let lrn: string | null = null;
  let masterAwb: string | null = null;
  for (const raw of candidates) {
    const id = normalizeDelhiveryId(raw);
    if (!id) continue;
    if (!lrn && isDelhiveryB2bLrn(id)) lrn = id;
    if (!masterAwb && isDelhiveryMasterAwb(id)) masterAwb = id;
  }
  return {
    lrn,
    masterAwb,
    missingLrn: !lrn,
    missingMasterAwb: !masterAwb,
  };
}

/** Same shape as ST — plus optional Delhivery StatusType (DL/UD/RT/CN…). */
export type DelhiveryTrackResult = StCourierTrackResult & {
  statusType?: string | null;
  masterAwb?: string | null;
};

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
    statusType?: string | null;
    masterAwb?: string | null;
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
    statusType: track.statusType == null ? null : String(track.statusType),
    masterAwb: track.masterAwb == null ? null : String(track.masterAwb),
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

/** YYYY-MM-DD (IST) from courier bookedAt — mirrors Cloud Function bookingDate sync. */
export function bookingDateFromTrackBookedAt(bookedAt: string | null | undefined): string | null {
  const raw = String(bookedAt ?? '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const isoDay = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return isoDay ? isoDay[1] : null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(parsed));
  } catch {
    return isoDay ? isoDay[1] : null;
  }
}

/**
 * Optimistic UI status after a live Delhivery refresh (mirrors Cloud Function inference).
 * Returns the next booking status, or the current one when unchanged.
 */
export function inferDelhiveryUiStatus(
  track: Pick<DelhiveryTrackResult, 'ok' | 'status' | 'statusType' | 'deliveredAt' | 'history'>,
  currentStatus: string,
): string {
  if (currentStatus === 'returned' || currentStatus === 'cancelled') return currentStatus;
  if (!track.ok) return 'label_generated';

  const statusType = String(track.statusType || '').trim().toUpperCase();
  if (statusType === 'DL') return 'delivered';
  if (statusType === 'RT') return 'returned';
  if (statusType === 'CN') return 'cancelled';

  const newest = Array.isArray(track.history) && track.history[0]
    ? String(track.history[0]?.activity || '')
    : '';
  if (isOutForDeliveryActivity(track.status) || isOutForDeliveryActivity(newest)) {
    return 'in_transit';
  }

  const bits = [
    String(track.status || ''),
    ...(Array.isArray(track.history) ? track.history.map(item => String(item?.activity || '')) : []),
  ].join(' ').toLowerCase();

  if (isOutForDeliveryActivity(bits)) return 'in_transit';

  if (
    Boolean(String(track.deliveredAt || '').trim())
    || /\bdelivered\b/.test(bits)
  ) {
    return 'delivered';
  }
  if (/\b(rto|return\s*to\s*origin|returned)\b/.test(bits)) return 'returned';
  if (/\b(cancel+ed|cancelled)\b/.test(bits)) return 'cancelled';

  if (
    statusType === 'UD'
    || statusType === 'PU'
    || statusType === 'PP'
    || currentStatus === 'label_generated'
    || currentStatus === 'shipped'
    || /\b(in\s*transit|out\s*for\s*delivery|ofd|dispatched|manifest|transit|hub|picked\s*up|pickup|pending|scheduled)\b/.test(bits)
  ) {
    return currentStatus === 'delivered' ? 'delivered' : 'in_transit';
  }

  return currentStatus;
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
