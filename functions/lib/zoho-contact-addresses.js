/**
 * Zoho Inventory contact addresses (default billing/shipping + additional).
 * Syncable via Inventory Contacts Address API.
 */
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
} from './zoho-api-usage.js';
import { formatZohoAddress } from './zoho-contact-fields.js';
import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { resolveZohoCustomerIdForUser } from './zoho-invoices.js';

async function zohoJson(accessToken, orgId, path, { method = 'GET', body } = {}) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  if (!url.searchParams.has('organization_id')) {
    url.searchParams.set('organization_id', orgId);
  }
  const init = {
    method,
    headers: {
      ...authHeaders(accessToken, orgId),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
  };
  if (body) init.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    recordZohoApiFailure(err);
    throw err;
  }
  const payload = await res.json().catch(() => ({}));
  recordZohoApiResponse(res.status, path);
  if (!res.ok) {
    const classified = classifyZohoHttpError(res.status, payload);
    throw new Error(
      payload?.message || classified?.message || `Zoho request failed (${res.status})`,
    );
  }
  return payload;
}

function clean(value) {
  const s = String(value ?? '').trim();
  return s || null;
}

export function normalizeAddressInput(raw = {}) {
  return {
    attention: clean(raw.attention),
    address: clean(raw.address),
    street2: clean(raw.street2),
    city: clean(raw.city),
    state: clean(raw.state),
    zip: clean(raw.zip)?.replace(/\s+/g, '') || null,
    country: clean(raw.country) || 'India',
    phone: clean(raw.phone),
  };
}

/** Mandatory fields for a new shipping address. */
export function assertCompleteAddress(addr) {
  const missing = [];
  if (!addr.attention) missing.push('Attention / contact name');
  if (!addr.address) missing.push('Address line 1');
  if (!addr.city) missing.push('City');
  if (!addr.state) missing.push('State');
  if (!addr.zip) missing.push('PIN code');
  if (!addr.country) missing.push('Country');
  if (!addr.phone) missing.push('Phone');
  if (missing.length) {
    throw new HttpsError(
      'invalid-argument',
      `Complete shipping address required: ${missing.join(', ')}.`,
    );
  }
  if (!/^\d{6}$/.test(String(addr.zip))) {
    throw new HttpsError('invalid-argument', 'PIN code must be a 6-digit number.');
  }
}

function mapAddressRow(raw, { label = null, kind = 'additional' } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.address_id != null ? String(raw.address_id) : null;
  const normalized = {
    attention: clean(raw.attention),
    address: clean(raw.address),
    street2: clean(raw.street2),
    city: clean(raw.city),
    state: clean(raw.state),
    zip: raw.zip != null ? String(raw.zip).trim() : null,
    country: clean(raw.country),
    phone: clean(raw.phone),
  };
  const formatted = formatZohoAddress({
    attention: normalized.attention,
    address: normalized.address,
    street2: normalized.street2,
    city: normalized.city,
    state: normalized.state,
    zip: normalized.zip,
    country: normalized.country,
  });
  if (!formatted && !id) return null;
  return {
    addressId: id,
    kind,
    label: label || (kind === 'billing' ? 'Billing address' : kind === 'shipping' ? 'Default shipping' : 'Saved address'),
    formatted,
    ...normalized,
  };
}

async function fetchContactDetail(accessToken, orgId, contactId) {
  const payload = await zohoJson(accessToken, orgId, `/contacts/${contactId}`);
  return payload?.contact ?? null;
}

async function fetchContactAddresses(accessToken, orgId, contactId) {
  const payload = await zohoJson(accessToken, orgId, `/contacts/${contactId}/address`);
  return Array.isArray(payload?.addresses) ? payload.addresses : [];
}

function isZohoAuthDeniedError(err) {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('not authorized to perform this operation')
    || msg.includes('unauthorized')
    || msg.includes('invalid oauth token')
    || msg.includes('insufficient privilege')
    || msg.includes('permission denied')
  );
}

function buildAddressRowsFromContact(contact, additional = []) {
  const rows = [];
  const billing = mapAddressRow(contact?.billing_address, {
    kind: 'billing',
    label: 'Billing address',
  });
  if (billing) {
    // Billing may not always expose address_id; keep it selectable via kind when id missing.
    rows.push(billing);
  }
  const shipping = mapAddressRow(contact?.shipping_address, {
    kind: 'shipping',
    label: 'Default shipping',
  });
  if (shipping) rows.push(shipping);

  const seen = new Set(rows.map(r => r.addressId).filter(Boolean));
  for (const raw of additional) {
    const mapped = mapAddressRow(raw, { kind: 'additional', label: 'Saved address' });
    if (!mapped) continue;
    if (mapped.addressId && seen.has(mapped.addressId)) continue;
    if (mapped.addressId) seen.add(mapped.addressId);
    rows.push(mapped);
  }
  return rows;
}

/** Prefer previously synced addresses when Zoho address APIs are denied. */
async function loadCachedCustomerAddresses(contactId) {
  try {
    const snap = await getFirestore().collection('zohoCustomers').doc(contactId).get();
    if (!snap.exists) return [];
    const data = snap.data() || {};

    if (Array.isArray(data.zohoAddresses) && data.zohoAddresses.length) {
      return data.zohoAddresses
        .map(row => {
          if (!row || typeof row !== 'object') return null;
          const kind = String(row.kind || 'additional');
          return mapAddressRow({
            address_id: row.addressId ?? row.address_id ?? null,
            attention: row.attention,
            address: row.address,
            street2: row.street2,
            city: row.city,
            state: row.state,
            zip: row.zip,
            country: row.country,
            phone: row.phone,
          }, {
            kind,
            label: row.label
              || (kind === 'billing'
                ? 'Billing address'
                : kind === 'shipping'
                  ? 'Default shipping'
                  : 'Saved address'),
          });
        })
        .filter(Boolean);
    }

    return buildAddressRowsFromContact({
      billing_address: data.zohoBillingAddressRaw || null,
      shipping_address: data.zohoShippingAddressRaw || null,
    });
  } catch {
    return [];
  }
}

/**
 * List selectable addresses for a Zoho customer (billing, default shipping, additional).
 * Soft-fails Zoho address APIs and falls back to synced Firestore dealer addresses.
 */
export async function listContactAddressesForCustomer(secrets, configuredOrgId, customerId) {
  const contactId = String(customerId || '').trim();
  if (!contactId) throw new HttpsError('invalid-argument', 'customerId is required.');

  let contact = null;
  let additional = [];
  let zohoError = null;

  try {
    const accessToken = await getAccessToken(secrets);
    const orgId = await resolveOrganizationId(accessToken, configuredOrgId);

    const [contactResult, addressResult] = await Promise.allSettled([
      fetchContactDetail(accessToken, orgId, contactId),
      fetchContactAddresses(accessToken, orgId, contactId),
    ]);

    if (contactResult.status === 'fulfilled') {
      contact = contactResult.value;
    } else {
      zohoError = contactResult.reason;
      console.warn('listContactAddressesForCustomer contact detail failed:', {
        contactId,
        message: contactResult.reason?.message ?? String(contactResult.reason),
      });
    }

    if (addressResult.status === 'fulfilled') {
      additional = addressResult.value;
    } else {
      zohoError = zohoError || addressResult.reason;
      console.warn('listContactAddressesForCustomer address list failed:', {
        contactId,
        message: addressResult.reason?.message ?? String(addressResult.reason),
      });
    }
  } catch (err) {
    zohoError = err;
    console.warn('listContactAddressesForCustomer Zoho auth/setup failed:', {
      contactId,
      message: err?.message ?? String(err),
    });
  }

  let rows = buildAddressRowsFromContact(contact, additional);

  if (!rows.length) {
    rows = await loadCachedCustomerAddresses(contactId);
  }

  if (!rows.length) {
    const message = zohoError?.message
      || 'Could not load shipping addresses from Zoho.';
    if (isZohoAuthDeniedError(zohoError)) {
      throw new HttpsError(
        'failed-precondition',
        `${message} The Zoho connection may lack Contacts access — re-authorize the Inventory OAuth app with ZohoInventory.contacts.READ (and CREATE to add addresses).`,
      );
    }
    throw new HttpsError('internal', message);
  }

  // Cache on customer doc for offline/fast UI (best-effort).
  if (contact || additional.length) {
    try {
      await getFirestore().collection('zohoCustomers').doc(contactId).set({
        zohoAddresses: rows,
        zohoAddressesSyncedAt: new Date().toISOString(),
      }, { merge: true });
    } catch {
      // ignore cache write failures
    }
  }

  return { customerId: contactId, addresses: rows };
}

/** Create an additional address on the Zoho contact; returns mapped row. */
export async function addContactAddress(secrets, configuredOrgId, customerId, rawAddress) {
  const contactId = String(customerId || '').trim();
  if (!contactId) throw new HttpsError('invalid-argument', 'customerId is required.');
  const addr = normalizeAddressInput(rawAddress);
  assertCompleteAddress(addr);

  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);

  const payload = await zohoJson(accessToken, orgId, `/contacts/${contactId}/address`, {
    method: 'POST',
    body: {
      attention: addr.attention,
      address: addr.address,
      street2: addr.street2 || '',
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      country: addr.country,
      phone: addr.phone,
    },
  });

  const created = payload?.address || payload?.addresses?.[0] || null;
  const addressId = created?.address_id != null
    ? String(created.address_id)
    : (payload?.address_id != null ? String(payload.address_id) : null);
  if (!addressId) {
    // Re-list and match by fields if Zoho only returned success.
    const listed = await listContactAddressesForCustomer(secrets, configuredOrgId, contactId);
    const match = listed.addresses.find(a => (
      a.address === addr.address
      && a.city === addr.city
      && a.zip === addr.zip
      && a.kind === 'additional'
    ));
    if (match) return match;
    throw new HttpsError('internal', 'Zoho did not return an address id for the new address.');
  }

  const mapped = mapAddressRow({ ...addr, address_id: addressId }, {
    kind: 'additional',
    label: 'Saved address',
  });
  return mapped;
}

export async function listAddressesForUser(uid, role, secrets, orgId) {
  const customerId = await resolveZohoCustomerIdForUser(uid, role);
  if (!customerId) {
    throw new HttpsError('failed-precondition', 'No Zoho customer is linked to this account.');
  }
  return listContactAddressesForCustomer(secrets, orgId, customerId);
}

export async function addAddressForUser(uid, role, secrets, orgId, rawAddress) {
  const customerId = await resolveZohoCustomerIdForUser(uid, role);
  if (!customerId) {
    throw new HttpsError('failed-precondition', 'No Zoho customer is linked to this account.');
  }
  return addContactAddress(secrets, orgId, customerId, rawAddress);
}

async function clearCachedAddresses(contactId) {
  try {
    await getFirestore().collection('zohoCustomers').doc(contactId).set({
      zohoAddresses: [],
      zohoAddressesSyncedAt: new Date().toISOString(),
    }, { merge: true });
  } catch {
    // ignore
  }
}

/**
 * Update an additional contact address (has address_id) via Zoho Address API.
 * Billing / default shipping (no id) update the contact's billing_address / shipping_address.
 */
export async function updateContactAddress(
  secrets,
  configuredOrgId,
  customerId,
  {
    addressId = null,
    kind = null,
    address = {},
  } = {},
) {
  const contactId = String(customerId || '').trim();
  if (!contactId) throw new HttpsError('invalid-argument', 'customerId is required.');
  const addr = normalizeAddressInput(address);
  assertCompleteAddress(addr);

  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  const id = String(addressId || '').trim();
  const kindKey = String(kind || '').trim();

  if (id) {
    await zohoJson(accessToken, orgId, `/contacts/${contactId}/address/${id}`, {
      method: 'PUT',
      body: {
        attention: addr.attention,
        address: addr.address,
        street2: addr.street2 || '',
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
        country: addr.country,
        phone: addr.phone,
      },
    });
    await clearCachedAddresses(contactId);
    const listed = await listContactAddressesForCustomer(secrets, configuredOrgId, contactId);
    const found = listed.addresses.find(a => a.addressId === id);
    if (found) return found;
    return mapAddressRow({ ...addr, address_id: id }, { kind: 'additional', label: 'Saved address' });
  }

  if (kindKey !== 'billing' && kindKey !== 'shipping') {
    throw new HttpsError(
      'invalid-argument',
      'addressId is required to update a saved address (or pass kind billing/shipping).',
    );
  }

  const contactField = kindKey === 'billing' ? 'billing_address' : 'shipping_address';
  await zohoJson(accessToken, orgId, `/contacts/${contactId}`, {
    method: 'PUT',
    body: {
      [contactField]: {
        attention: addr.attention,
        address: addr.address,
        street2: addr.street2 || '',
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
        country: addr.country,
        phone: addr.phone,
      },
    },
  });
  await clearCachedAddresses(contactId);
  const listed = await listContactAddressesForCustomer(secrets, configuredOrgId, contactId);
  const found = listed.addresses.find(a => a.kind === kindKey);
  if (found) return found;
  return mapAddressRow(addr, {
    kind: kindKey,
    label: kindKey === 'billing' ? 'Billing address' : 'Default shipping',
  });
}

/** Delete an additional contact address. Billing / default shipping cannot be deleted. */
export async function deleteContactAddress(
  secrets,
  configuredOrgId,
  customerId,
  addressId,
) {
  const contactId = String(customerId || '').trim();
  const id = String(addressId || '').trim();
  if (!contactId) throw new HttpsError('invalid-argument', 'customerId is required.');
  if (!id) {
    throw new HttpsError(
      'invalid-argument',
      'Only saved (additional) addresses can be deleted. Billing and default shipping cannot be removed here.',
    );
  }

  const accessToken = await getAccessToken(secrets);
  const orgId = await resolveOrganizationId(accessToken, configuredOrgId);
  await zohoJson(accessToken, orgId, `/contacts/${contactId}/address/${id}`, {
    method: 'DELETE',
  });
  await clearCachedAddresses(contactId);
  return { deleted: true, addressId: id };
}

export async function updateAddressForUser(uid, role, secrets, orgId, payload) {
  const customerId = await resolveZohoCustomerIdForUser(uid, role);
  if (!customerId) {
    throw new HttpsError('failed-precondition', 'No Zoho customer is linked to this account.');
  }
  return updateContactAddress(secrets, orgId, customerId, payload);
}

export async function deleteAddressForUser(uid, role, secrets, orgId, addressId) {
  const customerId = await resolveZohoCustomerIdForUser(uid, role);
  if (!customerId) {
    throw new HttpsError('failed-precondition', 'No Zoho customer is linked to this account.');
  }
  return deleteContactAddress(secrets, orgId, customerId, addressId);
}

/**
 * Resolve a selectable address into a Zoho shipping_address_id.
 * For billing/shipping defaults without id, returns null and caller may pass inline shipping_address.
 */
export async function resolveShippingAddressId(
  secrets,
  configuredOrgId,
  customerId,
  { addressId = null, kind = null, newAddress = null } = {},
) {
  if (newAddress) {
    const created = await addContactAddress(secrets, configuredOrgId, customerId, newAddress);
    if (!created?.addressId) {
      throw new HttpsError('internal', 'Could not create shipping address in Zoho.');
    }
    return { shippingAddressId: created.addressId, address: created };
  }

  const id = String(addressId || '').trim();
  if (id) {
    const listed = await listContactAddressesForCustomer(secrets, configuredOrgId, customerId);
    const found = listed.addresses.find(a => a.addressId === id);
    if (!found) {
      throw new HttpsError('invalid-argument', 'Selected address was not found on this customer.');
    }
    return { shippingAddressId: id, address: found };
  }

  const kindKey = String(kind || '').trim();
  if (kindKey === 'billing' || kindKey === 'shipping') {
    const listed = await listContactAddressesForCustomer(secrets, configuredOrgId, customerId);
    const found = listed.addresses.find(a => a.kind === kindKey);
    if (!found) {
      throw new HttpsError('invalid-argument', `No ${kindKey} address on this customer.`);
    }
    if (found.addressId) {
      return { shippingAddressId: found.addressId, address: found };
    }
    // Fallback: no id — return address fields for inline SO shipping_address
    return { shippingAddressId: null, address: found, useInline: true };
  }

  throw new HttpsError(
    'invalid-argument',
    'Select a saved shipping address or enter a new one.',
  );
}
