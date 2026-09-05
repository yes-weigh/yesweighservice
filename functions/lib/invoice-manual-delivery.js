/**
 * Mark invoices delivered from the invoice screen (with or without a logistics booking).
 */
import { getFirestore } from 'firebase-admin/firestore';
import { invoicesCollection } from './invoice-sync.js';
import { patchInvoiceSummaryListFields } from './invoice-stats.js';
import { enrichInvoiceLinesCatalogCategory } from './mandatory-serials.js';
import { isNonGatcSerialEligibleLine } from './non-gatc-serial-allot.js';
import { isGatcStampedSerialEligibleLine } from './yesgatc-stamped-serial-allot.js';

function normalizeManualDelivery(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const markedAt = String(raw.markedAt ?? '').trim();
  if (!markedAt || markedAt === '[object Object]') return null;
  return {
    markedAt,
    markedByUid: String(raw.markedByUid ?? '').trim() || null,
    markedByName: String(raw.markedByName ?? '').trim() || null,
  };
}

function pickupAlreadyMarked(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const markedAt = String(raw.markedAt ?? '').trim();
  return Boolean(markedAt && markedAt !== '[object Object]');
}

async function findActiveLogisticsBooking(db, invoiceId) {
  const id = String(invoiceId).trim();
  const [primarySnap, clubbedSnap] = await Promise.all([
    db.collection('logisticsBookings').where('invoiceId', '==', id).limit(20).get(),
    db.collection('logisticsBookings').where('invoiceIds', 'array-contains', id).limit(20).get(),
  ]);
  const byId = new Map();
  for (const snap of [primarySnap, clubbedSnap]) {
    for (const row of snap.docs) byId.set(row.id, row);
  }
  for (const row of byId.values()) {
    const status = String(row.data()?.status ?? '').toLowerCase();
    if (status !== 'cancelled' && status !== 'returned') return row;
  }
  return null;
}

async function writeManualDeliveryDocs(customerId, invoiceId, manualDelivery) {
  const payload = {
    manualDelivery,
    manualDeliveredAt: manualDelivery.markedAt,
  };
  await invoicesCollection(customerId).doc(invoiceId).set(payload, { merge: true });
  await patchInvoiceSummaryListFields(customerId, invoiceId, payload);
}

/**
 * @param {{
 *   customerId: string;
 *   invoiceId: string;
 *   markedByUid: string;
 *   markedByName: string;
 * }} input
 */
export async function markInvoiceDelivered(input) {
  const customerId = String(input.customerId ?? '').trim();
  const invoiceId = String(input.invoiceId ?? '').trim();
  const markedByUid = String(input.markedByUid ?? '').trim();
  const markedByName = String(input.markedByName ?? '').trim() || 'YESWEIGH';

  if (!customerId || !invoiceId) {
    throw new Error('Customer id and invoice id are required.');
  }
  if (!markedByUid) {
    throw new Error('User is required.');
  }

  const db = getFirestore();
  const snap = await invoicesCollection(customerId).doc(invoiceId).get();
  if (!snap.exists) {
    throw new Error('Invoice not found in portal. Sync invoices from Zoho first.');
  }
  const invoice = snap.data() ?? {};

  if (String(invoice.status ?? '').trim().toLowerCase() === 'void') {
    throw new Error('Void invoices cannot be marked delivered.');
  }
  const { healInvoiceSerialsOnDocument } = await import('./non-gatc-serial-allot.js');
  const healed = await healInvoiceSerialsOnDocument({ customerId, invoiceId });
  const lines = await enrichInvoiceLinesCatalogCategory(healed.lineItems);
  const missingSerials = lines.some(line => {
    const need = Math.max(0, Math.round(Number(line.quantity) || 0));
    if (!need) return false;
    if (!isNonGatcSerialEligibleLine(line) && !isGatcStampedSerialEligibleLine(line)) return false;
    const have = Array.isArray(line.serialNumbers)
      ? line.serialNumbers.filter(Boolean).length
      : 0;
    return have < need;
  });
  if (missingSerials) {
    throw new Error('Add serial numbers on weighing-scale lines before marking delivered.');
  }
  if (pickupAlreadyMarked(invoice.customerPickup)) {
    throw new Error('This invoice is already customer pickup (delivered).');
  }

  const existing = normalizeManualDelivery(invoice.manualDelivery)
    || normalizeManualDelivery({ markedAt: invoice.manualDeliveredAt });
  if (existing) {
    throw new Error('This invoice is already marked delivered.');
  }

  const now = new Date().toISOString();
  const manualDelivery = {
    markedAt: now,
    markedByUid,
    markedByName,
  };

  const bookingSnap = await findActiveLogisticsBooking(db, invoiceId);
  const bookingStatus = String(bookingSnap?.data()?.status ?? '').toLowerCase();
  if (bookingStatus === 'delivered') {
    throw new Error('This invoice is already delivered in logistics.');
  }
  if (bookingStatus === 'returned') {
    throw new Error('Returned shipments cannot be marked delivered.');
  }

  await writeManualDeliveryDocs(customerId, invoiceId, manualDelivery);

  if (bookingSnap) {
    await bookingSnap.ref.set({
      status: 'delivered',
      deliveredAt: now,
      updatedAt: now,
    }, { merge: true });
  }

  return {
    manualDelivery,
    logisticsBookingId: bookingSnap?.id ?? null,
  };
}
