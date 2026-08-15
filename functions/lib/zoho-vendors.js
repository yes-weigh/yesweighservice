/**
 * Zoho Inventory vendors — list/search plus Firestore mirror at zohoVendors/{id}.
 */
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import { classifyZohoHttpError, recordZohoApiFailure, recordZohoApiResponse } from './zoho-api-usage.js';
import { formatZohoAddress } from './zoho-contact-fields.js';

export const VENDORS_COLLECTION = 'zohoVendors';
export const VENDOR_META_COLLECTION = 'zohoVendorMeta';
export const VENDOR_META_DOC = 'sync';

function clean(value) {
  const s = value != null ? String(value).trim() : '';
  return s || null;
}

function pickAddress(raw) {
  if (raw?.billing_address && typeof raw.billing_address === 'object') return raw.billing_address;
  if (raw?.shipping_address && typeof raw.shipping_address === 'object') return raw.shipping_address;
  return null;
}

const IN_STATE_BY_CODE = {
  AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar',
  CG: 'Chhattisgarh', CT: 'Chhattisgarh', GA: 'Goa', GJ: 'Gujarat',
  HR: 'Haryana', HP: 'Himachal Pradesh', JH: 'Jharkhand', KA: 'Karnataka',
  KL: 'Kerala', MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur',
  ML: 'Meghalaya', MZ: 'Mizoram', NL: 'Nagaland', OD: 'Odisha', OR: 'Odisha',
  PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu',
  TS: 'Telangana', TG: 'Telangana', TR: 'Tripura', UP: 'Uttar Pradesh',
  UK: 'Uttarakhand', UA: 'Uttarakhand', WB: 'West Bengal', DL: 'Delhi',
};

const CN_PROVINCE_RE = /\b(Zhejiang|Jiangsu|Guangdong|Shanghai|Beijing|Fujian|Shandong|Henan|Sichuan|Hunan|Hubei|Anhui|Jiangxi|Yunnan|Hebei|Liaoning|Jilin|Heilongjiang|Shaanxi|Shanxi|Gansu|Hainan)(?:\s+Province)?\b/i;

function inferVendorPlace(vendor) {
  let state = vendor.state;
  let country = vendor.country;
  const blob = [vendor.address, vendor.city, vendor.state, vendor.placeOfContact]
    .filter(Boolean)
    .join(' ');
  const code = state ? IN_STATE_BY_CODE[state.toUpperCase()] : null;
  if (code) {
    state = code;
    country = country || 'India';
  }
  if (!country && /\bchina\b/i.test(blob)) country = 'China';
  if (!country && /\bindia\b/i.test(blob)) country = 'India';
  if (!state) {
    const match = blob.match(CN_PROVINCE_RE);
    if (match) state = match[1];
  }
  return { ...vendor, state: state || null, country: country || null };
}

function mapVendor(raw) {
  const billing = pickAddress(raw);
  return inferVendorPlace({
    id: String(raw?.contact_id ?? ''),
    name: String(raw?.contact_name ?? raw?.company_name ?? '').trim(),
    companyName: clean(raw?.company_name),
    email: clean(raw?.email),
    phone: clean(raw?.mobile) || clean(raw?.phone),
    gstNo: clean(raw?.gst_no),
    currencyCode: String(raw?.currency_code ?? 'INR').toUpperCase(),
    status: String(raw?.status ?? 'active').toLowerCase(),
    city: clean(billing?.city),
    state: clean(billing?.state ?? billing?.province ?? raw?.place_of_contact),
    country: clean(billing?.country ?? billing?.country_code),
    zip: clean(billing?.zip ?? billing?.zipcode),
    address: formatZohoAddress(billing),
    placeOfContact: clean(raw?.place_of_contact_formatted) || clean(raw?.place_of_contact),
  });
}

function vendorSearchBlob(vendor) {
  return [
    vendor.name,
    vendor.companyName,
    vendor.phone,
    vendor.email,
    vendor.gstNo,
    vendor.city,
    vendor.state,
    vendor.country,
    vendor.zip,
    vendor.address,
  ].filter(Boolean).join(' ').toLowerCase();
}

function vendorHasPlace(vendor) {
  return Boolean(vendor?.state || vendor?.country);
}

async function fetchVendorPage(accessToken, organizationId, page, perPage, query, filterBy = 'Status.Active') {
  const url = new URL(`${ZOHO_API_BASE}/contacts`);
  url.searchParams.set('organization_id', organizationId);
  url.searchParams.set('contact_type', 'vendor');
  if (filterBy) url.searchParams.set('filter_by', filterBy);
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

  return {
    vendors: (payload?.contacts ?? []).map(mapVendor).filter(row => row.id && row.name),
    rawContacts: payload?.contacts ?? [],
    hasMore: Boolean(payload?.page_context?.has_more_page),
  };
}

async function fetchVendorRaw(accessToken, organizationId, vendorId) {
  const url = new URL(`${ZOHO_API_BASE}/contacts/${vendorId}`);
  url.searchParams.set('organization_id', organizationId);
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, organizationId) });
  await recordZohoApiResponse(res, { operation: `contacts/${vendorId}`, source: 'zoho-vendors' });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.code !== 0) {
    const err = classifyZohoHttpError(res.status, payload);
    await recordZohoApiFailure(err, { operation: `contacts/${vendorId}`, source: 'zoho-vendors' });
    throw err;
  }
  return payload?.contact ?? null;
}

export async function searchZohoVendors(secrets, orgId, options = {}) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const query = String(options.query ?? '').trim();
  const loadAll = options.all !== false && !query;
  const startPage = Math.max(1, Number(options.page) || 1);
  const perPage = Math.max(1, Math.min(Number(options.perPage) || 200, 200));

  if (!loadAll) {
    return fetchVendorPage(accessToken, organizationId, startPage, perPage, query);
  }

  const vendors = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 25) {
    const list = await fetchVendorPage(accessToken, organizationId, page, perPage, '');
    vendors.push(...list.vendors);
    hasMore = list.hasMore;
    page += 1;
  }

  return { vendors, hasMore: false };
}

async function listAllVendorContacts(accessToken, organizationId) {
  const vendors = [];
  const seen = new Set();
  for (const filterBy of ['Status.All', 'Status.Active']) {
    let page = 1;
    let hasMore = true;
    try {
      while (hasMore && page <= 40) {
        const list = await fetchVendorPage(accessToken, organizationId, page, 200, '', filterBy);
        for (const vendor of list.vendors) {
          if (!vendor.id || seen.has(vendor.id)) continue;
          seen.add(vendor.id);
          vendors.push(vendor);
        }
        hasMore = list.hasMore;
        page += 1;
      }
      break;
    } catch (err) {
      if (filterBy === 'Status.All') {
        console.warn('Vendor Status.All list failed, retrying active only:', err?.message ?? err);
        continue;
      }
      throw err;
    }
  }
  return vendors;
}

async function fillMissingVendorPlaces(accessToken, organizationId, vendors) {
  let filled = 0;
  for (const vendor of vendors) {
    if (vendorHasPlace(vendor)) continue;
    try {
      const raw = await fetchVendorRaw(accessToken, organizationId, vendor.id);
      if (!raw) continue;
      const next = mapVendor(raw);
      vendor.city = next.city ?? vendor.city;
      vendor.state = next.state ?? vendor.state;
      vendor.country = next.country ?? vendor.country;
      vendor.zip = next.zip ?? vendor.zip;
      vendor.address = next.address ?? vendor.address;
      vendor.placeOfContact = next.placeOfContact ?? vendor.placeOfContact;
      if (vendorHasPlace(vendor)) filled += 1;
    } catch (err) {
      console.warn(`Vendor detail ${vendor.id} failed:`, err?.message ?? err);
    }
  }
  return filled;
}

export async function enrichStoredVendorPlaces() {
  const snap = await getFirestore().collection(VENDORS_COLLECTION).get();
  const vendors = snap.docs.map(docSnap => inferVendorPlace({
    id: docSnap.id,
    ...docSnap.data(),
  }));
  const written = await writeVendorDocs(vendors);
  const purchaseOrdersUpdated = await backfillPurchaseOrderVendorPlaces(vendors);
  return { count: written, purchaseOrdersUpdated };
}

async function writeVendorDocs(vendors) {
  const db = getFirestore();
  const now = FieldValue.serverTimestamp();
  let written = 0;
  for (let i = 0; i < vendors.length; i += 400) {
    const chunk = vendors.slice(i, i + 400);
    const batch = db.batch();
    for (const vendor of chunk) {
      batch.set(db.collection(VENDORS_COLLECTION).doc(vendor.id), {
        ...vendor,
        searchBlob: vendorSearchBlob(vendor),
        syncedAt: now,
      }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

async function backfillPurchaseOrderVendorPlaces(vendors) {
  const byId = new Map(vendors.map(vendor => [vendor.id, vendor]));
  const snap = await getFirestore().collection('purchaseOrders').get();
  let updated = 0;
  let batch = getFirestore().batch();
  let pending = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const vendor = byId.get(String(data.vendorId ?? ''));
    if (!vendor) continue;
    const patch = {};
    if (!clean(data.vendorState) && vendor.state) patch.vendorState = vendor.state;
    if (!clean(data.vendorCountry) && vendor.country) patch.vendorCountry = vendor.country;
    if (!Object.keys(patch).length) continue;
    batch.set(docSnap.ref, patch, { merge: true });
    pending += 1;
    updated += 1;
    if (pending >= 400) {
      await batch.commit();
      batch = getFirestore().batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();
  return updated;
}

export async function syncZohoVendorsToFirestore(secrets, orgId, options = {}) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const vendors = await listAllVendorContacts(accessToken, organizationId);
  const detailsFilled = await fillMissingVendorPlaces(accessToken, organizationId, vendors);
  const written = await writeVendorDocs(vendors);
  const purchaseOrdersUpdated = await backfillPurchaseOrderVendorPlaces(vendors);
  const activeCount = vendors.filter(vendor => vendor.status === 'active').length;

  await getFirestore().collection(VENDOR_META_COLLECTION).doc(VENDOR_META_DOC).set({
    lastSyncedAt: FieldValue.serverTimestamp(),
    count: vendors.length,
    activeCount,
    detailsFilled,
    purchaseOrdersUpdated,
    source: options.source ?? 'manual',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    count: written,
    activeCount,
    detailsFilled,
    purchaseOrdersUpdated,
  };
}
