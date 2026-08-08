/**
 * Persist ST Courier track results onto logisticsBookings and optionally
 * advance pipeline status (shipped → in_transit → delivered).
 */

import { fetchStCourierTrack } from './st-courier-track.js';

export const ST_COURIER_PARTNER_ID = 'st_courier';

/** Bookings still open for hourly sync (excludes delivered + cancelled). */
export const OPEN_LOGISTICS_STATUSES = Object.freeze([
  'label_generated',
  'shipped',
  'in_transit',
]);

const STATUS_RANK = Object.freeze({
  label_generated: 0,
  shipped: 1,
  in_transit: 2,
  delivered: 3,
  cancelled: -1,
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
 * Map ST Courier free-text status / history → pipeline status, or null = no change.
 * Never downgrades; never changes cancelled.
 *
 * @param {{
 *   ok?: boolean,
 *   status?: string | null,
 *   deliveredAt?: string | null,
 *   history?: Array<{ activity?: string }>,
 * }} track
 * @param {string} currentStatus
 * @returns {'shipped' | 'in_transit' | 'delivered' | null}
 */
export function inferLogisticsStatusFromStTrack(track, currentStatus) {
  const current = String(currentStatus || '');
  if (current === 'cancelled' || current === 'delivered') return null;
  if (!track?.ok) return null;

  const bits = [
    track.status,
    track.deliveredAt,
    ...(Array.isArray(track.history) ? track.history.map(item => item?.activity) : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const looksDelivered = Boolean(String(track.deliveredAt || '').trim())
    || /\bdelivered\b/.test(bits)
    || /\bdelivery\s+(completed|done|successful)\b/.test(bits)
    || /\bpod\b/.test(bits);

  if (looksDelivered) return 'delivered';

  const looksInTransit = /\b(in\s*transit|out\s*for\s*delivery|ofd|reached|arrived|dispatched|manifest|transit|hub|branch)\b/.test(bits)
    || /\b(out\s*for\s*dlvy|of\s*delivery)\b/.test(bits);

  if (looksInTransit) {
    return rankHigher('in_transit', current) ? 'in_transit' : null;
  }

  const looksShipped = /\b(picked\s*up|pickup|booked|accepted|shipment\s*created|consignment\s*booked)\b/.test(bits);
  if (looksShipped) {
    return rankHigher('shipped', current) ? 'shipped' : null;
  }

  return null;
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
 * Build a Firestore update patch from a track result.
 * Does not bump updatedAt unless pipeline status advances (keeps list sort stable).
 *
 * @param {Awaited<ReturnType<typeof fetchStCourierTrack>>} track
 * @param {{ currentStatus?: string, updatePipelineStatus?: boolean }} [options]
 */
export function buildStCourierTrackingPatch(track, options = {}) {
  const updatePipelineStatus = options.updatePipelineStatus !== false;
  const currentStatus = String(options.currentStatus || '');
  const courierTrack = buildCourierTrackSnapshot(track);
  /** @type {Record<string, unknown>} */
  const patch = {
    courierTrack,
    trackFetchedAt: courierTrack.fetchedAt,
  };

  if (updatePipelineStatus) {
    const nextStatus = inferLogisticsStatusFromStTrack(track, currentStatus);
    if (nextStatus) {
      const now = new Date().toISOString();
      patch.status = nextStatus;
      patch.updatedAt = now;
      if (nextStatus === 'in_transit' && currentStatus !== 'in_transit') {
        patch.inTransitAt = now;
      }
      if (nextStatus === 'delivered') {
        patch.deliveredAt = courierTrack.deliveredAt || now;
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
 *   dryRun?: boolean,
 *   concurrency?: number,
 *   delayMs?: number,
 *   limit?: number,
 *   onProgress?: (event: Record<string, unknown>) => void,
 * }} [options]
 */
export async function syncStCourierTrackingForBookings(db, options = {}) {
  const includeDelivered = Boolean(options.includeDelivered);
  const includeCancelled = Boolean(options.includeCancelled);
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
    if (!includeCancelled && status === 'cancelled') continue;
    if (!includeDelivered && status === 'delivered') continue;
    // Hourly mode: only open pipeline statuses (skip unknown / cancelled / delivered).
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
      updatePipelineStatus: true,
    });
    const statusChanged = typeof patch.status === 'string' && patch.status !== currentStatus;

    onProgress({
      type: 'fetched',
      id: docSnap.id,
      awb,
      ok: track.ok,
      stStatus: track.status,
      error: track.error,
      nextStatus: statusChanged ? patch.status : null,
      dryRun,
    });

    if (dryRun) {
      summary.skipped += 1;
      if (delayMs) await sleep(delayMs);
      return;
    }

    try {
      await docSnap.ref.update(patch);
      summary.updated += 1;
      if (statusChanged) summary.statusAdvanced += 1;
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
 * @param {{ updatePipelineStatus?: boolean }} [options]
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
    updatePipelineStatus: options.updatePipelineStatus !== false,
  });
  await ref.update(patch);
  return { bookingId, patch };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
