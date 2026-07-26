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
export async function listCachedZohoSalespersons() {
  const snap = await getFirestore().collection(SALESPERSONS_COLLECTION).get();
  const salespersons = sortSalespersons(
    snap.docs.map(doc => {
      const data = doc.data() || {};
      return {
        id: String(data.id ?? doc.id),
        name: String(data.name ?? doc.id),
        email: data.email != null && String(data.email).trim() ? String(data.email).trim() : null,
        active: data.active !== false,
      };
    }).filter(row => row.id),
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

  return {
    salespersons,
    count: salespersons.length,
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
