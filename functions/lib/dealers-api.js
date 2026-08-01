import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  readAllDealersFromFirestore,
  readDealerSetting,
  writeDealerSetting,
  refreshDealerFromZoho,
  pushDealerChangesToZoho,
} from './zoho-customers.js';
import {
  filterDealers,
  sortDealers,
  paginateDealers,
  dealerStats,
  dealerLocations,
  dealersToCsv,
  mapDealerForClient,
  mapDealerDetailForClient,
} from './dealer-query.js';
import { normalizeStaffZohoSalespersonIds } from './sales-order-salesperson.js';

const STAFF_ASSIGN_NO_ZOHO_MESSAGE = (
  'Assigned staff must have at least one linked Zoho salesperson.'
);

async function loadUserMap(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const db = getFirestore();
  const chunks = [];
  for (let i = 0; i < ids.length; i += 10) {
    chunks.push(ids.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    const snaps = await Promise.all(chunk.map(id => db.doc(`users/${id}`).get()));
    for (const snap of snaps) {
      if (snap.exists) {
        map.set(snap.id, snap.data());
      }
    }
  }
  return map;
}

/**
 * Staff users eligible for dealer assignment:
 * active staff/super_admin with ≥1 linked Zoho salesperson.
 */
export async function listAssignableStaffOptions() {
  const snap = await getFirestore().collection('users').get();
  const rows = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const role = String(data.role ?? '');
    if (role !== 'staff' && role !== 'super_admin') continue;
    if (data.active === false) continue;
    if (!normalizeStaffZohoSalespersonIds(data).length) continue;
    rows.push({
      uid: docSnap.id,
      displayName: String(data.displayName ?? 'Staff').trim() || 'Staff',
    });
  }
  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return rows;
}

function assertAssignableDealerStaff(userSnap) {
  if (!userSnap?.exists) {
    throw new HttpsError('not-found', 'Assigned staff not found.');
  }
  const userData = userSnap.data() || {};
  const role = String(userData.role ?? '');
  if (role !== 'staff' && role !== 'super_admin') {
    throw new HttpsError('failed-precondition', 'Assigned user must be staff or super admin.');
  }
  if (userData.active === false) {
    throw new HttpsError('failed-precondition', 'Assigned staff is inactive.');
  }
  if (!normalizeStaffZohoSalespersonIds(userData).length) {
    throw new HttpsError('failed-precondition', STAFF_ASSIGN_NO_ZOHO_MESSAGE);
  }
  return userData;
}

function applyStaffScope(query, _scope = {}) {
  // All staff and super admins see the full dealer roster.
  // Optional `assignedStaffUid` query filter still works when the client sends it.
  return { ...(query || {}) };
}

export async function listDealers(query = {}, scope = {}) {
  const scopedQuery = applyStaffScope(query, scope);
  const rawDealers = await readAllDealersFromFirestore();

  const filtered = filterDealers(rawDealers, scopedQuery);
  const sorted = sortDealers(filtered, scopedQuery.sortField, scopedQuery.sortDir);
  const page = Number(scopedQuery.page) || 1;
  const limit = scopedQuery.limit === 99999 ? sorted.length : (Number(scopedQuery.limit) || 50);
  const { data, pagination } = paginateDealers(sorted, page, limit);

  const userIds = data.flatMap(d => [d.portalUserId, d.assignedStaffUid]);
  const usersById = await loadUserMap(userIds);
  return {
    data: data.map(d => mapDealerForClient(d, null, usersById)),
    pagination,
  };
}

export async function exportDealersCsv(query = {}, scope = {}) {
  const scopedQuery = applyStaffScope(query, scope);
  const rawDealers = await readAllDealersFromFirestore();
  const filtered = filterDealers(rawDealers, scopedQuery);
  const sorted = sortDealers(filtered, scopedQuery.sortField, scopedQuery.sortDir);
  return dealersToCsv(sorted);
}

export async function getDealerStatsSummary(scope = {}) {
  const rawDealers = await readAllDealersFromFirestore();
  const scoped = applyStaffScope({}, scope);
  const filtered = filterDealers(rawDealers, scoped);
  return dealerStats(filtered);
}

export async function getDealerLocationsSummary(scope = {}) {
  const rawDealers = await readAllDealersFromFirestore();
  const scoped = applyStaffScope({}, scope);
  const filtered = filterDealers(rawDealers, scoped);
  return dealerLocations(filtered);
}

export async function getDealerRecord(id, { refreshFromZoho, secrets, orgId } = {}) {
  if (refreshFromZoho && secrets) {
    await refreshDealerFromZoho(id, secrets, orgId, {
      force: Boolean(refreshFromZoho.force),
    });
  }

  const db = getFirestore();
  const snap = await db.collection('zohoCustomers').doc(id).get();
  if (!snap.exists) throw new Error('Dealer not found.');

  const raw = { id: snap.id, ...snap.data() };
  const usersById = await loadUserMap([raw.portalUserId, raw.assignedStaffUid]);
  return mapDealerDetailForClient(raw, null, usersById);
}

export async function patchDealerRecord(id, body = {}) {
  const db = getFirestore();
  const ref = db.collection('zohoCustomers').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Dealer not found.');

  const data = {};
  if ('assignedStaffUid' in body) {
    const uid = body.assignedStaffUid ? String(body.assignedStaffUid).trim() : null;
    data.assignedStaffUid = uid || null;
    if (uid) {
      const userSnap = await db.doc(`users/${uid}`).get();
      const userData = assertAssignableDealerStaff(userSnap);
      data.assignedStaffName = String(userData.displayName ?? 'Staff').trim() || 'Staff';
    } else {
      data.assignedStaffName = null;
    }
  }
  if ('dealerStage' in body) data.dealerStage = body.dealerStage || null;
  if ('billingState' in body) data.billingState = body.billingState || null;
  if ('district' in body) data.district = body.district || null;
  if ('zipCode' in body) data.zipCode = body.zipCode || null;
  if ('categories' in body && Array.isArray(body.categories)) data.categories = body.categories;
  if ('isFiltered' in body) data.isFiltered = Boolean(body.isFiltered);
  if ('filterReason' in body) data.filterReason = body.filterReason ?? null;
  if ('firstName' in body) data.firstName = body.firstName || null;
  if ('email' in body) data.email = body.email || null;
  if ('phone' in body) data.phone = body.phone || null;
  if ('portalUserId' in body) data.portalUserId = body.portalUserId || null;
  if ('designation' in body) data.designation = body.designation || null;
  if ('alternateMobile' in body) data.alternateMobile = body.alternateMobile || null;
  if ('whatsappNumber' in body) data.whatsappNumber = body.whatsappNumber || null;
  if ('dealerType' in body) data.dealerType = body.dealerType || null;
  if ('firmType' in body) data.firmType = body.firmType || null;
  if ('creditLimit' in body) {
    data.creditLimit = body.creditLimit === '' || body.creditLimit == null
      ? null
      : Number(body.creditLimit);
  }
  if ('priceLevel' in body) data.priceLevel = body.priceLevel || null;
  if ('billingAddress' in body) data.billingAddress = body.billingAddress || null;
  if ('shippingAddress' in body) data.shippingAddress = body.shippingAddress || null;
  if ('googleMapsUrl' in body) data.googleMapsUrl = body.googleMapsUrl || null;
  if ('canBuySpares' in body) data.canBuySpares = Boolean(body.canBuySpares);
  if ('orderPayOffline' in body) data.orderPayOffline = Boolean(body.orderPayOffline);
  if ('orderPayOnline' in body) data.orderPayOnline = Boolean(body.orderPayOnline);
  if ('adminApprovalRequired' in body) data.adminApprovalRequired = Boolean(body.adminApprovalRequired);
  if ('maxOrderLimit' in body) {
    data.maxOrderLimit = body.maxOrderLimit === '' || body.maxOrderLimit == null
      ? null
      : Number(body.maxOrderLimit);
  }

  data.updatedAt = FieldValue.serverTimestamp();
  await ref.set(data, { merge: true });
  const updated = await ref.get();
  return { id: updated.id, ...updated.data() };
}

export async function linkDealerPortalUser(zohoCustomerId, portalUserId) {
  const db = getFirestore();
  const customerRef = db.collection('zohoCustomers').doc(zohoCustomerId);
  const customerSnap = await customerRef.get();
  if (!customerSnap.exists) throw new Error('Zoho customer not found.');

  if (portalUserId) {
    const userRef = db.doc(`users/${portalUserId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) throw new Error('Portal user not found.');
    await userRef.set({ zohoCustomerId }, { merge: true });
  }

  await customerRef.set({
    portalUserId: portalUserId || null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function refreshDealerZohoRecord(id, secrets, orgId, { force = true } = {}) {
  await refreshDealerFromZoho(id, secrets, orgId, { force });
  return getDealerRecord(id);
}

export async function pushDealerToZohoRecord(id, changes, secrets, orgId) {
  await pushDealerChangesToZoho(id, changes, secrets, orgId);
  return getDealerRecord(id);
}

export { readDealerSetting, writeDealerSetting };
