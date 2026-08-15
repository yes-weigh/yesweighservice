/**
 * Live Zoho Inventory vendor (contact_type=vendor) search for PO create.
 */
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import { classifyZohoHttpError, recordZohoApiFailure, recordZohoApiResponse } from './zoho-api-usage.js';
import { formatZohoAddress } from './zoho-contact-fields.js';

function mapVendor(raw) {
  const billing = raw?.billing_address && typeof raw.billing_address === 'object'
    ? raw.billing_address
    : null;
  const city = billing?.city ? String(billing.city) : null;
  const state = billing?.state ? String(billing.state) : null;
  return {
    id: String(raw?.contact_id ?? ''),
    name: String(raw?.contact_name ?? raw?.company_name ?? '').trim(),
    companyName: raw?.company_name ? String(raw.company_name) : null,
    email: raw?.email ? String(raw.email) : null,
    phone: raw?.mobile ? String(raw.mobile) : (raw?.phone ? String(raw.phone) : null),
    gstNo: raw?.gst_no ? String(raw.gst_no) : null,
    currencyCode: raw?.currency_code ? String(raw.currency_code).toUpperCase() : 'INR',
    status: String(raw?.status ?? 'active').toLowerCase(),
    city,
    state,
    address: formatZohoAddress(billing),
  };
}

export async function searchZohoVendors(secrets, orgId, options = {}) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const query = String(options.query ?? '').trim();
  const page = Math.max(1, Number(options.page) || 1);
  const perPage = Math.max(1, Math.min(Number(options.perPage) || 25, 50));

  const url = new URL(`${ZOHO_API_BASE}/contacts`);
  url.searchParams.set('organization_id', organizationId);
  url.searchParams.set('contact_type', 'vendor');
  url.searchParams.set('filter_by', 'Status.Active');
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));
  if (query) url.searchParams.set('search_text', query);

  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, organizationId) });
  await recordZohoApiResponse(res, { operation: 'contacts/vendors', source: 'zoho-vendors' });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.code !== 0) {
    const err = classifyZohoHttpError(res.status, payload);
    await recordZohoApiFailure(err, { operation: 'contacts/vendors', source: 'zoho-vendors' });
    throw err;
  }

  const vendors = (payload?.contacts ?? [])
    .map(mapVendor)
    .filter(row => row.id && row.name);

  return {
    vendors,
    hasMore: Boolean(payload?.page_context?.has_more_page),
  };
}
