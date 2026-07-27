/**
 * Assign dealers to portal staff from each dealer's latest invoice salespersonId.
 * Wipe legacy portal KAM collection / fields.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function normalizeZohoLinks(data = {}) {
  const ids = new Set();
  if (Array.isArray(data.zohoSalespersonIds)) {
    for (const id of data.zohoSalespersonIds) {
      const trimmed = String(id ?? '').trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  if (data.zohoSalespersonId) {
    const trimmed = String(data.zohoSalespersonId).trim();
    if (trimmed) ids.add(trimmed);
  }
  if (Array.isArray(data.zohoSalespersonLinks)) {
    for (const link of data.zohoSalespersonLinks) {
      const trimmed = String(link?.id ?? '').trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  return [...ids];
}

async function buildSalespersonToStaffMap() {
  const snap = await getFirestore().collection('users').get();
  const map = new Map();
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const role = String(data.role ?? '');
    if (role !== 'staff' && role !== 'super_admin') continue;
    if (data.active === false) continue;
    const displayName = String(data.displayName ?? 'Staff').trim() || 'Staff';
    for (const zohoId of normalizeZohoLinks(data)) {
      if (!map.has(zohoId)) {
        map.set(zohoId, { uid: docSnap.id, displayName });
      }
    }
  }
  return map;
}

async function latestInvoiceSalespersonId(customerId) {
  const db = getFirestore();
  const customerRef = db.collection('zohoCustomers').doc(customerId);

  const tryQuery = async (subcollection) => {
    const snap = await customerRef
      .collection(subcollection)
      .orderBy('date', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const data = snap.docs[0].data() || {};
    const id = data.salespersonId != null ? String(data.salespersonId).trim() : '';
    return id || null;
  };

  try {
    const fromSummary = await tryQuery('invoiceSummaries');
    if (fromSummary) return fromSummary;
  } catch {
    // Index / empty — fall through to fat invoices.
  }

  try {
    return await tryQuery('invoices');
  } catch {
    return null;
  }
}

/**
 * @param {{ dryRun?: boolean, onProgress?: Function }} options
 */
export async function backfillDealerAssignedStaff({ dryRun = false, onProgress } = {}) {
  const db = getFirestore();
  const salespersonMap = await buildSalespersonToStaffMap();
  const dealersSnap = await db.collection('zohoCustomers').select(
    'assignedStaffUid',
    'assignedStaffName',
    'companyName',
    'contactName',
  ).get();

  const result = {
    dryRun: Boolean(dryRun),
    scanned: 0,
    assigned: 0,
    unassigned: 0,
    noInvoice: 0,
    unknownSalesperson: 0,
    unchanged: 0,
  };

  let batch = db.batch();
  let batchOps = 0;
  const flush = async () => {
    if (!batchOps || dryRun) {
      batch = db.batch();
      batchOps = 0;
      return;
    }
    await batch.commit();
    batch = db.batch();
    batchOps = 0;
  };

  for (const dealerDoc of dealersSnap.docs) {
    result.scanned += 1;
    const salespersonId = await latestInvoiceSalespersonId(dealerDoc.id);
    let nextUid = null;
    let nextName = null;

    if (!salespersonId) {
      result.noInvoice += 1;
    } else {
      const staff = salespersonMap.get(salespersonId);
      if (!staff) {
        result.unknownSalesperson += 1;
      } else {
        nextUid = staff.uid;
        nextName = staff.displayName;
        result.assigned += 1;
      }
    }

    if (!nextUid) result.unassigned += 1;

    const prev = dealerDoc.data() || {};
    const prevUid = prev.assignedStaffUid ? String(prev.assignedStaffUid) : null;
    const prevName = prev.assignedStaffName ? String(prev.assignedStaffName) : null;
    if (prevUid === nextUid && prevName === nextName) {
      result.unchanged += 1;
      continue;
    }

    if (!dryRun) {
      batch.set(dealerDoc.ref, {
        assignedStaffUid: nextUid,
        assignedStaffName: nextName,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batchOps += 1;
      if (batchOps >= 400) await flush();
    }

    onProgress?.({
      scanned: result.scanned,
      assigned: result.assigned,
      unassigned: result.unassigned,
    });
  }

  await flush();
  return result;
}

/**
 * Delete legacy kams collection and strip kamId / staffKamId fields.
 */
export async function wipeLegacyKamData({ onProgress } = {}) {
  const db = getFirestore();
  let kamsDeleted = 0;
  let dealersCleared = 0;
  let usersCleared = 0;

  const kamsSnap = await db.collection('kams').get();
  for (let i = 0; i < kamsSnap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of kamsSnap.docs.slice(i, i + 400)) {
      batch.delete(doc.ref);
      kamsDeleted += 1;
    }
    await batch.commit();
  }

  const dealersSnap = await db.collection('zohoCustomers').select('kamId').get();
  let batch = db.batch();
  let ops = 0;
  for (const docSnap of dealersSnap.docs) {
    const data = docSnap.data() || {};
    if (!Object.prototype.hasOwnProperty.call(data, 'kamId')) continue;
    batch.update(docSnap.ref, {
      kamId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    dealersCleared += 1;
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops) await batch.commit();

  const usersSnap = await db.collection('users').select('staffKamId').get();
  batch = db.batch();
  ops = 0;
  for (const docSnap of usersSnap.docs) {
    const data = docSnap.data() || {};
    if (!Object.prototype.hasOwnProperty.call(data, 'staffKamId')) continue;
    batch.update(docSnap.ref, { staffKamId: FieldValue.delete() });
    usersCleared += 1;
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops) await batch.commit();

  onProgress?.({ kamsDeleted, dealersCleared, usersCleared });
  return { kamsDeleted, dealersCleared, usersCleared };
}
