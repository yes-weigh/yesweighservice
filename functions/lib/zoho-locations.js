/**
 * Resolve Zoho warehouse_id for Cochin / Head Office (SO stock site / Branch).
 *
 * This org uses multi-warehouse. Sending `location_id` on sales orders is rejected
 * with "Invalid Element location_id" when Locations is not enabled — use warehouse_id.
 */
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
} from './zoho-api-usage.js';

const WAREHOUSE_CACHE_TTL_MS = 10 * 60 * 1000;

/** @type {{ at: number, bySite: Record<string, string> } | null} */
let warehouseCache = null;

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

function pickWarehouseId(warehouses, site) {
  const matcher = SITE_NAME_MATCHERS[site];
  if (!matcher || !Array.isArray(warehouses)) return null;
  const match = warehouses.find(row => matcher(row?.warehouse_name ?? row?.name ?? row?.location_name));
  const id = match?.warehouse_id ?? match?.warehouseId ?? match?.location_id ?? match?.locationId ?? null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

/**
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} secrets
 * @param {string} configuredOrgId
 * @returns {Promise<{ cochin: string|null, head_office: string|null }>}
 */
export async function loadZohoLocationIdsBySite(secrets, configuredOrgId) {
  const now = Date.now();
  if (warehouseCache && now - warehouseCache.at < WAREHOUSE_CACHE_TTL_MS) {
    return {
      cochin: warehouseCache.bySite.cochin || null,
      head_office: warehouseCache.bySite.head_office || null,
    };
  }

  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const payload = await zohoGetJson(accessToken, orgId, '/settings/warehouses');
  const warehouses = Array.isArray(payload?.warehouses) ? payload.warehouses : [];

  const bySite = {
    cochin: pickWarehouseId(warehouses, 'cochin'),
    head_office: pickWarehouseId(warehouses, 'head_office'),
  };
  warehouseCache = { at: now, bySite };
  return bySite;
}

/**
 * @param {'cochin'|'head_office'} site
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} secrets
 * @param {string} configuredOrgId
 * @returns {Promise<string>} Zoho warehouse_id for the site
 */
export async function resolveZohoLocationIdForSite(site, secrets, configuredOrgId) {
  const key = site === 'head_office' ? 'head_office' : 'cochin';
  const ids = await loadZohoLocationIdsBySite(secrets, configuredOrgId);
  const warehouseId = ids[key];
  if (!warehouseId) {
    const label = key === 'head_office' ? 'Head Office' : 'Cochin';
    throw new Error(
      `Zoho warehouse “${label}” was not found. Check Warehouses in Zoho Inventory.`,
    );
  }
  return warehouseId;
}

/**
 * Prefer warehouseId from cart line warehouses[] for the chosen site; else null.
 * @param {'cochin'|'head_office'} site
 * @param {Array<{ warehouseId?: string, warehouseName?: string }>|null|undefined} warehouses
 */
export function warehouseIdFromLineWarehouses(site, warehouses) {
  const matcher = SITE_NAME_MATCHERS[site === 'head_office' ? 'head_office' : 'cochin'];
  if (!matcher || !Array.isArray(warehouses)) return null;
  const match = warehouses.find(row => matcher(row?.warehouseName ?? row?.warehouse_name));
  const id = match?.warehouseId ?? match?.warehouse_id ?? null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

export function inventorySiteBranchLabel(site) {
  return site === 'head_office' ? 'Head Office' : 'Cochin';
}
