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

const PICKUP_REGISTERED_RE = /pickup\s+has\s+been\s+registered/i;
const BLUE_DART_DELIVERED_RE = /\bdelivered\b|\bdelivery\s+(completed|done|successful)\b|\bpod\b/i;
const BLUE_DART_RETURNED_RE = /\b(rto|return\s*to\s*origin|returned)\b/i;
const BLUE_DART_CANCELLED_RE = /\b(cancel+ed|cancelled)\b/i;
const BLUE_DART_TRANSIT_RE = /\b(in\s*transit|out\s*for\s*delivery|ofd|reached|arrived|dispatched|manifest|transit|hub|branch|undelivered|on\s*hold|held|attempted|outscanned)\b|shipment\s+picked|\bpicked\s+up\b/i;

function blueDartActivityLines(track) {
  const lines = [String(track?.status || '')];
  if (Array.isArray(track?.history)) {
    for (const item of track.history) {
      lines.push(String(item?.activity || ''));
    }
  }
  return lines.map(line => line.trim()).filter(Boolean);
}

function isBlueDartPickupRegisteredOnly(track) {
  const lines = blueDartActivityLines(track);
  if (!lines.length) return false;
  const hasRegistered = lines.some(line => PICKUP_REGISTERED_RE.test(line));
  if (!hasRegistered) return false;
  const moved = lines.some((line) => {
    const rest = line.replace(/pickup\s+has\s+been\s+registered/gi, ' ').trim();
    if (!rest) return false;
    return BLUE_DART_TRANSIT_RE.test(rest)
      || BLUE_DART_DELIVERED_RE.test(rest)
      || BLUE_DART_RETURNED_RE.test(rest);
  });
  return !moved;
}

/**
 * Pickup registered stays Booked. Actual pickup / transit → In Transit.
 * @returns {'label_generated' | 'in_transit' | 'delivered' | 'returned' | 'cancelled' | null}
 */
export function inferLogisticsStatusFromBlueDartTrack(track, currentStatus) {
  const currentRaw = String(currentStatus || '');
  const current = (
    currentRaw === 'tracking_failed' || currentRaw === 'status_not_available'
  )
    ? 'label_generated'
    : currentRaw === 'shipped'
      ? 'in_transit'
      : currentRaw;
  if (current === 'cancelled' || current === 'returned') return null;
  if (!track?.ok) {
    if (current === 'delivered') return null;
    return current === 'label_generated' ? null : 'label_generated';
  }

  const statusType = String(track.statusType || '').trim().toUpperCase();
  const bits = blueDartActivityLines(track).join(' ');

  if (statusType === 'DL' || Boolean(String(track.deliveredAt || '').trim()) || BLUE_DART_DELIVERED_RE.test(bits)) {
    return current === 'delivered' ? null : 'delivered';
  }
  if (statusType === 'RT' || BLUE_DART_RETURNED_RE.test(bits)) {
    return current === 'returned' ? null : 'returned';
  }
  if (statusType === 'CN' || BLUE_DART_CANCELLED_RE.test(bits)) {
    return current === 'cancelled' ? null : 'cancelled';
  }
  if (current === 'delivered') return null;

  if (isBlueDartPickupRegisteredOnly(track)) {
    return current === 'label_generated' ? null : 'label_generated';
  }

  const inTransit = statusType === 'IT'
    || statusType === 'UD'
    || BLUE_DART_TRANSIT_RE.test(bits.replace(/pickup\s+has\s+been\s+registered/gi, ' '));
  if (inTransit) {
    return current === 'in_transit' ? null : 'in_transit';
  }

  return current === 'label_generated' ? null : 'label_generated';
}

export function buildBlueDartTrackingPatch(track, options = {}) {
  const patch = buildStCourierTrackingPatch(track, {
    ...options,
    updatePipelineStatus: false,
  });
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
  if (options.updatePipelineStatus === false) return patch;

  const currentStatus = String(options.currentStatus || '');
  const nextStatus = inferLogisticsStatusFromBlueDartTrack(track, currentStatus);
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
