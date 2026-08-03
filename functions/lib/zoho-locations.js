/**
 * Resolve Zoho Inventory location_id for Cochin / Head Office (SO Branch).
 */
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
} from './zoho-api-usage.js';

const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;

/** @type {{ at: number, bySite: Record<string, string> } | null} */
let locationCache = null;

const SITE_NAME_MATCHERS = {
  cochin: name => {
    const n = String(name ?? '').trim().toLowerCase();
    return n === 'cochin' || n.includes('cochin');
  },
  head_office: name => {
    const n = String(name ?? '').trim().toLowerCase();
    return n === 'head office' || (n.includes('head') && n.includes('office'));
  },
};

async function zohoGetJson(accessToken, orgId, path) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  if (!url.searchParams.has('organization_id')) {
    url.searchParams.set('organization_id', orgId);
  }
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(accessToken, orgId),
    });
  } catch (err) {
    recordZohoApiFailure(err);
    throw err;
  }
  const payload = await res.json().catch(() => ({}));
  recordZohoApiResponse(res.status, path);
  if (!res.ok) {
    const classified = classifyZohoHttpError(res.status, payload);
    const message = payload?.message
      || payload?.code
      || classified?.message
      || `Zoho request failed (${res.status})`;
    throw new Error(message);
  }
  return payload;
}

function pickLocationId(locations, site) {
  const matcher = SITE_NAME_MATCHERS[site];
  if (!matcher || !Array.isArray(locations)) return null;
  const match = locations.find(row => matcher(row?.location_name ?? row?.name));
  const id = match?.location_id ?? match?.locationId ?? null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

/**
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} secrets
 * @param {string} configuredOrgId
 * @returns {Promise<{ cochin: string|null, head_office: string|null }>}
 */
export async function loadZohoLocationIdsBySite(secrets, configuredOrgId) {
  const now = Date.now();
  if (locationCache && now - locationCache.at < LOCATION_CACHE_TTL_MS) {
    return {
      cochin: locationCache.bySite.cochin || null,
      head_office: locationCache.bySite.head_office || null,
    };
  }

  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const payload = await zohoGetJson(accessToken, orgId, '/locations');
  const locations = Array.isArray(payload?.locations) ? payload.locations : [];

  const bySite = {
    cochin: pickLocationId(locations, 'cochin'),
    head_office: pickLocationId(locations, 'head_office'),
  };
  locationCache = { at: now, bySite };
  return bySite;
}

/**
 * @param {'cochin'|'head_office'} site
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} secrets
 * @param {string} configuredOrgId
 */
export async function resolveZohoLocationIdForSite(site, secrets, configuredOrgId) {
  const key = site === 'head_office' ? 'head_office' : 'cochin';
  const ids = await loadZohoLocationIdsBySite(secrets, configuredOrgId);
  const locationId = ids[key];
  if (!locationId) {
    const label = key === 'head_office' ? 'Head Office' : 'Cochin';
    throw new Error(
      `Zoho location “${label}” was not found. Check Locations in Zoho Inventory.`,
    );
  }
  return locationId;
}

export function inventorySiteBranchLabel(site) {
  return site === 'head_office' ? 'Head Office' : 'Cochin';
}
