/**
 * Raise a Warranty & Support complaint from a logistics booking.
 * Admin SDK so dealers can link the booking and ops can create on behalf
 * without support.* permission gates.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

const OPS_ROLES = new Set(['staff', 'super_admin', 'admin']);

const PARTNER_LABELS = {
  st_courier: 'ST Courier',
  trackon_air: 'Trackon Air',
  trackon_surface: 'Trackon Surface',
  delhivery: 'Delhivery',
  bluedart_air: 'Blue Dart Air',
  bluedart_surface: 'Blue Dart Surface',
  bluedart_domestic: 'Blue Dart Domestic Priority',
  dtdc: 'DTDC',
  ecosafe: 'EcoSafe',
  aps: 'APS',
  personal_collection: 'Personal collection',
};

function normalizeRole(role) {
  if (role === 'admin') return 'super_admin';
  if (role === 'director') return 'dealer';
  if (role === 'director_staff') return 'dealer_staff';
  return role;
}

function readDealerId(data) {
  return data?.dealerId ?? data?.directorId ?? null;
}

/**
 * @param {string} uid
 */
async function readActiveUser(uid) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const snap = await getFirestore().doc(`users/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }
  const data = snap.data() || {};
  if (data.active === false) {
    throw new HttpsError('permission-denied', 'Your account is inactive.');
  }
  return { uid, ...(typeof data === 'object' ? data : {}) };
}

/**
 * @param {Record<string, unknown>} user
 * @param {Record<string, unknown>} booking
 */
function assertBookingAccess(user, booking) {
  const role = normalizeRole(String(user.role || ''));
  if (OPS_ROLES.has(role)) return;

  const bookingDealerId = String(
    booking.dealerId
    || /** @type {Record<string, unknown>} */ (booking.dealerSnapshot || {}).dealerId
    || '',
  ).trim();
  const bookingZoho = String(
    booking.zohoCustomerId
    || /** @type {Record<string, unknown>} */ (booking.dealerSnapshot || {}).zohoCustomerId
    || '',
  ).trim();
  const userZoho = String(user.zohoCustomerId || '').trim();

  if (role === 'dealer') {
    if (bookingDealerId === user.uid || (userZoho && bookingZoho && userZoho === bookingZoho)) {
      return;
    }
  }

  if (role === 'dealer_staff') {
    const parentId = String(readDealerId(user) || '').trim();
    if (parentId && bookingDealerId === parentId) return;
  }

  throw new HttpsError('permission-denied', 'You do not have access to this shipment.');
}

function partnerLabel(partnerId) {
  const id = String(partnerId || '').trim();
  return PARTNER_LABELS[id] || id || 'Courier';
}

function buildRequestNumber() {
  const year = new Date().getFullYear();
  const suffix = String(Math.floor(Math.random() * 900000) + 100000);
  return `CMP-${year}-${suffix}`;
}

/**
 * @param {Record<string, unknown>} booking
 * @param {string} bookingId
 * @param {string} issueText
 */
function buildDescription(booking, bookingId, issueText) {
  const dealer = /** @type {Record<string, unknown>} */ (booking.dealerSnapshot || {});
  const track = /** @type {Record<string, unknown>} */ (booking.courierTrack || {});
  const freight = /** @type {Record<string, unknown>} */ (booking.courierFreight || {});
  const lines = [
    String(issueText || '').trim(),
    '',
    '---',
    'Logistics details (auto-filled)',
    `Booking id: ${bookingId}`,
    `Partner: ${partnerLabel(booking.partnerId)}`,
    `Consignment / LR: ${String(booking.consignmentNo || '—')}`,
    `Tracking no.: ${String(booking.trackingNo || booking.consignmentNo || '—')}`,
  ];

  const masterAwb = String(booking.masterAwb || track.masterAwb || '').trim();
  if (masterAwb) lines.push(`Master AWB (MWB): ${masterAwb}`);

  lines.push(
    `Booking date: ${String(booking.bookingDate || '—')}`,
    `Status: ${String(booking.status || '—')}`,
    `Service type: ${String(booking.serviceType || '—')}`,
    `Branch: ${String(booking.branch || '—')}`,
    `Shipment type: ${String(booking.shipmentMode || '—')}`,
    `Boxes: ${String(booking.numberOfBoxes ?? (Array.isArray(booking.boxes) ? booking.boxes.length : '—'))}`,
  );

  if (booking.actualWeightKg != null) {
    lines.push(`Actual weight: ${Number(booking.actualWeightKg).toFixed(2)} kg`);
  }
  if (booking.chargeableWeightKg != null) {
    lines.push(`Chargeable weight: ${Number(booking.chargeableWeightKg).toFixed(2)} kg`);
  }

  const billingMode = String(booking.freightBillingMode || freight.billingMode || '').trim();
  if (billingMode) lines.push(`Freight billing: ${billingMode.toUpperCase()}`);
  if (typeof booking.actualFreightInr === 'number' && Number.isFinite(booking.actualFreightInr)) {
    lines.push(`Actual freight: ₹${booking.actualFreightInr}`);
  } else if (typeof freight.totalInr === 'number' && Number.isFinite(freight.totalInr)) {
    lines.push(`Courier freight: ₹${freight.totalInr}`);
  }

  lines.push(
    `Dealer: ${String(dealer.name || '—')}${dealer.code ? ` (${dealer.code})` : ''}`,
    `Dealer contact: ${String(dealer.contactPerson || '—')}`,
    `Dealer mobile: ${String(dealer.mobile || (Array.isArray(dealer.phones) ? dealer.phones[0] : '') || '—')}`,
    `Zoho customer id: ${String(booking.zohoCustomerId || dealer.zohoCustomerId || '—')}`,
    `Deliver to: ${String(booking.deliveryAddress || dealer.shippingAddress || '—')}`,
    `Ship from: ${String(booking.shipFromAddress || booking.shipFromSite || '—')}`,
  );

  if (booking.invoiceNumber) {
    lines.push(`Invoice: ${String(booking.invoiceNumber)}`);
  }
  if (booking.invoiceId) {
    lines.push(`Invoice id: ${String(booking.invoiceId)}`);
  }
  if (booking.orderRef) {
    lines.push(`Order ref: ${String(booking.orderRef)}`);
  }
  if (track.status) {
    lines.push(`Courier status: ${String(track.status)}`);
  }
  if (track.origin || track.destination) {
    lines.push(`Route: ${String(track.origin || '—')} → ${String(track.destination || '—')}`);
  }

  return lines.join('\n').trim();
}

/**
 * @param {string} uid
 * @param {{ bookingId?: string, description?: string }} input
 */
export async function raiseLogisticsIssueTicket(uid, input) {
  const bookingId = String(input?.bookingId ?? '').trim();
  const issueText = String(input?.description ?? '').trim();

  if (!bookingId) {
    throw new HttpsError('invalid-argument', 'bookingId is required.');
  }
  if (!issueText) {
    throw new HttpsError('invalid-argument', 'Describe the issue to continue.');
  }
  if (issueText.length > 8000) {
    throw new HttpsError('invalid-argument', 'Issue description is too long.');
  }

  const user = await readActiveUser(uid);
  const role = normalizeRole(String(user.role || ''));
  const displayName = String(user.displayName || user.name || 'User').trim() || 'User';
  const isOps = OPS_ROLES.has(role);

  const db = getFirestore();
  const bookingRef = db.collection('logisticsBookings').doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) {
    throw new HttpsError('not-found', 'Shipment not found.');
  }
  const booking = bookingSnap.data() || {};
  assertBookingAccess(user, booking);

  const dealer = /** @type {Record<string, unknown>} */ (booking.dealerSnapshot || {});
  const zohoCustomerId = String(booking.zohoCustomerId || dealer.zohoCustomerId || '').trim();
  const portalDealerId = String(booking.dealerId || dealer.dealerId || '').trim();
  const dealerName = String(dealer.name || user.displayName || 'Dealer').trim() || 'Dealer';

  let ticketDealerId;
  let ticketZohoCustomerId = null;
  let createdOnBehalfOf = false;

  if (isOps) {
    if (!zohoCustomerId && !portalDealerId) {
      throw new HttpsError(
        'failed-precondition',
        'This shipment has no dealer linked. Add dealer details before raising a ticket.',
      );
    }
    ticketDealerId = portalDealerId || zohoCustomerId;
    ticketZohoCustomerId = zohoCustomerId || null;
    createdOnBehalfOf = true;
  } else if (role === 'dealer') {
    ticketDealerId = uid;
  } else if (role === 'dealer_staff') {
    ticketDealerId = String(readDealerId(user) || '').trim() || uid;
  } else {
    throw new HttpsError('permission-denied', 'Your role cannot raise logistics tickets.');
  }

  const consignmentNo = String(booking.consignmentNo || '').trim();
  const trackingNo = String(booking.trackingNo || consignmentNo || '').trim();
  const awbLabel = trackingNo || consignmentNo || bookingId.slice(0, 8);
  const category = '📦 Logistics & Delivery';
  const subject = `Logistics issue · ${awbLabel}`;
  const description = buildDescription(booking, bookingId, issueText);
  const now = new Date().toISOString();
  const requestNumber = buildRequestNumber();

  const requestRef = db.collection('dealerSupportRequests').doc();
  const requestData = {
    type: 'complaint',
    requestNumber,
    lifecycle: 'open',
    openStage: 'submitted',
    invoiceId: booking.invoiceId ? String(booking.invoiceId) : null,
    invoiceNumber: booking.invoiceNumber ? String(booking.invoiceNumber) : null,
    salesOrderNumber: null,
    product: null,
    category,
    subject,
    description,
    notes: `Raised from logistics booking ${bookingId}`,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    lastMessagePreview: issueText.slice(0, 140),
    createdByUid: uid,
    createdByName: displayName,
    dealerId: ticketDealerId,
    dealerName,
    zohoCustomerId: ticketZohoCustomerId,
    createdOnBehalfOf,
    reopenedAt: null,
    reopenCount: 0,
    reopenHistory: [],
    assignedToUid: null,
    assignedToName: null,
    assignedAt: null,
    courierTracking: trackingNo || null,
    shippedAt: null,
    receivedAt: null,
    resolvedAt: null,
    resolutionSummary: null,
    logisticsBookingId: bookingId,
    logisticsConsignmentNo: consignmentNo || null,
    logisticsPartnerId: String(booking.partnerId || '') || null,
  };

  const messageRef = requestRef.collection('messages').doc();
  const messageData = {
    text: description,
    attachments: [],
    authorUid: uid,
    authorName: displayName,
    authorRole: role,
    createdAt: now,
    isInitial: true,
  };

  const batch = db.batch();
  batch.set(requestRef, requestData);
  batch.set(messageRef, messageData);

  const existingSupportId = String(booking.supportRequestId || '').trim();
  /** @type {Record<string, unknown>} */
  const bookingPatch = {
    updatedAt: now,
  };
  // Link when unset, or when prior link was also a logistics-raised ticket on this booking.
  if (!existingSupportId) {
    bookingPatch.supportRequestId = requestRef.id;
    bookingPatch.supportRequestNumber = requestNumber;
  }
  batch.update(bookingRef, bookingPatch);

  await batch.commit();

  return {
    requestId: requestRef.id,
    requestNumber,
    supportRequestId: String(bookingPatch.supportRequestId || existingSupportId || requestRef.id),
    supportRequestNumber: String(
      bookingPatch.supportRequestNumber
      || booking.supportRequestNumber
      || requestNumber,
    ),
    linkedBooking: Boolean(bookingPatch.supportRequestId),
  };
}
