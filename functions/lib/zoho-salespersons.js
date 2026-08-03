import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  getAccessToken,
  resolveOrganizationId,
  authHeaders,
  ZOHO_API_BASE,
} from './zoho.js';

export const SALESPERSONS_COLLECTION = 'zohoSalespersons';
export const SALESPERSON_META_COLLECTION = 'zohoSalespersonMeta';
export const SALESPERSON_META_DOC = 'sync';

function mapSalesperson(raw) {
  const id = String(raw?.salesperson_id ?? raw?.salespersonId ?? '').trim();
  if (!id) return null;
  const name = String(raw?.salesperson_name ?? raw?.salespersonName ?? raw?.name ?? '').trim();
  const email = String(raw?.salesperson_email ?? raw?.email ?? '').trim() || null;
  const activeRaw = raw?.is_active ?? raw?.active ?? raw?.status;
  let active = true;
  if (typeof activeRaw === 'boolean') active = activeRaw;
  else if (activeRaw != null) {
    const s = String(activeRaw).toLowerCase();
    if (s === 'false' || s === 'inactive' || s === '0') active = false;
  }
  return {
    id,
    name: name || id,
    email,
    active,
  };
}

function sortSalespersons(rows) {
  return [...rows].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

async function fetchSalespersonsPage(accessToken, organizationId, page, perPage) {
  const url = new URL(`${ZOHO_API_BASE}/salespersons`);
  url.searchParams.set('organization_id', organizationId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));

  const response = await fetch(url, { headers: authHeaders(accessToken, organizationId) });
  const payload = await response.json();
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new Error(payload.message || 'Failed to load Zoho salespersons.');
  }

  const rows = payload.salespersons ?? payload.data ?? [];
  return {
    salespersons: Array.isArray(rows) ? rows.map(mapSalesperson).filter(Boolean) : [],
    hasMore: Boolean(payload.page_context?.has_more_page),
  };
}

/**
 * Fetch all Zoho Inventory salespersons (paginated). Does not write Firestore.
 */
export async function fetchZohoSalespersonsFromApi(secrets, configuredOrgId) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, configuredOrgId);

  const all = [];
  let page = 1;
  const perPage = 200;
  let hasMore = true;

  while (hasMore && page <= 20) {
    const batch = await fetchSalespersonsPage(accessToken, organizationId, page, perPage);
    all.push(...batch.salespersons);
    hasMore = batch.hasMore;
    page += 1;
  }

  return {
    organizationId,
    salespersons: sortSalespersons(all),
  };
}

/**
 * Read cached salespersons from Firestore (fast path for UI).
 */
function mapCachedSalespersonDoc(doc) {
  const data = doc.data() || {};
  return {
    id: String(data.id ?? doc.id),
    name: String(data.name ?? doc.id),
    email: data.email != null && String(data.email).trim() ? String(data.email).trim() : null,
    active: data.active !== false,
    hiddenFromPortal: data.hiddenFromPortal === true,
  };
}

/** Zoho salesperson ids marked hidden in the portal (picker + dealer linking). */
export async function loadHiddenZohoSalespersonIds() {
  const ids = new Set();
  try {
    const snap = await getFirestore()
      .collection(SALESPERSONS_COLLECTION)
      .where('hiddenFromPortal', '==', true)
      .select('id')
      .get();
    for (const doc of snap.docs) {
      const id = String(doc.data()?.id ?? doc.id).trim();
      if (id) ids.add(id);
    }
  } catch {
    const snap = await getFirestore().collection(SALESPERSONS_COLLECTION).select('id', 'hiddenFromPortal').get();
    for (const doc of snap.docs) {
      if (doc.data()?.hiddenFromPortal !== true) continue;
      const id = String(doc.data()?.id ?? doc.id).trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}

function normalizeUserZohoIds(data = {}) {
  const ids = new Set();
  if (Array.isArray(data.zohoSalespersonIds)) {
    for (const raw of data.zohoSalespersonIds) {
      const trimmed = String(raw ?? '').trim();
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

async function findPortalOwnerForSalesperson(salespersonId) {
  const id = String(salespersonId ?? '').trim();
  if (!id) return null;
  const db = getFirestore();

  const arraySnap = await db.collection('users')
    .where('zohoSalespersonIds', 'array-contains', id)
    .limit(5)
    .get();
  for (const doc of arraySnap.docs) {
    const data = doc.data() || {};
    const role = String(data.role ?? '');
    if (role !== 'staff' && role !== 'super_admin') continue;
    if (data.active === false) continue;
    return {
      uid: doc.id,
      displayName: String(data.displayName ?? 'Staff').trim() || 'Staff',
    };
  }

  const legacySnap = await db.collection('users')
    .where('zohoSalespersonId', '==', id)
    .limit(5)
    .get();
  for (const doc of legacySnap.docs) {
    const data = doc.data() || {};
    const role = String(data.role ?? '');
    if (role !== 'staff' && role !== 'super_admin') continue;
    if (data.active === false) continue;
    return {
      uid: doc.id,
      displayName: String(data.displayName ?? 'Staff').trim() || 'Staff',
    };
  }
  return null;
}

async function countDealersForStaffUid(staffUid) {
  const uid = String(staffUid ?? '').trim();
  if (!uid) return 0;
  const snap = await getFirestore()
    .collection('zohoCustomers')
    .where('assignedStaffUid', '==', uid)
    .select('assignedStaffUid')
    .get();
  return snap.size;
}

async function reassignDealersBetweenStaff(fromUid, toUid) {
  const from = String(fromUid ?? '').trim();
  const to = String(toUid ?? '').trim();
  if (!from || !to) throw new Error('Both source and target portal owners are required.');
  if (from === to) throw new Error('Choose a different portal owner for reassignment.');

  const db = getFirestore();
  const targetSnap = await db.collection('users').doc(to).get();
  if (!targetSnap.exists) throw new Error('Target portal owner not found.');
  const target = targetSnap.data() || {};
  const role = String(target.role ?? '');
  if (role !== 'staff' && role !== 'super_admin') {
    throw new Error('Target must be staff or super admin.');
  }
  if (target.active === false) throw new Error('Target portal owner is inactive.');
  if (!normalizeUserZohoIds(target).length) {
    throw new Error('Target portal owner must have at least one Zoho salesperson linked.');
  }
  const targetName = String(target.displayName ?? 'Staff').trim() || 'Staff';

  const dealersSnap = await db.collection('zohoCustomers')
    .where('assignedStaffUid', '==', from)
    .select('assignedStaffUid')
    .get();

  let batch = db.batch();
  let ops = 0;
  let moved = 0;
  const commit = async () => {
    if (!ops) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const doc of dealersSnap.docs) {
    batch.set(doc.ref, {
      assignedStaffUid: to,
      assignedStaffName: targetName,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    ops += 1;
    moved += 1;
    if (ops >= 400) await commit();
  }
  await commit();
  return { moved, targetUid: to, targetName };
}

/**
 * Preview impact before hiding a Zoho salesperson.
 * Dealers are assigned to portal users (not Zoho SPs directly).
 */
export async function getZohoSalespersonHideImpact(salespersonId) {
  const id = String(salespersonId ?? '').trim();
  if (!id) throw new Error('salespersonId is required.');
  const ref = getFirestore().collection(SALESPERSONS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Zoho salesperson not found. Sync salespersons first.');
  const data = snap.data() || {};
  const linkedStaff = await findPortalOwnerForSalesperson(id);
  const dealerCount = linkedStaff ? await countDealersForStaffUid(linkedStaff.uid) : 0;
  return {
    id,
    name: String(data.name ?? id),
    hiddenFromPortal: data.hiddenFromPortal === true,
    linkedStaff,
    dealerCount,
    requiresReassign: dealerCount > 0,
  };
}

/**
 * Toggle portal visibility for a Zoho salesperson.
 * When hiding and the linked portal owner has dealers, reassignToStaffUid is required
 * (dealers link to portal users, not Zoho salesperson ids).
 */
export async function setZohoSalespersonHiddenFromPortal(
  salespersonId,
  hidden,
  { reassignToStaffUid = null } = {},
) {
  const id = String(salespersonId ?? '').trim();
  if (!id) throw new Error('salespersonId is required.');
  const ref = getFirestore().collection(SALESPERSONS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Zoho salesperson not found. Sync salespersons first.');
  const nextHidden = Boolean(hidden);

  let reassigned = null;
  let impact = null;
  if (nextHidden) {
    impact = await getZohoSalespersonHideImpact(id);
    if (impact.requiresReassign) {
      const toUid = String(reassignToStaffUid ?? '').trim();
      if (!toUid) {
        throw new Error(
          `${impact.dealerCount} dealer(s) are assigned to ${impact.linkedStaff.displayName}. `
          + 'Reassign them to another portal owner before hiding.',
        );
      }
      reassigned = await reassignDealersBetweenStaff(impact.linkedStaff.uid, toUid);
    }
  }

  await ref.set({
    hiddenFromPortal: nextHidden,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // If this was the portal owner's primary Zoho SP, point primary at next usable link.
  if (nextHidden && impact?.linkedStaff?.uid) {
    const userRef = getFirestore().collection('users').doc(impact.linkedStaff.uid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const userData = userSnap.data() || {};
      const primary = String(userData.zohoSalespersonId ?? '').trim();
      if (primary === id) {
        const remaining = normalizeUserZohoIds(userData).filter(spId => spId !== id);
        const nextPrimary = remaining[0] || null;
        let nextName = null;
        if (nextPrimary && Array.isArray(userData.zohoSalespersonLinks)) {
          const match = userData.zohoSalespersonLinks.find(
            link => String(link?.id ?? '').trim() === nextPrimary,
          );
          nextName = match?.name != null ? String(match.name) : null;
        }
        await userRef.set({
          zohoSalespersonId: nextPrimary,
          zohoSalespersonName: nextName,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
  }

  const data = snap.data() || {};
  return {
    id,
    name: String(data.name ?? id),
    email: data.email != null && String(data.email).trim() ? String(data.email).trim() : null,
    active: data.active !== false,
    hiddenFromPortal: nextHidden,
    reassigned,
  };
}

export async function listCachedZohoSalespersons() {
  const snap = await getFirestore().collection(SALESPERSONS_COLLECTION).get();
  const salespersons = sortSalespersons(
    snap.docs.map(doc => mapCachedSalespersonDoc(doc)).filter(row => row.id),
  );

  const metaSnap = await getFirestore()
    .collection(SALESPERSON_META_COLLECTION)
    .doc(SALESPERSON_META_DOC)
    .get();
  const meta = metaSnap.exists ? (metaSnap.data() || {}) : {};

  return {
    salespersons,
    syncedAt: meta.syncedAt?.toDate?.()?.toISOString?.()
      ?? (typeof meta.syncedAt === 'string' ? meta.syncedAt : null),
    count: salespersons.length,
  };
}

/**
 * Pull Zoho salespersons into Firestore (`zohoSalespersons/{id}`).
 * Removes docs no longer present in Zoho.
 */
export async function syncZohoSalespersonsToFirestore(secrets, configuredOrgId) {
  const { organizationId, salespersons } = await fetchZohoSalespersonsFromApi(
    secrets,
    configuredOrgId,
  );

  const db = getFirestore();
  const col = db.collection(SALESPERSONS_COLLECTION);
  const existingSnap = await col.select().get();
  const existingIds = new Set(existingSnap.docs.map(doc => doc.id));
  const nextIds = new Set(salespersons.map(row => row.id));

  let batch = db.batch();
  let ops = 0;
  const commit = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const row of salespersons) {
    batch.set(col.doc(row.id), {
      id: row.id,
      name: row.name,
      email: row.email,
      active: row.active,
      organizationId,
      syncedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    ops += 1;
    if (ops >= 400) await commit();
  }

  for (const id of existingIds) {
    if (nextIds.has(id)) continue;
    batch.delete(col.doc(id));
    ops += 1;
    if (ops >= 400) await commit();
  }

  batch.set(
    db.collection(SALESPERSON_META_COLLECTION).doc(SALESPERSON_META_DOC),
    {
      syncedAt: FieldValue.serverTimestamp(),
      count: salespersons.length,
      organizationId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  ops += 1;
  await commit();

  // Re-read so portal flags (hiddenFromPortal) preserved by merge are returned.
  const cached = await listCachedZohoSalespersons();

  return {
    salespersons: cached.salespersons,
    count: cached.salespersons.length,
    removed: [...existingIds].filter(id => !nextIds.has(id)).length,
    organizationId,
  };
}

/** @deprecated Use listCachedZohoSalespersons / syncZohoSalespersonsToFirestore */
export async function listZohoSalespersons(secrets, configuredOrgId) {
  const cached = await listCachedZohoSalespersons();
  if (cached.salespersons.length) return { salespersons: cached.salespersons };
  const synced = await syncZohoSalespersonsToFirestore(secrets, configuredOrgId);
  return { salespersons: synced.salespersons };
}
