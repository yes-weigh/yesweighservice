import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import {
  extractZohoCoreFields,
  extractZohoDetailFields,
  extractZohoListFields,
} from './zoho-contact-fields.js';

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
    ...extractZohoCoreFields(c),
    ...extractZohoListFields(c),
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
    const zohoListFields = extractZohoListFields(customer);
    const base = {
      contactName: customer.contactName,
      companyName: customer.companyName,
      email: existing?.email ?? customer.email,
      zohoEmail: customer.email,
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
      ...zohoListFields,
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

const DETAIL_REFRESH_MAX_AGE_MS = 60 * 60 * 1000;

export async function refreshDealerFromZoho(id, secrets, orgId, { force = false } = {}) {
  const db = getFirestore();
  const ref = db.collection(CUSTOMERS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Dealer not found.');

  const existing = snap.data();
  const syncedAt = existing.zohoDetailSyncedAt;
  if (!force && syncedAt) {
    const age = Date.now() - new Date(syncedAt).getTime();
    if (age < DETAIL_REFRESH_MAX_AGE_MS) {
      return { id: snap.id, ...existing };
    }
  }

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const contact = await fetchRawCustomerDetail(accessToken, organizationId, id);
  const zohoDetailFields = extractZohoDetailFields(contact);
  const coreFields = extractZohoCoreFields(contact);
  const zohoEmail = coreFields.email ?? null;

  // Prefer Zoho contact-person mobile (login number) over a stale/empty local value.
  // Keep existing.phone as-is when set — it may be a shipping/company number.
  const resolvedMobile = coreFields.mobile
    ?? zohoDetailFields.zohoPrimaryContact?.mobile
    ?? existing.mobile
    ?? null;

  const patch = {
    ...coreFields,
    ...zohoDetailFields,
    zohoEmail,
    email: existing.email ?? zohoEmail,
    phone: existing.phone ?? coreFields.phone,
    mobile: resolvedMobile,
    firstName: existing.firstName ?? coreFields.firstName,
    syncedAt: new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const billing = contact.billing_address;
  const shipping = contact.shipping_address;
  const address = (shipping?.state || shipping?.city) ? shipping : billing;
  if (address) {
    if (!existing.billingState && (address.state || address.state_code)) {
      patch.billingState = address.state || address.state_code;
    }
    if (!existing.district && address.city) {
      patch.district = address.city;
    }
    if (!existing.zipCode && address.zip) {
      patch.zipCode = address.zip;
    }
  }

  await ref.set(patch, { merge: true });
  const updated = await ref.get();
  return { id: updated.id, ...updated.data() };
}

function cleanStr(value) {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

function mapContactPersonForUpdate(person, primaryId, changes) {
  const isPrimary = Boolean(person.is_primary_contact)
    || (primaryId && String(person.contact_person_id) === String(primaryId));

  const base = {
    contact_person_id: person.contact_person_id,
    salutation: person.salutation || undefined,
    last_name: person.last_name || undefined,
    department: person.department || undefined,
    is_primary_contact: Boolean(person.is_primary_contact),
  };

  if (!isPrimary) {
    return {
      ...base,
      first_name: person.first_name || undefined,
      email: person.email || undefined,
      phone: person.phone || undefined,
      mobile: person.mobile || undefined,
      designation: person.designation || undefined,
    };
  }

  return {
    ...base,
    first_name: cleanStr(changes.firstName) ?? person.first_name ?? undefined,
    email: cleanStr(changes.email) ?? person.email ?? undefined,
    phone: cleanStr(changes.phone) ?? person.phone ?? undefined,
    mobile: cleanStr(changes.alternateMobile) ?? person.mobile ?? undefined,
    designation: cleanStr(changes.designation) ?? person.designation ?? undefined,
    is_primary_contact: true,
  };
}

export async function pushDealerChangesToZoho(id, changes, secrets, orgId) {
  const db = getFirestore();
  const ref = db.collection(CUSTOMERS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Dealer not found.');

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const contact = await fetchRawCustomerDetail(accessToken, organizationId, id);

  const contactName = contact.contact_name;
  if (!contactName) throw new Error('Zoho contact is missing contact_name.');

  const primaryId = contact.primary_contact_id;
  let contactPersons = (contact.contact_persons ?? []).map(p =>
    mapContactPersonForUpdate(p, primaryId, changes),
  );

  if (!contactPersons.length) {
    contactPersons = [{
      first_name: cleanStr(changes.firstName),
      email: cleanStr(changes.email ?? changes.zoho_email),
      phone: cleanStr(changes.phone ?? changes.zoho_phone),
      mobile: cleanStr(changes.alternateMobile),
      designation: cleanStr(changes.designation),
      is_primary_contact: true,
    }];
  } else if (cleanStr(changes.zoho_phone)) {
    contactPersons = contactPersons.map(p => {
      const isPrimary = Boolean(p.is_primary_contact)
        || (primaryId && String(p.contact_person_id) === String(primaryId));
      if (!isPrimary) return p;
      return { ...p, phone: cleanStr(changes.zoho_phone) };
    });
  }

  const contactEmail = cleanStr(changes.email) ?? cleanStr(changes.zoho_email);
  const contactPhone = cleanStr(changes.phone) ?? cleanStr(changes.zoho_phone);

  const body = {
    contact_name: contactName,
    contact_type: contact.contact_type || 'customer',
    email: contactEmail ?? contact.email ?? undefined,
    phone: contactPhone ?? contact.phone ?? undefined,
    first_name: cleanStr(changes.firstName) ?? contact.first_name ?? undefined,
    mobile: cleanStr(changes.mobile) ?? cleanStr(changes.alternateMobile) ?? contact.mobile ?? undefined,
    legal_name: cleanStr(changes.legal_name) ?? undefined,
    customer_sub_type: cleanStr(changes.customer_sub_type) ?? undefined,
    website: cleanStr(changes.website) ?? undefined,
    gst_no: cleanStr(changes.gst_no) ?? undefined,
    gst_treatment: cleanStr(changes.gst_treatment) ?? undefined,
    pan_no: cleanStr(changes.pan_no) ?? undefined,
    notes: cleanStr(changes.notes) ?? undefined,
    contact_persons: contactPersons,
  };

  if (cleanStr(changes.billing_address)) {
    body.billing_address = {
      ...(contact.billing_address || {}),
      address: cleanStr(changes.billing_address),
    };
  }
  if (cleanStr(changes.shipping_address)) {
    body.shipping_address = {
      ...(contact.shipping_address || {}),
      address: cleanStr(changes.shipping_address),
    };
  }

  Object.keys(body).forEach(key => {
    if (body[key] === undefined) delete body[key];
  });

  const url = `${ZOHO_API_BASE}/contacts/${id}?organization_id=${organizationId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...authHeaders(accessToken, organizationId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 0) {
    throw new Error(data.message || `Zoho contact update failed (${res.status}).`);
  }

  const localPatch = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if ('firstName' in changes) localPatch.firstName = cleanStr(changes.firstName) ?? null;
  if ('email' in changes) localPatch.email = cleanStr(changes.email) ?? null;
  if ('phone' in changes) localPatch.phone = cleanStr(changes.phone) ?? null;
  if ('designation' in changes) localPatch.designation = cleanStr(changes.designation) ?? null;
  if ('alternateMobile' in changes) localPatch.alternateMobile = cleanStr(changes.alternateMobile) ?? null;
  await ref.set(localPatch, { merge: true });

  return refreshDealerFromZoho(id, secrets, orgId, { force: true });
}
