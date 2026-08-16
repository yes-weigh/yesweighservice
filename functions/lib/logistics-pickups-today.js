/**
 * Today's warehouse pickup requests (Delhivery + Blue Dart).
 * Pickup date is IST YYYY-MM-DD stored on the booking.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { createDelhiveryPickupRequest } from './delhivery-pickup.js';

export function istCalendarDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function mapPickupRow(id, data) {
  const partnerId = String(data?.partnerId || '');
  const delhivery = data?.delhiveryPickup && typeof data.delhiveryPickup === 'object'
    ? data.delhiveryPickup
    : null;
  const blueDart = data?.blueDartPickup && typeof data.blueDartPickup === 'object'
    ? data.blueDartPickup
    : null;
  return {
    id,
    partnerId,
    consignmentNo: String(data?.consignmentNo || ''),
    trackingNo: String(data?.trackingNo || ''),
    status: String(data?.status || ''),
    shipFromSite: String(data?.shipFromSite || 'cochin'),
    dealerName: String(data?.dealer?.name || ''),
    receiverName: String(data?.dealer?.contactPerson || ''),
    numberOfBoxes: Number(data?.numberOfBoxes) || 1,
    delhiveryPickup: delhivery,
    blueDartPickup: blueDart,
  };
}

export async function listLogisticsPickupsToday(db, input = {}) {
  const date = String(input.date || '').trim() || istCalendarDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError('invalid-argument', 'Pickup date must be YYYY-MM-DD.');
  }
  const partnerId = String(input.partnerId || '').trim();
  const [delhiverySnap, blueDartSnap] = await Promise.all([
    db.collection('logisticsBookings')
      .where('delhiveryPickup.pickupDate', '==', date)
      .limit(150)
      .get(),
    db.collection('logisticsBookings')
      .where('blueDartPickup.pickupDate', '==', date)
      .limit(150)
      .get(),
  ]);
  const byId = new Map();
  for (const snap of [...delhiverySnap.docs, ...blueDartSnap.docs]) {
    const row = mapPickupRow(snap.id, snap.data());
    if (partnerId && row.partnerId !== partnerId) continue;
    byId.set(snap.id, row);
  }
  return {
    ok: true,
    date,
    partnerId: partnerId || null,
    bookings: [...byId.values()],
  };
}

export async function requestDelhiverySitePickup(db, input = {}) {
  const bookingIds = Array.isArray(input.bookingIds)
    ? input.bookingIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (!bookingIds.length) {
    throw new HttpsError('invalid-argument', 'Select at least one booking.');
  }
  const created = await createDelhiveryPickupRequest(db, {
    shipFromSite: String(input.shipFromSite || 'cochin').trim() || 'cochin',
    pickupLocationName: String(input.pickupLocationName || '').trim() || undefined,
    expectedPackageCount: input.expectedPackageCount,
    pickupDate: input.pickupDate,
    pickupTime: input.pickupTime,
  });
  const pickup = {
    ok: true,
    alreadyExisted: Boolean(created.alreadyExisted),
    pickupId: created.pickupId || null,
    pickupLocationName: created.pickupLocationName || null,
    pickupDate: created.pickupDate || null,
    pickupTime: created.pickupTime || null,
    expectedPackageCount: created.expectedPackageCount ?? null,
    message: created.message || null,
    requestedAt: new Date().toISOString(),
  };
  const updatedAt = new Date().toISOString();
  const batch = db.batch();
  for (const id of bookingIds) {
    batch.update(db.collection('logisticsBookings').doc(id), {
      delhiveryPickup: pickup,
      updatedAt,
    });
  }
  await batch.commit();
  return { ok: true, pickup, bookingIds };
}
