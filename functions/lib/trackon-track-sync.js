/**
 * Persist Trackon track results onto logisticsBookings and advance pipeline status.
 * Mirrors st-courier-track-sync.js for trackon_air / trackon_surface (+ legacy trackon).
 */

import { fetchTrackonTrack } from './trackon-track.js';
import {
  OPEN_LOGISTICS_STATUSES,
  awbFromLogisticsBooking,
  buildCourierTrackSnapshot,
  buildStCourierTrackingPatch,
  inferLogisticsStatusFromStTrack,
} from './st-courier-track-sync.js';

export const TRACKON_PARTNER_IDS = Object.freeze([
  'trackon_air',
  'trackon_surface',
  'trackon',
]);

export function isTrackonPartnerId(partnerId) {
  return TRACKON_PARTNER_IDS.includes(String(partnerId || ''));
}

/**
 * Same patch shape as ST — status inference is free-text based.
 *
 * @param {Awaited<ReturnType<typeof fetchTrackonTrack>>} track
 * @param {{
 *   currentStatus?: string,
 *   updatePipelineStatus?: boolean,
 *   correctFalseDelivered?: boolean,
 * }} [options]
 */
export function buildTrackonTrackingPatch(track, options = {}) {
  const patch = buildStCourierTrackingPatch(track, options);
  if (patch.courierTrack && typeof patch.courierTrack === 'object') {
    patch.courierTrack = {
      ...patch.courierTrack,
      sourceUrl: String(
        track.sourceUrl
        || patch.courierTrack.sourceUrl
        || 'https://www.trackon.in/courier-tracking',
      ),
    };
  }
  return patch;
}

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sync Trackon tracking onto logistics booking docs.
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
 */
export async function syncTrackonTrackingForBookings(db, options = {}) {
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
    .where('partnerId', 'in', [...TRACKON_PARTNER_IDS])
    .get();

  /** @type {FirebaseFirestore.QueryDocumentSnapshot[]} */
  const targets = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const status = String(data.status || '');
    if (!includeCancelled && (status === 'cancelled' || status === 'returned')) continue;
    if (!includeDelivered && status === 'delivered') continue;
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
      track = await fetchTrackonTrack(awb);
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

    const patch = buildTrackonTrackingPatch(track, {
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
 */
export async function persistTrackonTrackOnBooking(db, bookingId, track, options = {}) {
  const ref = db.collection('logisticsBookings').doc(String(bookingId));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`Logistics booking not found: ${bookingId}`);
  }
  const data = snap.data() || {};
  const patch = buildTrackonTrackingPatch(track, {
    currentStatus: String(data.status || ''),
    currentBookingDate: String(data.bookingDate || ''),
    bookingSource: String(data.source || ''),
    updatePipelineStatus: options.updatePipelineStatus !== false,
    updateBookingDate: options.updateBookingDate,
    correctFalseDelivered: options.correctFalseDelivered !== false,
  });
  await ref.update(patch);
  return { bookingId, patch };
}

export {
  OPEN_LOGISTICS_STATUSES,
  awbFromLogisticsBooking,
  buildCourierTrackSnapshot,
  inferLogisticsStatusFromStTrack,
};
