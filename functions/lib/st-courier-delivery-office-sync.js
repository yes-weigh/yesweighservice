/**
 * Persist ST Courier destination delivery-office Communication on logistics bookings.
 * Used by create-time fill, callable (indirect), and one-time backfill.
 */

import { fetchStCourierDeliveryOffice } from './st-courier-pincode.js';

export function extractIndianPincode(text) {
  const match = /\b(\d{6})\b/.exec(String(text ?? ''));
  return match?.[1] ?? null;
}

/**
 * @param {FirebaseFirestore.DocumentData | null | undefined} data
 * @returns {boolean}
 */
export function bookingHasCourierDeliveryOffice(data) {
  const office = data?.courierDeliveryOffice;
  if (!office || typeof office !== 'object') return false;
  return Boolean(String(office.communication ?? '').trim());
}

/**
 * @param {Awaited<ReturnType<typeof fetchStCourierDeliveryOffice>>} result
 */
export function courierDeliveryOfficePatch(result) {
  if (!result?.ok || !result.communication) return null;
  return {
    courierDeliveryOffice: {
      pincode: result.pincode,
      communication: result.communication,
      serviceCenter: result.serviceCenter ?? null,
      hubCenter: result.hubCenter ?? null,
      sourceUrl: result.sourceUrl,
      fetchedAt: result.fetchedAt,
    },
  };
}

/**
 * Fetch + write delivery office for one booking doc (ST only, once).
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} bookingId
 * @param {{ force?: boolean, dryRun?: boolean }} [options]
 */
export async function fillCourierDeliveryOfficeOnBooking(db, bookingId, options = {}) {
  const ref = db.collection('logisticsBookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { id: bookingId, updated: false, skipped: true, reason: 'missing' };
  }
  const data = snap.data() || {};
  if (String(data.partnerId || '') !== 'st_courier') {
    return { id: bookingId, updated: false, skipped: true, reason: 'not_st' };
  }
  if (!options.force && bookingHasCourierDeliveryOffice(data)) {
    return { id: bookingId, updated: false, skipped: true, reason: 'already_set' };
  }

  const pincode = extractIndianPincode(data.deliveryAddress)
    || extractIndianPincode(data.dealerSnapshot?.shippingAddress)
    || extractIndianPincode(data.dealerSnapshot?.billingAddress);
  if (!pincode) {
    return { id: bookingId, updated: false, skipped: true, reason: 'no_pincode' };
  }

  const result = await fetchStCourierDeliveryOffice(pincode);
  const patch = courierDeliveryOfficePatch(result);
  if (!patch) {
    return {
      id: bookingId,
      updated: false,
      skipped: true,
      reason: 'not_found',
      pincode,
      error: result.error || null,
    };
  }

  if (!options.dryRun) {
    await ref.set(
      {
        ...patch,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  return {
    id: bookingId,
    updated: true,
    skipped: false,
    pincode,
    communication: patch.courierDeliveryOffice.communication,
  };
}

/**
 * Backfill ST logistics bookings missing courierDeliveryOffice.
 * @param {FirebaseFirestore.Firestore} db
 * @param {{
 *   dryRun?: boolean,
 *   force?: boolean,
 *   limit?: number,
 *   concurrency?: number,
 *   delayMs?: number,
 *   onProgress?: (event: object) => void,
 * }} [options]
 */
export async function syncStCourierDeliveryOfficesForBookings(db, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 0;
  const concurrency = Math.max(1, Number(options.concurrency) || 2);
  const delayMs = Math.max(0, Number(options.delayMs) || 350);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  const snap = await db.collection('logisticsBookings')
    .where('partnerId', '==', 'st_courier')
    .get();

  let targets = snap.docs;
  if (!force) {
    targets = targets.filter(doc => !bookingHasCourierDeliveryOffice(doc.data()));
  }
  if (limit > 0) targets = targets.slice(0, limit);

  const summary = {
    scanned: snap.size,
    targeted: targets.length,
    updated: 0,
    skipped: 0,
    notFound: 0,
    errors: [],
  };

  let index = 0;
  async function worker() {
    while (index < targets.length) {
      const current = index;
      index += 1;
      const doc = targets[current];
      try {
        const result = await fillCourierDeliveryOfficeOnBooking(db, doc.id, { force, dryRun });
        if (result.updated) {
          summary.updated += 1;
          onProgress({ type: 'updated', ...result });
        } else {
          summary.skipped += 1;
          if (result.reason === 'not_found') summary.notFound += 1;
          onProgress({ type: 'skipped', ...result });
        }
      } catch (err) {
        const message = err?.message || String(err);
        summary.errors.push({ id: doc.id, error: message });
        onProgress({ type: 'error', id: doc.id, error: message });
      }
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return summary;
}
