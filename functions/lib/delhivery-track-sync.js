/**
 * Persist Delhivery track results onto logisticsBookings and advance pipeline status.
 */

import {
  fetchDelhiveryTrack,
  isDelhiveryB2bLrn,
  isDelhiveryMasterAwb,
  normalizeDelhiveryLrn,
  uniqueDelhiveryTrackIds,
} from './delhivery-track.js';
import {
  buildDelhiveryFreightPatch,
  fetchDelhiveryFreightCharges,
  inferDelhiveryFreightBillingMode,
  normalizeDelhiveryFreightBillingMode,
  trackHasWeightCaptured,
} from './delhivery-freight.js';
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
 * Prefer 9-digit B2B LRN. Never treat Master AWB as LRN (freight API rejects it).
 * @param {Record<string, unknown>} data
 */
export function lrnFromLogisticsBooking(data) {
  const ids = trackIdsFromLogisticsBooking(data);
  const lrn = ids.find(id => isDelhiveryB2bLrn(id));
  if (lrn) return lrn;
  // Legacy: short non-MWB ids only (avoid 14-digit MWB).
  const fallback = ids.find(id => id && !isDelhiveryMasterAwb(id));
  return fallback || '';
}

/**
 * LRN + Master AWB candidates for track fallback.
 * @param {Record<string, unknown>} data
 */
export function trackIdsFromLogisticsBooking(data) {
  const track = data?.courierTrack && typeof data.courierTrack === 'object'
    ? /** @type {Record<string, unknown>} */ (data.courierTrack)
    : {};
  return uniqueDelhiveryTrackIds(
    data?.consignmentNo,
    data?.trackingNo,
    data?.masterAwb,
    data?.delhiveryMasterAwb,
    track.masterAwb,
    track.awb,
  );
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

  // Reuse ST snapshot builder for courierTrack shape + bookingDate sync, then override status.
  const patch = buildStCourierTrackingPatch(track, {
    currentStatus,
    currentBookingDate: options.currentBookingDate,
    bookingSource: options.bookingSource,
    updateBookingDate: options.updateBookingDate,
    updatePipelineStatus: false,
    correctFalseDelivered,
  });

  if (patch.courierTrack && typeof patch.courierTrack === 'object') {
    const statusType = track.statusType == null
      ? null
      : String(track.statusType).trim().toUpperCase() || null;
    const masterAwb = track.masterAwb == null
      ? null
      : String(track.masterAwb).trim() || null;
    patch.courierTrack = {
      ...patch.courierTrack,
      statusType,
      ...(masterAwb ? { masterAwb } : {}),
      sourceUrl: String(
        track.sourceUrl
        || patch.courierTrack.sourceUrl
        || 'https://www.delhivery.com/track/package/',
      ),
    };
    // Keep LRN as identity when track.awb is the 9-digit LR; stash MWB for Express refresh.
    if (masterAwb) {
      patch.masterAwb = masterAwb;
      patch.trackingNo = masterAwb;
    }
    const trackAwb = String(track.awb || '').trim();
    if (/^\d{9}$/.test(trackAwb)) {
      patch.consignmentNo = trackAwb;
    }
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
    const ids = trackIdsFromLogisticsBooking(data);
    if (!ids.length) continue;
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
    const ids = trackIdsFromLogisticsBooking(data);
    const awb = ids[0] || '';
    const currentStatus = String(data.status || '');

    let track;
    try {
      track = await fetchDelhiveryTrack(db, awb, { alternateIds: ids.slice(1) });
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
      const freightPatch = await maybeDelhiveryFreightPatch(db, {
        ...data,
        courierTrack: track,
        consignmentNo: awb,
      }, track);
      await docSnap.ref.update({ ...patch, ...freightPatch });
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
 * After weight captured, pull Delhivery freight-breakup into the booking.
 * @param {FirebaseFirestore.Firestore} db
 * @param {Record<string, unknown>} data
 * @param {unknown} track
 */
/**
 * Resolve FOD/BTC: keep explicit booking/ops mode, else API hint, else estimate inference.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {Record<string, unknown>} data
 * @param {{
 *   previousBillingMode?: 'fod' | 'btc' | null,
 *   trackBillingHint?: 'fod' | 'btc' | null,
 *   apiBillingMode?: 'fod' | 'btc' | null,
 *   actualTotalInr?: number | null,
 * }} bits
 */
async function resolveFreightBillingMode(db, data, bits) {
  if (bits.previousBillingMode === 'fod' || bits.previousBillingMode === 'btc') {
    return { mode: bits.previousBillingMode, source: null };
  }
  if (bits.apiBillingMode === 'fod' || bits.apiBillingMode === 'btc') {
    return { mode: bits.apiBillingMode, source: 'api' };
  }
  if (bits.trackBillingHint === 'fod' || bits.trackBillingHint === 'btc') {
    return { mode: bits.trackBillingHint, source: 'api' };
  }
  try {
    const inferred = await inferDelhiveryFreightBillingMode(db, data, bits.actualTotalInr);
    if (inferred.mode) return { mode: inferred.mode, source: 'inferred' };
  } catch {
    // Inference is best-effort; freight sync should still persist amounts.
  }
  return { mode: null, source: null };
}

async function maybeDelhiveryFreightPatch(db, data, track) {
  const effectiveTrack = track || data.courierTrack;
  if (!trackHasWeightCaptured(effectiveTrack)) return {};
  const previousBillingMode = (
    data.freightBillingMode === 'fod' || data.freightBillingMode === 'btc'
      ? data.freightBillingMode
      : (data.courierFreight?.billingMode === 'fod' || data.courierFreight?.billingMode === 'btc'
        ? data.courierFreight.billingMode
        : null)
  );
  // Track may surface freight_mode into consignmentType — use as FOD/BTC hint.
  const trackBillingHint = normalizeDelhiveryFreightBillingMode(
    effectiveTrack?.consignmentType,
    effectiveTrack?.freightMode,
    effectiveTrack?.freight_mode,
  );
  const lrn = lrnFromLogisticsBooking(data);
  if (!lrn) {
    const mwb = trackIdsFromLogisticsBooking(data).find(id => isDelhiveryMasterAwb(id)) || '';
    if (!mwb) return {};
    const fetchedAt = new Date().toISOString();
    const resolved = await resolveFreightBillingMode(db, data, {
      previousBillingMode,
      trackBillingHint,
      actualTotalInr: null,
    });
    return {
      courierFreight: {
        ok: false,
        lrn: mwb,
        totalInr: null,
        chargedWeightKg: null,
        minChargedWeightKg: null,
        breakup: null,
        billingMode: resolved.mode,
        error: '9-digit LRN required for freight (this booking only has Master AWB)',
        fetchedAt,
        source: 'delhivery_freight_breakup',
      },
      freightFetchedAt: fetchedAt,
      ...(resolved.mode ? {
        freightBillingMode: resolved.mode,
        ...(resolved.source ? { freightBillingModeSource: resolved.source } : {}),
      } : {}),
    };
  }
  try {
    const result = await fetchDelhiveryFreightCharges(db, [lrn]);
    const freight = result.byLrn[lrn];
    if (!freight) {
      const resolved = await resolveFreightBillingMode(db, data, {
        previousBillingMode,
        trackBillingHint,
        actualTotalInr: null,
      });
      return {
        courierFreight: {
          ok: false,
          lrn,
          totalInr: null,
          chargedWeightKg: null,
          minChargedWeightKg: null,
          breakup: null,
          billingMode: resolved.mode,
          error: result.error || 'No freight data',
          fetchedAt: result.fetchedAt,
          source: 'delhivery_freight_breakup',
        },
        freightFetchedAt: result.fetchedAt,
        ...(resolved.mode ? {
          freightBillingMode: resolved.mode,
          ...(resolved.source ? { freightBillingModeSource: resolved.source } : {}),
        } : {}),
      };
    }
    const resolved = await resolveFreightBillingMode(db, {
      ...data,
      courierFreight: freight,
      chargeableWeightKg: freight.chargedWeightKg ?? data.chargeableWeightKg,
    }, {
      previousBillingMode,
      trackBillingHint,
      apiBillingMode: freight.billingMode,
      actualTotalInr: freight.totalInr,
    });
    const withMode = {
      ...freight,
      billingMode: resolved.mode,
    };
    return buildDelhiveryFreightPatch(withMode, {
      previousBillingMode: resolved.mode,
      billingModeSource: resolved.source,
    });
  } catch (err) {
    const resolved = await resolveFreightBillingMode(db, data, {
      previousBillingMode,
      trackBillingHint,
      actualTotalInr: null,
    });
    return {
      courierFreight: {
        ok: false,
        lrn,
        totalInr: null,
        chargedWeightKg: null,
        minChargedWeightKg: null,
        breakup: null,
        billingMode: resolved.mode,
        error: err?.message || String(err),
        fetchedAt: new Date().toISOString(),
        source: 'delhivery_freight_breakup',
      },
      freightFetchedAt: new Date().toISOString(),
      ...(resolved.mode ? {
        freightBillingMode: resolved.mode,
        ...(resolved.source ? { freightBillingModeSource: resolved.source } : {}),
      } : {}),
    };
  }
}

/**
 * Sync freight charges for Delhivery bookings that already passed weight captured.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{
 *   includeDelivered?: boolean,
 *   includeCancelled?: boolean,
 *   force?: boolean,
 *   dryRun?: boolean,
 *   concurrency?: number,
 *   delayMs?: number,
 *   limit?: number,
 *   onProgress?: (event: Record<string, unknown>) => void,
 * }} [options]
 */
export async function syncDelhiveryFreightForBookings(db, options = {}) {
  const includeDelivered = options.includeDelivered !== false;
  const includeCancelled = Boolean(options.includeCancelled);
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const concurrency = Number(options.concurrency) > 0 ? Number(options.concurrency) : 2;
  const delayMs = Number(options.delayMs) >= 0 ? Number(options.delayMs) : 350;
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
    const track = data.courierTrack;
    if (!trackHasWeightCaptured(track)) continue;
    const lrn = lrnFromLogisticsBooking(data);
    if (!lrn) continue;
    const existingOk = Boolean(data.courierFreight?.ok && data.courierFreight?.totalInr != null);
    const hasBillingMode = data.freightBillingMode === 'fod' || data.freightBillingMode === 'btc'
      || data.courierFreight?.billingMode === 'fod'
      || data.courierFreight?.billingMode === 'btc';
    // Fetch freight when missing; also revisit rows that have freight but no FOD/BTC yet.
    if (existingOk && hasBillingMode && !force) continue;
    targets.push(docSnap);
    if (limit && targets.length >= limit) break;
  }

  const summary = {
    scanned: snap.size,
    targeted: targets.length,
    fetchedOk: 0,
    fetchedFail: 0,
    updated: 0,
    skipped: 0,
    errors: /** @type {Array<{ id: string, awb: string, error: string }>} */ ([]),
  };

  await mapPool(targets, concurrency, async (docSnap) => {
    const data = docSnap.data() || {};
    const lrn = lrnFromLogisticsBooking(data);
    const existingOk = Boolean(data.courierFreight?.ok && data.courierFreight?.totalInr != null);
    const hasBillingMode = data.freightBillingMode === 'fod' || data.freightBillingMode === 'btc'
      || data.courierFreight?.billingMode === 'fod'
      || data.courierFreight?.billingMode === 'btc';
    const modeOnly = existingOk && !hasBillingMode && !force;
    let freight = modeOnly ? data.courierFreight : null;
    if (!modeOnly) {
      try {
        const result = await fetchDelhiveryFreightCharges(db, [lrn]);
        freight = result.byLrn[lrn];
        if (!freight?.ok) {
          summary.fetchedFail += 1;
          onProgress({
            type: 'fetched',
            id: docSnap.id,
            awb: lrn,
            ok: false,
            error: freight?.error || result.error,
            dryRun,
          });
        } else {
          summary.fetchedOk += 1;
          onProgress({
            type: 'fetched',
            id: docSnap.id,
            awb: lrn,
            ok: true,
            totalInr: freight.totalInr,
            chargedWeightKg: freight.chargedWeightKg,
            dryRun,
          });
        }
      } catch (err) {
        summary.fetchedFail += 1;
        summary.errors.push({ id: docSnap.id, awb: lrn, error: err?.message || String(err) });
        onProgress({
          type: 'error',
          id: docSnap.id,
          awb: lrn,
          error: err?.message || String(err),
        });
        if (delayMs) await sleep(delayMs);
        return;
      }
    } else {
      summary.fetchedOk += 1;
      onProgress({
        type: 'fetched',
        id: docSnap.id,
        awb: lrn,
        ok: true,
        totalInr: freight?.totalInr,
        chargedWeightKg: freight?.chargedWeightKg,
        modeOnly: true,
        dryRun,
      });
    }

    if (dryRun || !freight) {
      summary.skipped += 1;
      if (delayMs) await sleep(delayMs);
      return;
    }

    try {
      const previousBillingMode = (
        data.freightBillingMode === 'fod' || data.freightBillingMode === 'btc'
          ? data.freightBillingMode
          : (data.courierFreight?.billingMode === 'fod' || data.courierFreight?.billingMode === 'btc'
            ? data.courierFreight.billingMode
            : null)
      );
      const trackBillingHint = normalizeDelhiveryFreightBillingMode(
        data.courierTrack?.consignmentType,
        data.courierTrack?.freightMode,
        data.courierTrack?.freight_mode,
        freight.billingMode,
      );
      const resolved = await resolveFreightBillingMode(db, {
        ...data,
        courierFreight: freight,
        chargeableWeightKg: freight.chargedWeightKg ?? data.chargeableWeightKg,
      }, {
        previousBillingMode,
        trackBillingHint,
        apiBillingMode: normalizeDelhiveryFreightBillingMode(freight.billingMode),
        actualTotalInr: freight.totalInr,
      });
      const withMode = { ...freight, billingMode: resolved.mode || previousBillingMode || null };
      await docSnap.ref.update(buildDelhiveryFreightPatch(withMode, {
        previousBillingMode: withMode.billingMode,
        billingModeSource: resolved.source,
      }));
      summary.updated += 1;
    } catch (err) {
      summary.errors.push({ id: docSnap.id, awb: lrn, error: err?.message || String(err) });
      onProgress({
        type: 'write_error',
        id: docSnap.id,
        awb: lrn,
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
    currentBookingDate: String(data.bookingDate || ''),
    bookingSource: String(data.source || ''),
    updatePipelineStatus: options.updatePipelineStatus !== false,
    updateBookingDate: options.updateBookingDate,
    correctFalseDelivered: options.correctFalseDelivered !== false,
  });
  const freightPatch = await maybeDelhiveryFreightPatch(db, {
    ...data,
    courierTrack: track,
  }, track);
  await ref.update({ ...patch, ...freightPatch });
  return { bookingId, patch: { ...patch, ...freightPatch } };
}

export {
  OPEN_LOGISTICS_STATUSES,
  buildCourierTrackSnapshot,
  inferLogisticsStatusFromStTrack,
  inferLogisticsStatusFromDelhiveryTrack as inferDelhiveryPipelineStatus,
};
