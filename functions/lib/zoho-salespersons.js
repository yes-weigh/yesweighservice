import {
  getAccessToken,
  resolveOrganizationId,
  authHeaders,
  ZOHO_API_BASE,
} from './zoho.js';

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
 * List Zoho Inventory salespersons (paginated).
 * @returns {Promise<{ salespersons: Array<{ id: string, name: string, email: string|null, active: boolean }> }>}
 */
export async function listZohoSalespersons(secrets, configuredOrgId) {
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

  all.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return { salespersons: all };
}
