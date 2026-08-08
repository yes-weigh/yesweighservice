/**
 * Persist Delhivery track results onto logisticsBookings and advance pipeline status.
 */

import { fetchDelhiveryTrack, normalizeDelhiveryLrn } from './delhivery-track.js';
import {
  OPEN_LOGISTICS_STATUSES,
  buildCourierTrackSnapshot,
  buildStCourierTrackingPatch,
  inferLogisticsStatusFromStTrack,
} from './st-courier-track-sync.js';

export const DELHIVERY_PARTNER_IDS = Object.freeze(['delhivery']);

export function isDelhiveryPartnerId(partnerId) {
  return DELHIVERY_PARTNER_IDS.includes(String(partnerId || ''));
}

/**
 * Prefer alphanumeric LRN (Delhivery B2B is typically 9 digits).
 * @param {Record<string, unknown>} data
 */
export function lrnFromLogisticsBooking(data) {
  for (const value of [data?.consignmentNo, data?.trackingNo]) {
    const lrn = normalizeDelhiveryLrn(value);
    if (lrn) return lrn;
  }
  return '';
}

/**
 * @param {Awaited<ReturnType<typeof fetchDelhiveryTrack>>} track
 * @param {{
 *   currentStatus?: string,
 *   updatePipelineStatus?: boolean,
 *   correctFalseDelivered?: boolean,
 * }} [options]
 */
export function buildDelhiveryTrackingPatch(track, options = {}) {
  const patch = buildStCourierTrackingPatch(track, options);
  if (patch.courierTrack && typeof patch.courierTrack === 'object') {
    patch.courierTrack = {
      ...patch.courierTrack,
      sourceUrl: String(
        track.sourceUrl
        || patch.courierTrack.sourceUrl
        || 'https://www.delhivery.com/track/package/',
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
export async function syncDelhiveryTrackingForBookings(db, options = {}) {
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
    .where('partnerId', 'in', [...DELHIVERY_PARTNER_IDS])
    .get();

  /** @type {FirebaseFirestore.QueryDocumentSnapshot[]} */
  const targets = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const status = String(data.status || '');
    if (!includeCancelled && (status === 'cancelled' || status === 'returned')) continue;
    if (!includeDelivered && status === 'delivered') continue;
    if (!includeDelivered && !OPEN_LOGISTICS_STATUSES.includes(status)) continue;
    const lrn = lrnFromLogisticsBooking(data);
    if (!lrn) continue;
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
    const awb = lrnFromLogisticsBooking(data);
    const currentStatus = String(data.status || '');

    let track;
    try {
      track = await fetchDelhiveryTrack(db, awb);
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

    const patch = buildDelhiveryTrackingPatch(track, {
      currentStatus,
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
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} bookingId
 * @param {Awaited<ReturnType<typeof fetchDelhiveryTrack>>} track
 * @param {{ updatePipelineStatus?: boolean, correctFalseDelivered?: boolean }} [options]
 */
export async function persistDelhiveryTrackOnBooking(db, bookingId, track, options = {}) {
  const ref = db.collection('logisticsBookings').doc(String(bookingId));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`Logistics booking not found: ${bookingId}`);
  }
  const data = snap.data() || {};
  const patch = buildDelhiveryTrackingPatch(track, {
    currentStatus: String(data.status || ''),
    updatePipelineStatus: options.updatePipelineStatus !== false,
    correctFalseDelivered: options.correctFalseDelivered !== false,
  });
  await ref.update(patch);
  return { bookingId, patch };
}

export {
  OPEN_LOGISTICS_STATUSES,
  buildCourierTrackSnapshot,
  inferLogisticsStatusFromStTrack,
};
