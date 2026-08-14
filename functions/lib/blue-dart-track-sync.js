/**
 * Persist Blue Dart track results onto logisticsBookings and advance pipeline status.
 * Mirrors trackon-track-sync.js for bluedart_air / bluedart_surface / bluedart_domestic.
 */

import { fetchBlueDartTrack } from './blue-dart-api.js';
import {
  OPEN_LOGISTICS_STATUSES,
  awbFromLogisticsBooking,
  buildStCourierTrackingPatch,
} from './st-courier-track-sync.js';

export const BLUEDART_PARTNER_IDS = Object.freeze([
  'bluedart_air',
  'bluedart_surface',
  'bluedart_domestic',
  'bluedart',
]);

export function isBlueDartPartnerId(partnerId) {
  return BLUEDART_PARTNER_IDS.includes(String(partnerId || ''));
}

export function buildBlueDartTrackingPatch(track, options = {}) {
  const patch = buildStCourierTrackingPatch(track, options);
  if (patch.courierTrack && typeof patch.courierTrack === 'object') {
    patch.courierTrack = {
      ...patch.courierTrack,
      ...(track.statusType != null ? { statusType: String(track.statusType) } : {}),
      sourceUrl: String(
        track.sourceUrl
        || patch.courierTrack.sourceUrl
        || 'https://www.bluedart.com/web/guest/trackdartplus',
      ),
    };
  }
  return patch;
}

export async function persistBlueDartTrackOnBooking(db, bookingId, track, options = {}) {
  const id = String(bookingId || '').trim();
  if (!id || !track) return;
  const ref = db.collection('logisticsBookings').doc(id);
  const snap = await ref.get();
  const current = snap.exists ? (snap.data() || {}) : {};
  const patch = buildBlueDartTrackingPatch(track, {
    currentStatus: current.status,
    updatePipelineStatus: options.updatePipelineStatus !== false,
  });
  await ref.set({
    ...patch,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
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
 * @param {Record<string, unknown>} [options]
 */
export async function syncBlueDartTrackingForBookings(db, options = {}) {
  const includeDelivered = Boolean(options.includeDelivered);
  const includeCancelled = Boolean(options.includeCancelled);
  const dryRun = Boolean(options.dryRun);
  const concurrency = Number(options.concurrency) || 2;
  const delayMs = Number(options.delayMs) || 350;
  const limit = Number(options.limit) || 0;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  const snap = await db.collection('logisticsBookings')
    .where('partnerId', 'in', ['bluedart_air', 'bluedart_surface', 'bluedart_domestic'])
    .get();

  /** @type {FirebaseFirestore.QueryDocumentSnapshot[]} */
  const targets = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const status = String(data.status || '');
    if (!includeCancelled && (status === 'cancelled' || status === 'returned')) continue;
    if (!includeDelivered && status === 'delivered') continue;
    if (!includeDelivered && !OPEN_LOGISTICS_STATUSES.includes(status)) continue;
    if (!awbFromLogisticsBooking(data)) continue;
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
    errors: [],
  };

  await mapPool(targets, concurrency, async (docSnap) => {
    const data = docSnap.data() || {};
    const awb = awbFromLogisticsBooking(data);
    try {
      const track = await fetchBlueDartTrack(db, awb);
      if (!track.ok) {
        summary.fetchedFail += 1;
        onProgress?.({ type: 'error', id: docSnap.id, awb, error: track.error });
        return;
      }
      summary.fetchedOk += 1;
      const patch = buildBlueDartTrackingPatch(track, {
        currentStatus: data.status,
        updatePipelineStatus: true,
      });
      const statusChanged = Boolean(patch.status && patch.status !== data.status);
      if (statusChanged) summary.statusAdvanced += 1;
      if (!dryRun) {
        await docSnap.ref.set({
          ...patch,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        summary.updated += 1;
      }
      onProgress?.({ type: 'ok', id: docSnap.id, awb, status: patch.status || data.status });
    } catch (err) {
      summary.fetchedFail += 1;
      summary.errors.push({ id: docSnap.id, awb, error: err?.message || String(err) });
      onProgress?.({ type: 'error', id: docSnap.id, awb, error: err?.message || String(err) });
    }
    if (delayMs > 0) await sleep(delayMs);
  });

  return summary;
}
