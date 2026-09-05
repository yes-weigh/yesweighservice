/**
 * Persist ST Courier track results onto logisticsBookings and optionally
 * advance pipeline status (booked → in_transit → delivered).
 * Backfill can also correct false "delivered" statuses from live ST data.
 */

import { fetchStCourierTrack } from './st-courier-track.js';

export const ST_COURIER_PARTNER_ID = 'st_courier';

/** Bookings still open for hourly sync (excludes delivered / cancelled / returned). */
export const OPEN_LOGISTICS_STATUSES = Object.freeze([
  'label_generated',
  // Legacy: treat as open until backfill folds into in_transit
  'shipped',
  'in_transit',
]);

const STATUS_RANK = Object.freeze({
  label_generated: 0,
  shipped: 1, // legacy alias of in_transit rank floor
  in_transit: 2,
  delivered: 3,
  cancelled: -1,
  returned: -1,
});

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeLogisticsAwb(raw) {
  return String(raw ?? '').replace(/\D/g, '').trim();
}

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function awbFromLogisticsBooking(data) {
  const candidates = [data?.consignmentNo, data?.trackingNo];
  for (const value of candidates) {
    const awb = normalizeLogisticsAwb(value);
    if (awb) return awb;
  }
  return '';
}

/**
 * @param {{
 *   ok?: boolean,
 *   status?: string | null,
 *   deliveredAt?: string | null,
 *   history?: Array<{ activity?: string }>,
 * }} track
 */
function stTrackTextBits(track) {
  return [
    track?.status,
    track?.deliveredAt,
    ...(Array.isArray(track?.history) ? track.history.map(item => item?.activity) : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function latestTrackActivityText(track) {
  const history = Array.isArray(track?.history) ? track.history : [];
  const newest = history.length ? String(history[0]?.activity || '').trim() : '';
  const status = String(track?.status || '').trim();
  return newest || status;
}

export function isOutForDeliveryActivity(text) {
  return /\bout\s*for\s*delivery\b|\bofd\b|\bout\s*for\s*dlvy\b|\bof\s*delivery\b/i
    .test(String(text || ''));
}

function isDeliveredActivity(text) {
  const raw = String(text || '');
  if (isOutForDeliveryActivity(raw)) return false;
  const bits = raw.toLowerCase();
  return /\bdelivered\b/.test(bits)
    || /\bdelivery\s+(completed|done|successful)\b/.test(bits);
}

function isInTransitActivity(text) {
  const bits = String(text || '').toLowerCase();
  if (isOutForDeliveryActivity(bits)) return true;
  return /\b(in\s*transit|reached|arrived|dispatched|manifest|transit|hub|branch)\b/.test(bits)
    || /\b(undelivered|on\s*hold|held|attempted)\b/.test(bits)
    || /\b(picked\s*up|pickup|booked|accepted|shipment\s*created|consignment\s*booked)\b/.test(bits);
}

/**
 * Absolute pipeline status implied by a successful ST track result.
 * Newest scan wins: Out for Delivery stays in transit even if ST filled
 * Delivery Date/Time or an older row said Delivered.
 *
 * @param {{
 *   ok?: boolean,
 *   status?: string | null,
 *   deliveredAt?: string | null,
 *   history?: Array<{ activity?: string }>,
 * }} track
 * @returns {'in_transit' | 'delivered' | null}
 */
export function resolveStPipelineStatus(track) {
  if (!track?.ok) return null;

  const newest = latestTrackActivityText(track);
  const status = String(track?.status || '').trim();
  if (isOutForDeliveryActivity(newest) || isOutForDeliveryActivity(status)) {
    return 'in_transit';
  }
  if (isDeliveredActivity(newest) || isDeliveredActivity(status)) {
    return 'delivered';
  }
  if (isInTransitActivity(newest) || isInTransitActivity(status)) {
    return 'in_transit';
  }

  const bits = stTrackTextBits(track);
  if (isOutForDeliveryActivity(bits)) return 'in_transit';

  const looksDelivered = Boolean(String(track.deliveredAt || '').trim())
    || /\bdelivered\b/.test(bits)
    || /\bdelivery\s+(completed|done|successful)\b/.test(bits);

  if (looksDelivered) return 'delivered';

  const looksInTransit = isInTransitActivity(bits)
    || /\b(rto|return\s*to\s*origin)\b/.test(bits);

  if (looksInTransit) return 'in_transit';

  if (String(track.status || '').trim()) return 'in_transit';

  return null;
}

/**
 * Map ST Courier free-text status / history → pipeline status, or null = no change.
 * By default never downgrades and never changes returned/cancelled.
 * With correctFalseDelivered, overwrites incorrect delivered → live ST status.
 * Track fetch failures (incl. invalid AWB) → label_generated.
 *
 * @param {{
 *   ok?: boolean,
 *   status?: string | null,
 *   error?: string | null,
 *   deliveredAt?: string | null,
 *   history?: Array<{ activity?: string }>,
 * }} track
 * @param {string} currentStatus
 * @param {{ correctFalseDelivered?: boolean }} [options]
 * @returns {'label_generated' | 'in_transit' | 'delivered' | null}
 */
export function inferLogisticsStatusFromStTrack(track, currentStatus, options = {}) {
  const currentRaw = String(currentStatus || '');
  const current = (
    currentRaw === 'tracking_failed' || currentRaw === 'status_not_available'
  )
    ? 'label_generated'
    : currentRaw === 'shipped'
      ? 'in_transit'
      : currentRaw;
  if (current === 'cancelled' || current === 'returned') return null;

  const correctFalseDelivered = Boolean(options.correctFalseDelivered);

  if (!track?.ok) {
    // Don't flip a confirmed delivered booking unless correcting.
    if (current === 'delivered' && !correctFalseDelivered) return null;
    return current === 'label_generated' ? null : 'label_generated';
  }

  const resolved = resolveStPipelineStatus(track);
  if (!resolved) return null;

  // Live OFD / transit after a false delivered mark (ST often fills Delivery Date/Time early).
  if (current === 'delivered' && resolved === 'in_transit') {
    return 'in_transit';
  }

  // Backfill / correction mode: trust ST when booking was wrongly marked delivered.
  if (correctFalseDelivered && current === 'delivered' && resolved !== 'delivered') {
    return resolved;
  }

  if (current === 'delivered') return null;

  return rankHigher(resolved, current) ? resolved : null;
}

/**
 * @param {string} next
 * @param {string} current
 */
function rankHigher(next, current) {
  const nextRank = STATUS_RANK[next] ?? -1;
  const currentRank = STATUS_RANK[current] ?? -1;
  return nextRank > currentRank;
}

/**
 * Firestore-safe snapshot of a track fetch (nested under courierTrack).
 *
 * @param {Awaited<ReturnType<typeof fetchStCourierTrack>>} track
 */
export function buildCourierTrackSnapshot(track) {
  const history = Array.isArray(track.history)
    ? track.history.map(item => ({
      at: String(item?.at ?? ''),
      location: String(item?.location ?? ''),
      activity: String(item?.activity ?? ''),
    }))
    : [];

  return {
    awb: String(track.awb ?? ''),
    ok: Boolean(track.ok),
    error: track.error == null ? null : String(track.error),
    status: track.status == null ? null : String(track.status),
    origin: track.origin == null ? null : String(track.origin),
    destination: track.destination == null ? null : String(track.destination),
    consignmentType: track.consignmentType == null ? null : String(track.consignmentType),
    bookedAt: track.bookedAt == null ? null : String(track.bookedAt),
    deliveredAt: track.deliveredAt == null ? null : String(track.deliveredAt),
    history,
    sourceUrl: String(track.sourceUrl ?? 'https://stcourier.com/track/shipment'),
    fetchedAt: String(track.fetchedAt ?? new Date().toISOString()),
  };
}

/**
 * Calendar booking date (YYYY-MM-DD, Asia/Kolkata) from courier bookedAt / pickup.
 * @param {unknown} bookedAt
 * @returns {string | null}
 */
export function bookingDateFromTrackBookedAt(bookedAt) {
  const raw = String(bookedAt ?? '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const isoDay = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return isoDay ? isoDay[1] : null;
  }
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
 * Whether this booking should adopt courier bookedAt as bookingDate.
 * Manual / invoice LR entries often used today or invoice date; sync to real book/pickup.
 * @param {unknown} source
 */
export function shouldSyncBookingDateFromTrack(source) {
  const value = String(source || '').trim().toLowerCase();
  // wizard / support API books already set bookingDate; still safe to correct from courier.
  return value === 'manual' || value === 'invoice' || value === 'support' || value === '';
}

/**
 * Build a Firestore update patch from a track result.
 * Does not bump updatedAt unless pipeline status changes (keeps list sort stable).
 *
 * @param {Awaited<ReturnType<typeof fetchStCourierTrack>>} track
 * @param {{
 *   currentStatus?: string,
 *   currentBookingDate?: string,
 *   bookingSource?: string,
 *   updatePipelineStatus?: boolean,
 *   updateBookingDate?: boolean,
 *   correctFalseDelivered?: boolean,
 * }} [options]
 */
export function buildStCourierTrackingPatch(track, options = {}) {
  const updatePipelineStatus = options.updatePipelineStatus !== false;
  const correctFalseDelivered = Boolean(options.correctFalseDelivered);
  const currentStatus = String(options.currentStatus || '');
  const courierTrack = buildCourierTrackSnapshot(track);
  /** @type {Record<string, unknown>} */
  const patch = {
    courierTrack,
    trackFetchedAt: courierTrack.fetchedAt,
  };

  const updateBookingDate = options.updateBookingDate != null
    ? Boolean(options.updateBookingDate)
    : shouldSyncBookingDateFromTrack(options.bookingSource);
  if (updateBookingDate && track?.ok) {
    const nextBookingDate = bookingDateFromTrackBookedAt(track.bookedAt);
    const currentBookingDate = String(options.currentBookingDate || '').slice(0, 10);
    if (nextBookingDate && nextBookingDate !== currentBookingDate) {
      patch.bookingDate = nextBookingDate;
    }
  }

  if (updatePipelineStatus) {
    const nextStatus = inferLogisticsStatusFromStTrack(track, currentStatus, {
      correctFalseDelivered,
    });
    if (nextStatus && nextStatus !== currentStatus) {
      const now = new Date().toISOString();
      patch.status = nextStatus;
      patch.updatedAt = now;
      if (nextStatus === 'in_transit') {
        patch.inTransitAt = now;
      }
      if (nextStatus === 'delivered') {
        patch.deliveredAt = courierTrack.deliveredAt || now;
      } else if (currentStatus === 'delivered') {
        // Clear stale delivery stamp when correcting a false delivered mark.
        // Use null (not FieldValue.delete) so scripts sharing this module across
        // different firebase-admin copies can still write the patch.
        patch.deliveredAt = null;
      }
    }
  }

  return patch;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<void>} worker
 */
async function mapPool(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()));
}

/**
 * Sync ST Courier tracking onto logistics booking docs.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{
 *   includeDelivered?: boolean,
 *   includeCancelled?: boolean,
 *   correctFalseDelivered?: boolean,
 *   dryRun?: boolean,
 *   concurrency?: number,
 *   delayMs?: number,
 *   limit?: number,
 *   onProgress?: (event: Record<string, unknown>) => void,
 * }} [options]
 * correctFalseDelivered defaults to true when includeDelivered is set (backfill
 * overwrites false delivered marks from live ST status).
 */
export async function syncStCourierTrackingForBookings(db, options = {}) {
  const includeDelivered = Boolean(options.includeDelivered);
  const includeCancelled = Boolean(options.includeCancelled);
  const correctFalseDelivered = options.correctFalseDelivered != null
    ? Boolean(options.correctFalseDelivered)
    : includeDelivered;
  const dryRun = Boolean(options.dryRun);
  const concurrency = Number(options.concurrency) > 0 ? Number(options.concurrency) : 2;
  const delayMs = Number(options.delayMs) >= 0 ? Number(options.delayMs) : 400;
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 0;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  const snap = await db
    .collection('logisticsBookings')
    .where('partnerId', '==', ST_COURIER_PARTNER_ID)
    .get();

  /** @type {FirebaseFirestore.QueryDocumentSnapshot[]} */
  const targets = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const status = String(data.status || '');
    if (!includeCancelled && (status === 'cancelled' || status === 'returned')) continue;
    if (!includeDelivered && status === 'delivered') continue;
    // Hourly mode: only open pipeline statuses (skip unknown / returned / delivered).
    if (!includeDelivered && !OPEN_LOGISTICS_STATUSES.includes(status)) continue;
    const awb = awbFromLogisticsBooking(data);
    if (!awb) continue;
    targets.push(docSnap);
    if (limit && targets.length >= limit) break;
  }

  const summary = {
    scanned: snap.size,
    targeted: targets.length,
    fetchedOk: 0,
    fetchedFail: 0,
    updated: 0,
    statusAdvanced: 0,
    statusCorrected: 0,
    skipped: 0,
    errors: /** @type {Array<{ id: string, awb: string, error: string }>} */ ([]),
  };

  await mapPool(targets, concurrency, async (docSnap) => {
    const data = docSnap.data() || {};
    const awb = awbFromLogisticsBooking(data);
    const currentStatus = String(data.status || '');

    let track;
    try {
      track = await fetchStCourierTrack(awb);
    } catch (err) {
      summary.fetchedFail += 1;
      summary.errors.push({
        id: docSnap.id,
        awb,
        error: err?.message || String(err),
      });
      onProgress({
        type: 'error',
        id: docSnap.id,
        awb,
        error: err?.message || String(err),
      });
      if (delayMs) await sleep(delayMs);
      return;
    }

    if (track.ok) summary.fetchedOk += 1;
    else summary.fetchedFail += 1;

    const patch = buildStCourierTrackingPatch(track, {
      currentStatus,
      currentBookingDate: String(data.bookingDate || ''),
      bookingSource: String(data.source || ''),
      updatePipelineStatus: true,
      correctFalseDelivered,
    });
    const statusChanged = typeof patch.status === 'string' && patch.status !== currentStatus;
    const correctedDelivered = statusChanged
      && currentStatus === 'delivered'
      && patch.status !== 'delivered';

    onProgress({
      type: 'fetched',
      id: docSnap.id,
      awb,
      ok: track.ok,
      stStatus: track.status,
      error: track.error,
      currentStatus,
      nextStatus: statusChanged ? patch.status : null,
      bookingDate: patch.bookingDate || null,
      correctedDelivered,
      dryRun,
    });

    if (dryRun) {
      summary.skipped += 1;
      if (statusChanged) summary.statusAdvanced += 1;
      if (correctedDelivered) summary.statusCorrected += 1;
      if (delayMs) await sleep(delayMs);
      return;
    }

    try {
      await docSnap.ref.update(patch);
      summary.updated += 1;
      if (statusChanged) summary.statusAdvanced += 1;
      if (correctedDelivered) summary.statusCorrected += 1;
    } catch (err) {
      summary.errors.push({
        id: docSnap.id,
        awb,
        error: err?.message || String(err),
      });
      onProgress({
        type: 'write_error',
        id: docSnap.id,
        awb,
        error: err?.message || String(err),
      });
    }

    if (delayMs) await sleep(delayMs);
  });

  return summary;
}

/**
 * Persist track result for a single booking (callable / ad-hoc).
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} bookingId
 * @param {Awaited<ReturnType<typeof fetchStCourierTrack>>} track
 * @param {{ updatePipelineStatus?: boolean, correctFalseDelivered?: boolean, updateBookingDate?: boolean }} [options]
 */
export async function persistStCourierTrackOnBooking(db, bookingId, track, options = {}) {
  const ref = db.collection('logisticsBookings').doc(String(bookingId));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`Logistics booking not found: ${bookingId}`);
  }
  const data = snap.data() || {};
  const patch = buildStCourierTrackingPatch(track, {
    currentStatus: String(data.status || ''),
    currentBookingDate: String(data.bookingDate || ''),
    bookingSource: String(data.source || ''),
    updatePipelineStatus: options.updatePipelineStatus !== false,
    updateBookingDate: options.updateBookingDate,
    // Live track refresh should also fix wrongly marked delivered bookings.
    correctFalseDelivered: options.correctFalseDelivered !== false,
  });
  await ref.update(patch);
  return { bookingId, patch };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
