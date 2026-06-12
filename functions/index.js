import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import {
  getAccessToken,
  resolveOrganizationId,
  fetchProductDetail,
  moveProductToCategory,
} from './lib/zoho.js';
import {
  syncCatalogToFirestore,
  readCatalogFromFirestore,
  patchProductCategory,
} from './lib/catalog-sync.js';

initializeApp();

const zohoClientId = defineSecret('ZOHO_CLIENT_ID');
const zohoClientSecret = defineSecret('ZOHO_CLIENT_SECRET');
const zohoRefreshToken = defineSecret('ZOHO_REFRESH_TOKEN');
const zohoOrganizationId = defineString('ZOHO_ORGANIZATION_ID');

const ALLOWED_ROLES = new Set(['dealer', 'dealer_staff', 'staff', 'super_admin']);
const SYNC_ROLES = new Set(['staff', 'super_admin']);

function zohoSecrets() {
  return {
    clientId: zohoClientId.value(),
    clientSecret: zohoClientSecret.value(),
    refreshToken: zohoRefreshToken.value(),
  };
}

async function readUserRole(uid) {
  const snap = await getFirestore().doc(`users/${uid}`).get();
  if (!snap.exists) return null;

  const data = snap.data();
  const role = String(data?.role ?? '');
  if (role === 'admin') return 'super_admin';
  if (role === 'director') return 'dealer';
  if (role === 'director_staff') return 'dealer_staff';
  if (ALLOWED_ROLES.has(role)) return role;
  return null;
}

async function requireActiveUser(uid, allowedRoles = ALLOWED_ROLES) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const role = await readUserRole(uid);
  if (!role || !allowedRoles.has(role)) {
    throw new HttpsError('permission-denied', 'You do not have access.');
  }

  const userSnap = await getFirestore().doc(`users/${uid}`).get();
  if (!userSnap.exists || userSnap.data()?.active === false) {
    throw new HttpsError('permission-denied', 'Your account is inactive.');
  }

  return role;
}

function filterCatalogItems(items, { search, category, stockStatus } = {}) {
  let filtered = items;

  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(item =>
      String(item.name ?? '').toLowerCase().includes(q)
      || String(item.sku ?? '').toLowerCase().includes(q)
      || String(item.categoryName ?? '').toLowerCase().includes(q),
    );
  }

  if (category) {
    filtered = filtered.filter(item => item.categoryId === category);
  }

  if (stockStatus) {
    filtered = filtered.filter(item => item.stockStatus === stockStatus);
  }

  return filtered;
}

/** Cached catalog — public (no auth) and authenticated clients. */
export const getCatalog = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const { search, category, stockStatus } = request.data ?? {};
    const catalog = await readCatalogFromFirestore();
    const items = filterCatalogItems(catalog.items, { search, category, stockStatus });

    return {
      ...catalog,
      items,
      total: items.length,
    };
  },
);

/** Live Zoho product detail with warehouse breakdown. */
export const getCatalogProductDetail = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const productId = String(request.data?.productId ?? '').trim();
    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    const detail = await fetchProductDetail(accessToken, organizationId, productId);

    const cached = await getFirestore().collection('catalogProducts').doc(productId).get();
    if (!detail.imageUrl && cached.exists) {
      detail.imageUrl = cached.data()?.imageUrl ?? null;
    }

    return detail;
  },
);

/** Manual sync — staff / super admin only. */
export const syncZohoCatalog = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const result = await syncCatalogToFirestore(
      zohoSecrets(),
      zohoOrganizationId.value(),
    );

    return result;
  },
);

/** Move product to another category via Zoho internal move API. */
export const assignCatalogProductCategory = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    const categoryId = String(request.data?.categoryId ?? '').trim();
    const categoryName = String(request.data?.categoryName ?? '').trim();

    if (!productId || !categoryId) {
      throw new HttpsError('invalid-argument', 'productId and categoryId are required.');
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    await moveProductToCategory(accessToken, organizationId, productId, categoryId);
    await patchProductCategory(productId, categoryId, categoryName);

    return { ok: true };
  },
);

/** @deprecated Use getCatalog — kept for backward compatibility during migration. */
export const getZohoCatalog = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid);

    const catalog = await readCatalogFromFirestore();
    if (catalog.items.length > 0) {
      return {
        organizationId: catalog.items[0]?.organizationId ?? null,
        syncedAt: catalog.syncedAt ?? new Date().toISOString(),
        stats: {
          totalItems: catalog.stats.totalProducts,
          totalGroups: catalog.stats.totalCategories,
          activeItems: catalog.stats.totalProducts,
          activeGroups: catalog.stats.totalCategories,
        },
        items: catalog.items.map(item => ({
          id: item.id,
          name: item.name,
          sku: item.sku ?? '',
          rate: item.rate,
          status: item.status,
          unit: item.unit,
          type: '',
          description: item.description ?? '',
          groupId: item.categoryId ?? undefined,
          groupName: item.categoryName ?? undefined,
        })),
        itemGroups: catalog.categories.map(cat => ({
          id: cat.id,
          name: cat.name,
          description: '',
          status: 'active',
          unit: '',
          itemCount: cat.productCount,
          items: catalog.items
            .filter(p => p.categoryId === cat.id)
            .map(item => ({
              id: item.id,
              name: item.name,
              sku: item.sku ?? '',
              rate: item.rate,
              status: item.status,
              unit: item.unit,
              type: '',
              description: item.description ?? '',
              groupId: item.categoryId ?? undefined,
              groupName: item.categoryName ?? undefined,
            })),
        })),
      };
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());
    await syncCatalogToFirestore(secrets, organizationId);
    const refreshed = await readCatalogFromFirestore();

    return {
      organizationId,
      syncedAt: refreshed.syncedAt ?? new Date().toISOString(),
      stats: {
        totalItems: refreshed.stats.totalProducts,
        totalGroups: refreshed.stats.totalCategories,
        activeItems: refreshed.stats.totalProducts,
        activeGroups: refreshed.stats.totalCategories,
      },
      items: refreshed.items,
      itemGroups: refreshed.categories,
    };
  },
);
