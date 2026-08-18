/**
 * Mark a Kotak payout as a Zoho vendor advance on the purchase order.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { applyReservedKotakFeedAsVendorAdvance } from './zoho-bank-feeds.js';

const PO_COLLECTION = 'purchaseOrders';
const FEEDS_COLLECTION = 'kotakBankFeeds';
const MAX_LOGS = 40;

function nowIso() {
  return new Date().toISOString();
}

function displayName(user) {
  const data = user?.data || {};
  return String(data.displayName || data.name || data.email || 'Staff').trim() || 'Staff';
}

async function loadUser(uid) {
  const snap = await getFirestore().collection('users').doc(String(uid || '').trim()).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'Your account was not found.');
  }
  const data = snap.data() || {};
  if (data.active === false) {
    throw new HttpsError('permission-denied', 'Your account is inactive.');
  }
  return {
    uid: snap.id,
    role: String(data.role || ''),
    data,
  };
}

function requireFullSuperAdmin(user) {
  if (user.role !== 'super_admin' || user.data?.superAdminAccess === 'view_only') {
    throw new HttpsError('permission-denied', 'Only full-access super admin can associate a bank payout.');
  }
}

function feedFromPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const transactionId = String(raw.transactionId || '').trim();
  if (!transactionId) return null;
  return {
    transactionId,
    date: raw.date ? String(raw.date) : null,
    postedTime: raw.postedTime ? String(raw.postedTime) : null,
    amount: Number(raw.amount) || 0,
    debitOrCredit: raw.debitOrCredit ? String(raw.debitOrCredit) : null,
    payee: raw.payee ? String(raw.payee) : null,
    description: raw.description ? String(raw.description) : null,
    referenceNumber: raw.referenceNumber ? String(raw.referenceNumber) : null,
    accountId: raw.accountId ? String(raw.accountId) : '',
    importedTransactionId: raw.importedTransactionId ? String(raw.importedTransactionId) : null,
  };
}

function ymd(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function appendLog(existing, entry) {
  const logs = Array.isArray(existing) ? existing.slice() : [];
  logs.push(entry);
  return logs.slice(-MAX_LOGS);
}

/**
 * Categorize the Kotak payout as a vendor advance in Zoho, then store USD + bank charges on the PO.
 */
export async function associateKotakPayoutWithPurchaseOrder(uid, payload = {}, secrets, orgId) {
  const user = await loadUser(uid);
  requireFullSuperAdmin(user);

  const purchaseOrderId = String(payload.purchaseOrderId || '').trim();
  const feed = feedFromPayload(payload.feed);
  const amountUsd = Number(payload.amountUsd);
  const usdToInrRate = Number(payload.usdToInrRate);
  if (!purchaseOrderId) {
    throw new HttpsError('invalid-argument', 'Purchase order is required.');
  }
  if (!feed) {
    throw new HttpsError('invalid-argument', 'Select a Kotak payout first.');
  }
  if (!(amountUsd > 0)) {
    throw new HttpsError('invalid-argument', 'Enter a USD amount.');
  }
  if (!(usdToInrRate > 0)) {
    throw new HttpsError('invalid-argument', 'Exchange rate is missing.');
  }

  const db = getFirestore();
  const poRef = db.collection(PO_COLLECTION).doc(purchaseOrderId);
  const feedRef = db.collection(FEEDS_COLLECTION).doc(feed.transactionId);
  const [poSnap, feedSnap] = await Promise.all([poRef.get(), feedRef.get()]);
  if (!poSnap.exists) {
    throw new HttpsError('not-found', 'Purchase order not found.');
  }

  const reservedBy = String(feedSnap.data()?.reservedForPurchaseOrderId || '').trim();
  if (reservedBy && reservedBy !== purchaseOrderId) {
    throw new HttpsError(
      'failed-precondition',
      'This bank payout is already associated with another purchase order.',
    );
  }
  const reservedSo = String(feedSnap.data()?.reservedForSalesOrderId || '').trim();
  if (reservedSo) {
    throw new HttpsError(
      'failed-precondition',
      'This bank line is reserved for a sales order.',
    );
  }

  const data = poSnap.data() || {};
  const vendorId = String(data.vendorId || '').trim();
  if (!vendorId) {
    throw new HttpsError('failed-precondition', 'This purchase order has no vendor in Zoho.');
  }

  const alreadyApplied = String(feedSnap.data()?.appliedPurchaseOrderId || '').trim() === purchaseOrderId
    && Boolean(feedSnap.data()?.appliedAt);
  let zoho = {
    amountUsd: Math.round(amountUsd * 100) / 100,
    usdToInrRate: Math.round(usdToInrRate * 10000) / 10000,
    amountInr: Number(feed.amount) || 0,
    bankCharges: 0,
    transactionId: feed.transactionId,
    zohoVendorPaymentId: feedSnap.data()?.zohoVendorPaymentId || null,
  };
  const expectedInr = Math.round(zoho.amountUsd * zoho.usdToInrRate * 100) / 100;
  zoho.bankCharges = Math.max(0, Math.round((zoho.amountInr - expectedInr) * 100) / 100);

  if (!alreadyApplied) {
    try {
      zoho = await applyReservedKotakFeedAsVendorAdvance(secrets, orgId, {
        feed,
        vendorId,
        amountUsd,
        usdToInrRate,
        purchaseOrderNumber: data.purchaseOrderNumber,
      });
    } catch (err) {
      throw new HttpsError(
        'failed-precondition',
        err?.message || 'Could not mark this payout as a vendor advance in Zoho.',
      );
    }
  }

  const previousId = String(data.kotakPayout?.transactionId || '').trim();
  const at = nowIso();
  const paymentDate = ymd(feed.date) || at.slice(0, 10);
  const tracking = {
    ...(data.tracking && typeof data.tracking === 'object' ? data.tracking : {}),
    poDate: ymd(data.tracking?.poDate || data.date) || ymd(data.date),
    paymentDate,
  };
  const kotakPayout = {
    ...feed,
    amountInr: zoho.amountInr,
    amountUsd: zoho.amountUsd,
    usdToInrRate: zoho.usdToInrRate,
    bankCharges: zoho.bankCharges,
    zohoVendorPaymentId: zoho.zohoVendorPaymentId || null,
    associatedAt: at,
    associatedByUid: uid,
    associatedByName: displayName(user),
  };
  const log = {
    at,
    byUid: uid,
    byName: displayName(user),
    action: 'kotak_payout_paid',
    detail: [
      `₹${zoho.amountInr.toFixed(2)} → $${zoho.amountUsd.toFixed(2)}`,
      zoho.bankCharges > 0 ? `bank charges ₹${zoho.bankCharges.toFixed(2)}` : null,
      feed.referenceNumber || feed.transactionId,
    ].filter(Boolean).join(' · '),
  };

  if (previousId && previousId !== feed.transactionId) {
    await db.collection(FEEDS_COLLECTION).doc(previousId).set({
      reservedForPurchaseOrderId: FieldValue.delete(),
      appliedPurchaseOrderId: FieldValue.delete(),
      appliedAt: FieldValue.delete(),
      zohoVendorPaymentId: FieldValue.delete(),
    }, { merge: true });
  }

  await poRef.set({
    kotakPayout,
    tracking,
    activityLogs: appendLog(data.activityLogs, log),
  }, { merge: true });

  await feedRef.set({
    reservedForPurchaseOrderId: purchaseOrderId,
    appliedPurchaseOrderId: purchaseOrderId,
    appliedAt: at,
    amountUsd: zoho.amountUsd,
    usdToInrRate: zoho.usdToInrRate,
    bankCharges: zoho.bankCharges,
    zohoVendorPaymentId: zoho.zohoVendorPaymentId || null,
  }, { merge: true });

  const next = await poRef.get();
  return { purchaseOrderId, kotakPayout, tracking, activityLogs: next.data()?.activityLogs || [] };
}

/**
 * Save shipment tracking dates on the PO and append a log when they change.
 */
export async function savePurchaseOrderTracking(uid, payload = {}) {
  const user = await loadUser(uid);
  requireFullSuperAdmin(user);

  const purchaseOrderId = String(payload.purchaseOrderId || '').trim();
  if (!purchaseOrderId) {
    throw new HttpsError('invalid-argument', 'Purchase order is required.');
  }

  const db = getFirestore();
  const poRef = db.collection(PO_COLLECTION).doc(purchaseOrderId);
  const snap = await poRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Purchase order not found.');
  }
  const data = snap.data() || {};
  const prev = data.tracking && typeof data.tracking === 'object' ? data.tracking : {};
  const tracking = {
    poDate: ymd(payload.poDate || prev.poDate || data.date),
    paymentDate: ymd(payload.paymentDate || prev.paymentDate),
    loadingDate: ymd(payload.loadingDate),
    sailingDate: ymd(payload.sailingDate),
    arrivalDate: ymd(payload.arrivalDate),
    receivedDate: ymd(payload.receivedDate),
  };

  const changed = ['paymentDate', 'loadingDate', 'sailingDate', 'arrivalDate', 'receivedDate']
    .filter(key => String(prev[key] || '') !== String(tracking[key] || ''));
  const at = nowIso();
  const patch = { tracking };
  if (changed.length) {
    patch.activityLogs = appendLog(data.activityLogs, {
      at,
      byUid: uid,
      byName: displayName(user),
      action: 'tracking_updated',
      detail: changed.map(key => `${key.replace(/Date$/, '')}: ${tracking[key] || '—'}`).join(' · '),
    });
  }

  await poRef.set(patch, { merge: true });
  const next = await poRef.get();
  return {
    purchaseOrderId,
    tracking: next.data()?.tracking || tracking,
    activityLogs: next.data()?.activityLogs || [],
  };
}
