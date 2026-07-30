/**
 * Assign dealers to portal staff from each dealer's latest usable invoice salespersonId.
 * Wipe legacy portal KAM collection / fields.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/** Non-person Zoho salespersons — skip when resolving last-invoice ownership. */
export const IGNORED_INVOICE_SALESPERSON_IDS = new Set([
  '99381000004509002', // yescloud server
  '99381000004019936', // Cloud Charges
  '99381000030360028', // GATC SELF
]);

export const IGNORED_INVOICE_SALESPERSON_LABELS = [
  'yescloud server',
  'Cloud Charges',
  'GATC SELF',
];

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
    const email = data.email ? String(data.email) : null;
    for (const zohoId of normalizeZohoLinks(data)) {
      if (!map.has(zohoId)) {
        map.set(zohoId, { uid: docSnap.id, displayName, email });
      }
    }
  }
  return map;
}

async function loadSalespersonNames() {
  const snap = await getFirestore().collection('zohoSalespersons').get();
  const map = new Map();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    map.set(doc.id, data.name || data.salespersonName || null);
  }
  return map;
}

/**
 * Latest invoice salesperson, skipping ignored placeholders (look back through recent invoices).
 * @returns {Promise<{ id: string, name: string | null } | null>}
 */
export async function latestUsableInvoiceSalesperson(customerId, { lookback = 40 } = {}) {
  const db = getFirestore();
  const customerRef = db.collection('zohoCustomers').doc(customerId);

  const tryQuery = async (subcollection) => {
    const snap = await customerRef
      .collection(subcollection)
      .orderBy('date', 'desc')
      .limit(lookback)
      .get();
    if (snap.empty) return { foundSubcollection: false, match: null };
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const id = data.salespersonId != null ? String(data.salespersonId).trim() : '';
      if (!id) continue;
      if (IGNORED_INVOICE_SALESPERSON_IDS.has(id)) continue;
      return {
        foundSubcollection: true,
        match: {
          id,
          name: data.salespersonName ? String(data.salespersonName) : null,
        },
      };
    }
    return { foundSubcollection: true, match: null };
  };

  try {
    const fromSummary = await tryQuery('invoiceSummaries');
    if (fromSummary.match) return fromSummary.match;
    if (fromSummary.foundSubcollection && !fromSummary.match) {
      // Had summaries but all ignored / empty — still try fat invoices.
    }
  } catch {
    // Index / empty — fall through.
  }

  try {
    const fromInvoices = await tryQuery('invoices');
    return fromInvoices.match;
  } catch {
    return null;
  }
}

/** @deprecated Prefer latestUsableInvoiceSalesperson — kept for scripts that imported the old name conceptually. */
export { latestUsableInvoiceSalesperson as latestInvoiceSalespersonResolver };

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

/**
 * @param {{ dryRun?: boolean, onlyFillUnassigned?: boolean, onProgress?: Function }} options
 */
export async function backfillDealerAssignedStaff({
  dryRun = false,
  onlyFillUnassigned = false,
  onProgress,
} = {}) {
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
    onlyFillUnassigned: Boolean(onlyFillUnassigned),
    scanned: 0,
    assigned: 0,
    filled: 0,
    unassigned: 0,
    noInvoice: 0,
    unknownSalesperson: 0,
    unchanged: 0,
    skippedAlreadyAssigned: 0,
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

  const docs = dealersSnap.docs;
  // Resolve salespersons with concurrency, then write sequentially in batches.
  const resolved = await mapPool(docs, 40, async (dealerDoc) => {
    const prev = dealerDoc.data() || {};
    const prevUid = prev.assignedStaffUid ? String(prev.assignedStaffUid).trim() : '';
    const prevName = prev.assignedStaffName ? String(prev.assignedStaffName) : null;
    if (onlyFillUnassigned && prevUid) {
      return { dealerDoc, skip: 'alreadyAssigned', prevUid, prevName };
    }
    const match = await latestUsableInvoiceSalesperson(dealerDoc.id);
    return { dealerDoc, prevUid, prevName, match, companyName: prev.companyName, contactName: prev.contactName };
  });

  for (const row of resolved) {
    result.scanned += 1;
    if (row.skip === 'alreadyAssigned') {
      result.skippedAlreadyAssigned += 1;
      result.unchanged += 1;
      continue;
    }

    let nextUid = null;
    let nextName = null;

    if (!row.match) {
      result.noInvoice += 1;
    } else {
      const staff = salespersonMap.get(row.match.id);
      if (!staff) {
        result.unknownSalesperson += 1;
      } else {
        nextUid = staff.uid;
        nextName = staff.displayName;
        result.assigned += 1;
      }
    }

    if (!nextUid) result.unassigned += 1;

    if (onlyFillUnassigned && !nextUid) {
      result.unchanged += 1;
      continue;
    }

    const prevUid = row.prevUid || null;
    const prevName = row.prevName || null;
    if (prevUid === nextUid && prevName === nextName) {
      result.unchanged += 1;
      continue;
    }

    if (onlyFillUnassigned && nextUid) {
      result.filled += 1;
    }

    if (!dryRun) {
      batch.set(row.dealerDoc.ref, {
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
      filled: result.filled,
      unassigned: result.unassigned,
    });
  }

  await flush();
  return result;
}

/**
 * Dry analysis for the super-admin Dealers → Staff linking tab.
 */
export async function analyzeDealerStaffLinking({ onProgress } = {}) {
  const db = getFirestore();
  const salespersonMap = await buildSalespersonToStaffMap();
  const spNames = await loadSalespersonNames();
  const dealersSnap = await db.collection('zohoCustomers').select(
    'assignedStaffUid',
    'assignedStaffName',
    'companyName',
    'contactName',
    'cfDealerCode',
    'billingState',
    'billingCity',
  ).get();

  const unlocksBySp = new Map();
  const assignableBySp = new Map();
  const noUsableInvoiceDealers = [];

  let unassignedTotal = 0;
  let alreadyAssignable = 0;
  let needStaffLink = 0;
  let noUsableInvoice = 0;

  const docs = dealersSnap.docs;
  let scanned = 0;

  await mapPool(docs, 40, async (dealerDoc) => {
    const data = dealerDoc.data() || {};
    const prevUid = data.assignedStaffUid ? String(data.assignedStaffUid).trim() : '';
    if (prevUid) {
      scanned += 1;
      onProgress?.({ scanned, total: docs.length });
      return;
    }

    unassignedTotal += 1;
    const match = await latestUsableInvoiceSalesperson(dealerDoc.id);
    scanned += 1;
    onProgress?.({ scanned, total: docs.length });

    if (!match) {
      noUsableInvoice += 1;
      noUsableInvoiceDealers.push({
        id: dealerDoc.id,
        companyName: data.companyName ? String(data.companyName) : null,
        contactName: data.contactName ? String(data.contactName) : null,
        dealerCode: data.cfDealerCode ? String(data.cfDealerCode) : null,
        billingState: data.billingState ? String(data.billingState) : null,
        billingCity: data.billingCity ? String(data.billingCity) : null,
      });
      return;
    }

    const staff = salespersonMap.get(match.id) || null;
    const spName = spNames.get(match.id) || match.name || match.id;

    if (staff) {
      alreadyAssignable += 1;
      const entry = assignableBySp.get(match.id) || {
        zohoSalespersonId: match.id,
        zohoSalespersonName: spName,
        linkedStaffUid: staff.uid,
        linkedStaffName: staff.displayName,
        linkedStaffEmail: staff.email,
        unassignedDealers: 0,
      };
      entry.unassignedDealers += 1;
      assignableBySp.set(match.id, entry);
      return;
    }

    needStaffLink += 1;
    const entry = unlocksBySp.get(match.id) || {
      zohoSalespersonId: match.id,
      zohoSalespersonName: spName,
      unassignedDealers: 0,
    };
    entry.unassignedDealers += 1;
    unlocksBySp.set(match.id, entry);
  });

  const sortByCount = (a, b) =>
    b.unassignedDealers - a.unassignedDealers
    || String(a.zohoSalespersonName || '').localeCompare(String(b.zohoSalespersonName || ''));

  noUsableInvoiceDealers.sort((a, b) =>
    String(a.companyName || a.contactName || a.id)
      .localeCompare(String(b.companyName || b.contactName || b.id)),
  );

  return {
    ignoredSalespersons: IGNORED_INVOICE_SALESPERSON_LABELS,
    summary: {
      totalDealers: docs.length,
      unassignedDealers: unassignedTotal,
      alreadyAssignable,
      needStaffLink,
      noUsableInvoice,
    },
    unlocks: [...unlocksBySp.values()].sort(sortByCount),
    alreadyAssignableBySalesperson: [...assignableBySp.values()].sort(sortByCount),
    noUsableInvoiceDealers,
  };
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
