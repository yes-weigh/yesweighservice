import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  readAllDealersFromFirestore,
  readKamsFromFirestore,
  readDealerSetting,
  writeDealerSetting,
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

async function loadPortalUserMap(portalUserIds) {
  const ids = [...new Set(portalUserIds.filter(Boolean))];
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

export async function listDealers(query = {}) {
  const [rawDealers, kams] = await Promise.all([
    readAllDealersFromFirestore(),
    readKamsFromFirestore(),
  ]);
  const kamsById = new Map(kams.map(k => [k.id, k]));

  const filtered = filterDealers(rawDealers, query);
  const sorted = sortDealers(filtered, query.sortField, query.sortDir);
  const page = Number(query.page) || 1;
  const limit = query.limit === 99999 ? sorted.length : (Number(query.limit) || 50);
  const { data, pagination } = paginateDealers(sorted, page, limit);

  const usersById = await loadPortalUserMap(data.map(d => d.portalUserId));
  return {
    data: data.map(d => mapDealerForClient(d, kamsById, usersById)),
    pagination,
  };
}

export async function exportDealersCsv(query = {}) {
  const [rawDealers, kams] = await Promise.all([
    readAllDealersFromFirestore(),
    readKamsFromFirestore(),
  ]);
  const kamsById = new Map(kams.map(k => [k.id, k]));
  const filtered = filterDealers(rawDealers, query);
  const sorted = sortDealers(filtered, query.sortField, query.sortDir);
  return dealersToCsv(sorted, kamsById);
}

export async function getDealerStatsSummary() {
  const rawDealers = await readAllDealersFromFirestore();
  return dealerStats(rawDealers);
}

export async function getDealerLocationsSummary() {
  const rawDealers = await readAllDealersFromFirestore();
  return dealerLocations(rawDealers);
}

export async function getDealerRecord(id) {
  const db = getFirestore();
  const snap = await db.collection('zohoCustomers').doc(id).get();
  if (!snap.exists) throw new Error('Dealer not found.');

  const raw = { id: snap.id, ...snap.data() };
  const [kams, usersById] = await Promise.all([
    readKamsFromFirestore(),
    loadPortalUserMap([raw.portalUserId]),
  ]);
  const kamsById = new Map(kams.map(k => [k.id, k]));
  return mapDealerDetailForClient(raw, kamsById, usersById);
}

export async function patchDealerRecord(id, body = {}) {
  const db = getFirestore();
  const ref = db.collection('zohoCustomers').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Dealer not found.');

  const data = {};
  if ('kamId' in body) data.kamId = body.kamId || null;
  if ('dealerStage' in body) data.dealerStage = body.dealerStage || null;
  if ('billingState' in body) data.billingState = body.billingState || null;
  if ('district' in body) data.district = body.district || null;
  if ('zipCode' in body) data.zipCode = body.zipCode || null;
  if ('categories' in body && Array.isArray(body.categories)) data.categories = body.categories;
  if ('isFiltered' in body) data.isFiltered = Boolean(body.isFiltered);
  if ('filterReason' in body) data.filterReason = body.filterReason ?? null;
  if ('firstName' in body) data.firstName = body.firstName || null;
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

export {
  readDealerSetting,
  writeDealerSetting,
};
