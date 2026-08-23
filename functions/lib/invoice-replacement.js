/**
 * Full product replacement window: 7 IST calendar days from goods received
 * (courier POD, ops delivered, or customer pickup) — not the invoice date.
 */
import { getFirestore } from 'firebase-admin/firestore';

export const PRODUCT_REPLACEMENT_WINDOW_DAYS = 7;

const IST = 'Asia/Kolkata';
const BOOKINGS = 'logisticsBookings';

function firstTimestamp(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text && text !== '[object Object]') return text;
  }
  return null;
}

function parseReceivingInstant(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso && !text.includes('T') && !text.includes(' ')) {
    const parsed = new Date(`${iso[0]}T12:00:00+05:30`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calendarDateIst(value) {
  const date = parseReceivingInstant(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addCalendarDays(ymd, days) {
  const [year, month, day] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return next.toISOString().slice(0, 10);
}

function bookingRank(booking) {
  const delivered = Boolean(
    firstTimestamp(booking?.courierTrack?.deliveredAt, booking?.deliveredAt),
  );
  if (booking?.status === 'delivered' || delivered) return 3;
  if (booking?.status === 'in_transit' || booking?.status === 'shipped') return 2;
  if (booking?.status === 'cancelled' || booking?.status === 'returned') return 0;
  return 1;
}

function rankBookings(list) {
  return [...list].sort((a, b) => bookingRank(b) - bookingRank(a))[0] ?? null;
}

function addBookingToInvoiceMap(grouped, data) {
  const booking = {
    status: data.status ? String(data.status) : null,
    deliveredAt: data.deliveredAt ? String(data.deliveredAt) : null,
    courierTrack: data.courierTrack && typeof data.courierTrack === 'object'
      ? data.courierTrack
      : null,
  };
  const ids = [
    ...(Array.isArray(data.invoiceIds) ? data.invoiceIds : []),
    ...(Array.isArray(data.invoices) ? data.invoices.map(row => row?.invoiceId) : []),
    data.invoiceId,
  ].map(id => String(id || '').trim()).filter(Boolean);
  for (const invoiceId of [...new Set(ids)]) {
    const list = grouped.get(invoiceId);
    if (list) list.push(booking);
    else grouped.set(invoiceId, [booking]);
  }
}

async function resolveDealerUidForCustomer(customerId) {
  const cid = String(customerId || '').trim();
  if (!cid) return null;
  const db = getFirestore();
  const snap = await db.collection('zohoCustomers').doc(cid).get();
  const portalUserId = String(snap.data()?.portalUserId ?? '').trim();
  return portalUserId || null;
}

async function loadBookingsByInvoiceForCustomer(customerId) {
  const db = getFirestore();
  const cid = String(customerId || '').trim();
  const grouped = new Map();
  if (!cid) return new Map();

  const queries = [
    db.collection(BOOKINGS).where('zohoCustomerId', '==', cid).get(),
  ];
  const dealerUid = await resolveDealerUidForCustomer(cid).catch(() => null);
  if (dealerUid) {
    queries.push(db.collection(BOOKINGS).where('dealerId', '==', dealerUid).get());
  }

  const snaps = await Promise.all(queries);
  for (const snap of snaps) {
    for (const docSnap of snap.docs) {
      addBookingToInvoiceMap(grouped, docSnap.data() ?? {});
    }
  }

  const best = new Map();
  for (const [invoiceId, list] of grouped) {
    const booking = rankBookings(list);
    if (booking) best.set(invoiceId, booking);
  }
  return best;
}

async function findAdminBookingForInvoice(invoiceId) {
  const db = getFirestore();
  const id = String(invoiceId || '').trim();
  if (!id) return null;
  const [primarySnap, clubbedSnap] = await Promise.all([
    db.collection(BOOKINGS).where('invoiceId', '==', id).limit(10).get(),
    db.collection(BOOKINGS).where('invoiceIds', 'array-contains', id).limit(10).get(),
  ]);
  const grouped = new Map();
  for (const snap of [primarySnap, clubbedSnap]) {
    for (const docSnap of snap.docs) {
      addBookingToInvoiceMap(grouped, docSnap.data() ?? {});
    }
  }
  return rankBookings(grouped.get(id) ?? []) ?? null;
}

export function invoiceGoodsReceivedAt(invoice, booking) {
  return firstTimestamp(
    invoice?.goodsReceivedAt,
    booking?.courierTrack?.deliveredAt,
    booking?.deliveredAt,
    invoice?.manualDelivery?.markedAt,
    invoice?.manualDeliveredAt,
    invoice?.customerPickup?.markedAt,
    invoice?.customerPickupMarkedAt,
  );
}

export function isInvoiceEligibleForProductReplacement(invoice, booking, now = new Date()) {
  const receivedAt = invoiceGoodsReceivedAt(invoice, booking);
  if (!receivedAt) return false;
  const today = calendarDateIst(now);
  const receivedDay = calendarDateIst(receivedAt);
  if (!today || !receivedDay) return false;
  const deadline = addCalendarDays(receivedDay, PRODUCT_REPLACEMENT_WINDOW_DAYS);
  return today <= deadline;
}

export async function attachGoodsReceivedAtToInvoices(customerId, invoices) {
  if (!Array.isArray(invoices) || !invoices.length) return invoices;
  const bookings = await loadBookingsByInvoiceForCustomer(customerId);
  return invoices.map(invoice => ({
    ...invoice,
    goodsReceivedAt: invoiceGoodsReceivedAt(invoice, bookings.get(String(invoice.id))),
  }));
}

export async function attachGoodsReceivedAtToInvoice(invoice) {
  if (!invoice) return invoice;
  const booking = await findAdminBookingForInvoice(invoice.id);
  return {
    ...invoice,
    goodsReceivedAt: invoiceGoodsReceivedAt(invoice, booking),
  };
}

/** Keep only invoices received in the last 7 days, with goodsReceivedAt set. */
export async function filterReplacementEligibleInvoices(customerId, invoices) {
  const withReceiving = await attachGoodsReceivedAtToInvoices(customerId, invoices);
  return withReceiving.filter(invoice => isInvoiceEligibleForProductReplacement(invoice));
}
