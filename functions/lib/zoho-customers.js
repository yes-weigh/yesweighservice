import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';

const CUSTOMERS_COLLECTION = 'zohoCustomers';
const SETTINGS_COLLECTION = 'dealerSettings';

async function fetchCustomersPage(accessToken, orgId, page = 1, perPage = 200) {
  const url = new URL(`${ZOHO_API_BASE}/contacts`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('contact_type', 'customer');
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));

  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Zoho contacts API error: ${res.status} ${body}`);
  }

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(data.message || 'Zoho contacts API error');
  }

  const contacts = (data.contacts ?? []).map(c => ({
    id: String(c.contact_id),
    contactName: String(c.contact_name || ''),
    firstName: c.first_name ? String(c.first_name) : null,
    companyName: c.company_name ? String(c.company_name) : null,
    email: c.email ? String(c.email) : null,
    phone: c.phone ? String(c.phone) : null,
    mobile: c.mobile ? String(c.mobile) : null,
    status: String(c.status || 'active'),
    outstandingReceivable: Number(c.outstanding_receivable_amount) || 0,
    unusedCredits: Number(c.unused_credits_receivable_amount) || 0,
  }));

  const hasMore = Boolean(data.page_context?.has_more_page);
  if (hasMore) {
    const next = await fetchCustomersPage(accessToken, orgId, page + 1, perPage);
    return [...contacts, ...next];
  }
  return contacts;
}

export function processCustomers(rawCustomers) {
  const processedCustomers = [];
  const afterYesCloud = rawCustomers.map(c => {
    const lowerName = c.contactName.toLowerCase();
    if (lowerName.startsWith('yescloud') || lowerName.startsWith('retail cloud')) {
      return { ...c, isFiltered: true, filterReason: 'YesCloud Exclusion' };
    }
    return { ...c, isFiltered: false, filterReason: null };
  });

  const map = new Map();
  for (const customer of afterYesCloud) {
    if (customer.isFiltered) {
      processedCustomers.push(customer);
      continue;
    }

    const key = customer.contactName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) {
      processedCustomers.push(customer);
      continue;
    }

    if (!map.has(key)) {
      map.set(key, { ...customer });
    } else {
      const existing = map.get(key);
      existing.outstandingReceivable += customer.outstandingReceivable || 0;
      existing.unusedCredits += customer.unusedCredits || 0;
      if (!existing.email && customer.email) existing.email = customer.email;
      if (!existing.phone && customer.phone) existing.phone = customer.phone;
      if (!existing.mobile && customer.mobile) existing.mobile = customer.mobile;
      if (!existing.companyName && customer.companyName) existing.companyName = customer.companyName;
      if (existing.status !== 'active' && customer.status === 'active') existing.status = 'active';
      processedCustomers.push({ ...customer, isFiltered: true, filterReason: 'Duplicate Consolidated' });
    }
  }

  return [...Array.from(map.values()), ...processedCustomers];
}

export async function fetchRawCustomerDetail(accessToken, orgId, contactId) {
  const url = `${ZOHO_API_BASE}/contacts/${contactId}?organization_id=${orgId}`;
  const res = await fetch(url, { headers: authHeaders(accessToken, orgId) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Zoho contact detail error: ${res.status} ${body}`);
  }
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message || 'Zoho contact detail error');
  return data.contact;
}

export async function syncCustomersToFirestore(secrets, orgId) {
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const raw = await fetchCustomersPage(accessToken, organizationId);
  const customers = processCustomers(raw);
  console.info(`Zoho customer sync: fetched ${raw.length} contacts, ${customers.length} after processing`);

  const db = getFirestore();
  const existingSnap = await db.collection(CUSTOMERS_COLLECTION).get();
  const existingMap = new Map(
    existingSnap.docs.map(d => [d.id, d.data()]),
  );

  let count = 0;
  const batchSize = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const customer of customers) {
    const existing = existingMap.get(customer.id);
    const isManuallyDeactivated = existing?.filterReason === 'Manual';
    const filteredValue = isManuallyDeactivated ? true : (customer.isFiltered ?? false);
    const filterReasonVal = isManuallyDeactivated ? 'Manual' : (customer.filterReason ?? null);

    let billingState = existing?.billingState ?? null;
    let district = existing?.district ?? null;
    let zipCode = existing?.zipCode ?? null;

    // Skip per-contact Zoho detail fetch during bulk sync — it adds minutes on first
    // import (one API call + delay per new customer). Location can be edited later.

    const ref = db.collection(CUSTOMERS_COLLECTION).doc(customer.id);
    const base = {
      contactName: customer.contactName,
      companyName: customer.companyName,
      email: customer.email,
      phone: existing?.phone ?? customer.phone,
      mobile: existing?.mobile ?? customer.mobile,
      firstName: existing?.firstName ?? customer.firstName,
      status: customer.status,
      outstandingReceivable: customer.outstandingReceivable,
      unusedCredits: customer.unusedCredits,
      isFiltered: filteredValue,
      filterReason: filterReasonVal,
      syncedAt: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (existing) {
      batch.set(ref, base, { merge: true });
    } else {
      batch.set(ref, {
        ...base,
        kamId: null,
        dealerStage: null,
        billingState,
        district,
        zipCode,
        categories: [],
        portalUserId: null,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    batchCount += 1;
    count += 1;
    if (batchCount >= batchSize) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();

  await db.collection(SETTINGS_COLLECTION).doc('meta').set({
    lastCustomerSyncAt: new Date().toISOString(),
    customerCount: count,
  }, { merge: true });

  const visible = customers.filter(c => !c.isFiltered || c.filterReason !== 'Manual').length;
  console.info(`Zoho customer sync complete: upserted ${count}, visible roster ~${visible}`);
  return count;
}

export async function readAllDealersFromFirestore() {
  const snap = await getFirestore().collection(CUSTOMERS_COLLECTION).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function readKamsFromFirestore() {
  const snap = await getFirestore().collection('kams').orderBy('name').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function readDealerSetting(key, fallback) {
  const doc = await getFirestore().collection(SETTINGS_COLLECTION).doc(key).get();
  if (!doc.exists) return fallback;
  return doc.data()?.value ?? fallback;
}

export async function writeDealerSetting(key, value) {
  await getFirestore().collection(SETTINGS_COLLECTION).doc(key).set({
    value,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return value;
}
