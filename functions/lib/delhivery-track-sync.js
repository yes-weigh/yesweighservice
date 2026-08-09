/**
 * Persist Delhivery track results onto logisticsBookings and advance pipeline status.
 */

import { fetchDelhiveryTrack, normalizeDelhiveryLrn } from './delhivery-track.js';
import {
  OPEN_LOGISTICS_STATUSES,
  buildCourierTrackSnapshot,
  buildStCourierTrackingPatch,
  inferLogisticsStatusFromStTrack,
  resolveStPipelineStatus,
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
 * Map Delhivery StatusType + free-text → pipeline status (or null).
 * StatusType: DL delivered, RT returned, CN cancelled, UD/PU undelivered-in-motion.
 *
 * @param {{
 *   ok?: boolean,
 *   status?: string | null,
 *   statusType?: string | null,
 *   deliveredAt?: string | null,
 *   history?: Array<{ activity?: string }>,
 * }} track
 * @returns {'label_generated' | 'in_transit' | 'delivered' | 'returned' | 'cancelled' | null}
 */
export function resolveDelhiveryPipelineStatus(track) {
  if (!track?.ok) return null;

  const statusType = String(track.statusType || '').trim().toUpperCase();
  if (statusType === 'DL') return 'delivered';
  if (statusType === 'RT') return 'returned';
  if (statusType === 'CN') return 'cancelled';

  const bits = [
    String(track.status || ''),
    ...(Array.isArray(track.history) ? track.history.map(item => String(item?.activity || '')) : []),
  ].join(' ').toLowerCase();

  if (
    Boolean(String(track.deliveredAt || '').trim())
    || /\bdelivered\b/.test(bits)
    || /\bdelivery\s+(completed|done|successful)\b/.test(bits)
  ) {
    return 'delivered';
  }

  if (/\b(rto|return\s*to\s*origin|returned)\b/.test(bits)) {
    return 'returned';
  }

  if (/\b(cancel+ed|cancelled)\b/.test(bits)) {
    return 'cancelled';
  }

  // UD / PU / manifested / in transit / OFD → movement
  if (
    statusType === 'UD'
    || statusType === 'PU'
    || statusType === 'PP'
    || /\b(in\s*transit|out\s*for\s*delivery|ofd|dispatched|manifest|transit|hub|picked\s*up|pickup|pending|scheduled)\b/.test(bits)
  ) {
    return 'in_transit';
  }

  // Fall back to shared free-text resolver (ST wording overlaps enough).
  return resolveStPipelineStatus(track);
}

/**
 * @param {{
 *   ok?: boolean,
 *   status?: string | null,
 *   statusType?: string | null,
 *   error?: string | null,
 *   deliveredAt?: string | null,
 *   history?: Array<{ activity?: string }>,
 * }} track
 * @param {string} currentStatus
 * @param {{ correctFalseDelivered?: boolean }} [options]
 */
export function inferLogisticsStatusFromDelhiveryTrack(track, currentStatus, options = {}) {
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
    if (current === 'delivered' && !correctFalseDelivered) return null;
    return current === 'label_generated' ? null : 'label_generated';
  }

  const resolved = resolveDelhiveryPipelineStatus(track);
  if (!resolved) return null;

  // Returned / cancelled are terminal ops outcomes from Delhivery.
  if (resolved === 'returned' || resolved === 'cancelled') {
    return resolved;
  }

  if (correctFalseDelivered && current === 'delivered' && resolved !== 'delivered') {
    return resolved;
  }
  if (current === 'delivered') return null;

  const rank = {
    label_generated: 0,
    shipped: 1,
    in_transit: 2,
    delivered: 3,
  };
  const nextRank = rank[resolved] ?? -1;
  const currentRank = rank[current] ?? -1;
  return nextRank > currentRank ? resolved : null;
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
  const updatePipelineStatus = options.updatePipelineStatus !== false;
  const correctFalseDelivered = Boolean(options.correctFalseDelivered);
  const currentStatus = String(options.currentStatus || '');

  // Reuse ST snapshot builder for courierTrack shape, then override inference.
  const patch = buildStCourierTrackingPatch(track, {
    currentStatus,
    updatePipelineStatus: false,
    correctFalseDelivered,
  });

  if (patch.courierTrack && typeof patch.courierTrack === 'object') {
    const statusType = track.statusType == null
      ? null
      : String(track.statusType).trim().toUpperCase() || null;
    patch.courierTrack = {
      ...patch.courierTrack,
      statusType,
      sourceUrl: String(
        track.sourceUrl
        || patch.courierTrack.sourceUrl
        || 'https://www.delhivery.com/track/package/',
      ),
    };
  }

  if (updatePipelineStatus) {
    const nextStatus = inferLogisticsStatusFromDelhiveryTrack(track, currentStatus, {
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
        patch.deliveredAt = track.deliveredAt || now;
      } else if (currentStatus === 'delivered') {
        patch.deliveredAt = null;
      }
      if (nextStatus === 'returned' || nextStatus === 'cancelled') {
        // Keep deliveredAt unset for non-delivery terminals.
        if (currentStatus === 'delivered') patch.deliveredAt = null;
      }
    }
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
  inferLogisticsStatusFromDelhiveryTrack as inferDelhiveryPipelineStatus,
};
