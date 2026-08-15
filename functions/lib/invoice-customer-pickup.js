/**
 * Mark invoices as customer pickup (no logistics booking) and optional e-way Part B.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { invoicesCollection } from './invoice-sync.js';
import { patchInvoiceSummaryListFields } from './invoice-stats.js';
import {
  ensureInvoiceEwayBillForCustomerPickup,
  isEwayBillRequired,
} from './invoice-ewaybill.js';
import { resolveInvoiceShipFromSite } from './eway-shipping-context.js';

const PICKUP_PARTNER_ID = 'personal_collection';

async function findActiveLogisticsBookingId(db, invoiceId) {
  const snap = await db.collection('logisticsBookings')
    .where('invoiceId', '==', String(invoiceId).trim())
    .limit(20)
    .get();
  for (const row of snap.docs) {
    const status = String(row.data()?.status ?? '').toLowerCase();
    if (status !== 'cancelled' && status !== 'returned') {
      return row.id;
    }
  }
  return null;
}

function normalizeCustomerPickup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const markedAt = String(raw.markedAt ?? '').trim();
  if (!markedAt || markedAt === '[object Object]') return null;
  return {
    markedAt,
    markedByUid: String(raw.markedByUid ?? '').trim() || null,
    markedByName: String(raw.markedByName ?? '').trim() || null,
    shipFromSite: String(raw.shipFromSite ?? 'cochin').trim() || 'cochin',
    shipFromLabel: raw.shipFromLabel ? String(raw.shipFromLabel).trim() : null,
    vehicleNumber: raw.vehicleNumber ? String(raw.vehicleNumber).trim().toUpperCase() : null,
  };
}

/** Invoice list reads slim invoiceSummaries — pickup must be mirrored there. */
async function writeCustomerPickupDocs(customerId, invoiceId, customerPickup) {
  const payload = {
    customerPickup,
    customerPickupMarkedAt: customerPickup.markedAt,
  };
  await invoicesCollection(customerId).doc(invoiceId).set(payload, { merge: true });
  await patchInvoiceSummaryListFields(customerId, invoiceId, payload);
}

/**
 * @param {object} secrets
 * @param {string} orgId
 * @param {{
 *   customerId: string;
 *   invoiceId: string;
 *   shipFromSite?: string | null;
 *   vehicleNumber?: string | null;
 *   markedByUid: string;
 *   markedByName: string;
 * }} input
 */
export async function markInvoiceCustomerPickup(secrets, orgId, input) {
  const customerId = String(input.customerId ?? '').trim();
  const invoiceId = String(input.invoiceId ?? '').trim();
  const vehicleNumber = String(input.vehicleNumber ?? '').trim().toUpperCase().replace(/\s+/g, '') || null;
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

  const resolvedShipFrom = await resolveInvoiceShipFromSite(db, invoice);
  const effectiveShipFromSite = resolvedShipFrom.site;

  const existingPickup = normalizeCustomerPickup(invoice.customerPickup);
  if (existingPickup) {
    throw new Error('This invoice is already marked as customer pickup.');
  }

  const activeBookingId = await findActiveLogisticsBookingId(db, invoiceId);
  if (activeBookingId) {
    throw new Error('This invoice already has a logistics booking. Cancel it before marking customer pickup.');
  }

  const invoiceTotal = Number(invoice.total ?? 0);
  const ewayRequired = isEwayBillRequired(invoiceTotal);
  if (ewayRequired && !vehicleNumber) {
    throw new Error(
      'Vehicle number is required — this invoice total exceeds ₹50,000 incl. GST and needs e-way bill Part B.',
    );
  }

  const now = new Date().toISOString();
  const customerPickup = {
    markedAt: now,
    markedByUid,
    markedByName,
    shipFromSite: effectiveShipFromSite,
    shipFromLabel: resolvedShipFrom.branchLabel,
    vehicleNumber,
  };

  await writeCustomerPickupDocs(customerId, invoiceId, customerPickup);

  let eway = null;
  if (ewayRequired && vehicleNumber) {
    eway = await ensureInvoiceEwayBillForCustomerPickup(secrets, orgId, {
      customerId,
      invoiceId,
      shipFromSite: effectiveShipFromSite,
      vehicleNumber,
    });
  }

  return {
    customerPickup,
    partnerId: PICKUP_PARTNER_ID,
    ewayRequired,
    eway,
  };
}

/**
 * Update Part B vehicle on an invoice already marked customer pickup.
 */
export async function updateCustomerPickupEwayPartB(secrets, orgId, input) {
  const customerId = String(input.customerId ?? '').trim();
  const invoiceId = String(input.invoiceId ?? '').trim();
  const vehicleNumber = String(input.vehicleNumber ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!customerId || !invoiceId) {
    throw new Error('Customer id and invoice id are required.');
  }
  if (!vehicleNumber) {
    throw new Error('Vehicle number is required.');
  }

  const db = getFirestore();
  const snap = await invoicesCollection(customerId).doc(invoiceId).get();
  if (!snap.exists) throw new Error('Invoice not found.');
  const invoice = snap.data() ?? {};
  const pickup = normalizeCustomerPickup(invoice.customerPickup);
  if (!pickup) {
    throw new Error('This invoice is not marked as customer pickup.');
  }

  const resolvedShipFrom = await resolveInvoiceShipFromSite(db, invoice);
  const shipFromSite = resolvedShipFrom.site;

  const eway = await ensureInvoiceEwayBillForCustomerPickup(secrets, orgId, {
    customerId,
    invoiceId,
    shipFromSite,
    vehicleNumber,
  });

  const customerPickup = {
    ...pickup,
    shipFromSite,
    shipFromLabel: resolvedShipFrom.branchLabel,
    vehicleNumber,
  };
  await writeCustomerPickupDocs(customerId, invoiceId, customerPickup);

  return {
    customerPickup,
    eway,
  };
}
