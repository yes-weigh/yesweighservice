/**
 * Super-admin local courier switch on an invoiced document.
 * Writes YesOne only — never updates Zoho (e-invoice invoices cannot change).
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { invoicesCollection } from './invoice-sync.js';
import { patchInvoiceSummaryListFields } from './invoice-stats.js';
import {
  freightOptionForSku,
  freightSkuFromInvoiceLines,
  partnerIdForFreightSku,
} from './freight-lines.js';

const PIPELINE_SKUS = new Set([
  'STFRC',
  'TRAIR',
  'TRFRC',
  'DELFRC',
  'BDAIR',
  'BDFRC',
  'BDDP',
]);

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

function zohoFreightSku(invoice) {
  return freightSkuFromInvoiceLines(invoice?.lineItems) || null;
}

/**
 * @param {{
 *   customerId: string;
 *   invoiceId: string;
 *   sku: string;
 *   markedByUid: string;
 *   markedByName: string;
 * }} input
 */
export async function setInvoiceLocalFreightPartner(input) {
  const customerId = String(input.customerId ?? '').trim();
  const invoiceId = String(input.invoiceId ?? '').trim();
  const sku = String(input.sku ?? '').trim().toUpperCase();
  const markedByUid = String(input.markedByUid ?? '').trim();
  const markedByName = String(input.markedByName ?? '').trim() || 'YESWEIGH';

  if (!customerId || !invoiceId) {
    throw new Error('Customer id and invoice id are required.');
  }
  if (!markedByUid) {
    throw new Error('User is required.');
  }
  if (!PIPELINE_SKUS.has(sku)) {
    throw new Error('Choose a delivery partner that YesOne can book.');
  }

  const option = freightOptionForSku(sku);
  const partnerId = partnerIdForFreightSku(sku);
  if (!option || !partnerId) {
    throw new Error('Choose a delivery partner that YesOne can book.');
  }

  const db = getFirestore();
  const snap = await invoicesCollection(customerId).doc(invoiceId).get();
  if (!snap.exists) {
    throw new Error('Invoice not found in portal. Sync invoices from Zoho first.');
  }
  const invoice = snap.data() ?? {};

  if (String(invoice.status ?? '').trim().toLowerCase() === 'void') {
    throw new Error('Void invoices cannot change logistics partner.');
  }
  if (pickupAlreadyMarked(invoice.customerPickup) || invoice.sourceSalesOrderIsPickup) {
    throw new Error('Customer pickup invoices have no courier partner to change.');
  }

  const bookingSnap = await findActiveLogisticsBooking(db, invoiceId);
  if (bookingSnap) {
    throw new Error('Logistics is already booked for this invoice. Partner cannot be changed.');
  }

  const previousSku = zohoFreightSku(invoice);
  const previousPartnerId = previousSku ? partnerIdForFreightSku(previousSku) : null;
  const now = new Date().toISOString();

  const yesOneFreightPartner = sku === previousSku
    ? null
    : {
      partnerId,
      sku,
      previousPartnerId: previousPartnerId || null,
      previousSku: previousSku || null,
      updatedAt: now,
      updatedByUid: markedByUid,
      updatedByName: markedByName,
    };

  const payload = yesOneFreightPartner
    ? { yesOneFreightPartner }
    : { yesOneFreightPartner: FieldValue.delete() };
  await invoicesCollection(customerId).doc(invoiceId).set(payload, { merge: true });
  await patchInvoiceSummaryListFields(customerId, invoiceId, {
    freightSku: yesOneFreightPartner?.sku || previousSku || null,
  });

  return { yesOneFreightPartner };
}
