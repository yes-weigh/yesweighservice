import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';

initializeApp();

const zohoClientId = defineSecret('ZOHO_CLIENT_ID');
const zohoClientSecret = defineSecret('ZOHO_CLIENT_SECRET');
const zohoRefreshToken = defineSecret('ZOHO_REFRESH_TOKEN');

const zohoOrganizationId = defineString('ZOHO_ORGANIZATION_ID', { default: '' });
const zohoAccountsUrl = defineString('ZOHO_ACCOUNTS_URL', {
  default: 'https://accounts.zoho.in',
});
const zohoApiBase = defineString('ZOHO_API_BASE', {
  default: 'https://www.zohoapis.in/inventory/v1',
});

const ALLOWED_ROLES = new Set(['dealer', 'dealer_staff', 'staff', 'super_admin']);

/** @type {{ token: string; expiresAt: number } | null} */
let tokenCache = null;

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

async function getAccessToken(secrets) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    refresh_token: secrets.refreshToken,
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    grant_type: 'refresh_token',
  });

  const response = await fetch(`${zohoAccountsUrl.value()}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new HttpsError(
      'failed-precondition',
      payload.error || payload.message || 'Failed to refresh Zoho access token.',
    );
  }

  const expiresIn = Number(payload.expires_in_sec || payload.expires_in || 3600);
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return tokenCache.token;
}

async function zohoGet(path, accessToken, orgId, page = 1) {
  const url = new URL(`${zohoApiBase.value()}${path}`);
  if (orgId) url.searchParams.set('organization_id', orgId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '200');

  const response = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  const payload = await response.json();
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new HttpsError(
      'internal',
      payload.message || `Zoho API error on ${path}`,
    );
  }

  return payload;
}

async function fetchOrganizations(accessToken) {
  const url = new URL(`${zohoApiBase.value()}/organizations`);
  const response = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  const payload = await response.json();
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new HttpsError(
      'internal',
      payload.message || 'Failed to load Zoho organizations.',
    );
  }

  return payload.organizations ?? [];
}

async function resolveOrganizationId(accessToken) {
  const configured = zohoOrganizationId.value().trim();
  if (configured) return configured;

  const orgs = await fetchOrganizations(accessToken);
  if (!orgs.length) {
    throw new HttpsError(
      'failed-precondition',
      'No Zoho Inventory organization found. Set ZOHO_ORGANIZATION_ID.',
    );
  }

  return String(orgs[0].organization_id);
}

async function fetchAllRecords(path, accessToken, orgId, collectionKey) {
  const records = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const payload = await zohoGet(path, accessToken, orgId, page);
    records.push(...(payload[collectionKey] ?? []));
    hasMore = Boolean(payload.page_context?.has_more_page);
    page += 1;
  }

  return records;
}

function mapItem(raw) {
  return {
    id: String(raw.item_id ?? ''),
    name: String(raw.name ?? raw.item_name ?? 'Unnamed item'),
    sku: String(raw.sku ?? ''),
    rate: Number(raw.rate ?? 0),
    status: String(raw.status ?? 'unknown'),
    unit: String(raw.unit ?? ''),
    type: String(raw.product_type ?? raw.item_type ?? ''),
    description: String(raw.description ?? ''),
    groupId: raw.group_id ? String(raw.group_id) : undefined,
    groupName: raw.group_name ? String(raw.group_name) : undefined,
  };
}

function mapItemGroup(raw) {
  const nestedItems = Array.isArray(raw.items) ? raw.items.map(mapItem) : [];

  return {
    id: String(raw.group_id ?? ''),
    name: String(raw.group_name ?? 'Unnamed group'),
    description: String(raw.description ?? raw.group_description ?? ''),
    status: String(raw.status ?? 'unknown'),
    unit: String(raw.unit ?? ''),
    itemCount: nestedItems.length,
    items: nestedItems,
  };
}

export const getZohoCatalog = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in to view products.');
    }

    const role = await readUserRole(request.auth.uid);
    if (!role || !ALLOWED_ROLES.has(role)) {
      throw new HttpsError('permission-denied', 'You do not have access to the product catalog.');
    }

    const userSnap = await getFirestore().doc(`users/${request.auth.uid}`).get();
    if (!userSnap.exists || userSnap.data()?.active === false) {
      throw new HttpsError('permission-denied', 'Your account is inactive.');
    }

    const secrets = {
      clientId: zohoClientId.value(),
      clientSecret: zohoClientSecret.value(),
      refreshToken: zohoRefreshToken.value(),
    };

    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken);

    const [rawItems, rawGroups] = await Promise.all([
      fetchAllRecords('/items', accessToken, organizationId, 'items'),
      fetchAllRecords('/itemgroups', accessToken, organizationId, 'itemgroups'),
    ]);

    const itemGroups = rawGroups.map(mapItemGroup);
    const items = rawItems.map(mapItem);
    const activeItems = items.filter(item => item.status.toLowerCase() === 'active').length;
    const activeGroups = itemGroups.filter(group => group.status.toLowerCase() === 'active').length;

    return {
      organizationId,
      syncedAt: new Date().toISOString(),
      stats: {
        totalItems: items.length,
        totalGroups: itemGroups.length,
        activeItems,
        activeGroups,
      },
      items,
      itemGroups,
    };
  },
);
