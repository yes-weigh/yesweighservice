/**
 * Keep Delhivery registered pickup warehouse phone / GSTIN in sync.
 *
 * Shipper copy ("SHIPMENT PICKED FROM") reads these from the warehouse profile
 * (pickup_location_name), not from return_address / billing_address on manifest.
 *
 * PATCH {ltl}/client-warehouses/update
 */

import { getValidDelhiveryJwt, loadDelhiveryB2bPublicConfig, LOGISTICS_SETTINGS_DOC } from './delhivery-b2b.js';
import { delhiveryLtlBaseUrl } from './delhivery-freight.js';

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function phoneDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeGstin(value) {
  const text = String(value ?? '').trim().toUpperCase();
  return /^[0-9A-Z]{15}$/.test(text) ? text : null;
}

function pinFromText(value) {
  const match = /\b(\d{6})\b/.exec(String(value ?? ''));
  return match?.[1] || null;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} site
 */
export async function loadShipFromContactForSite(db, site) {
  const snap = await db.doc(LOGISTICS_SETTINGS_DOC).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const key = String(site || '').trim() || 'cochin';
  const address = nonEmpty(data.fromAddresses?.[key])
    || nonEmpty(data.fromAddresses?.cochin)
    || nonEmpty(data.fromAddresses?.head_office)
    || '';
  const contact = data.fromSiteContacts?.[key]
    || data.fromSiteContacts?.cochin
    || data.fromSiteContacts?.head_office
    || {};
  const phone = phoneDigits(contact.phone) || phoneDigits('8803333444');
  const gstin = normalizeGstin(contact.gstin) || normalizeGstin('32AAFCI1950F1ZZ');
  return {
    site: key,
    address: address.replace(/\s+/g, ' ').trim(),
    phone,
    gstin,
    pin: pinFromText(address) || '683503',
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{
 *   warehouseName: string,
 *   address: string,
 *   phone: string,
 *   gstin: string,
 *   city?: string,
 *   state?: string,
 *   pin?: string,
 * }} input
 */
export async function updateDelhiveryWarehouseContacts(db, input) {
  const warehouseName = nonEmpty(input.warehouseName);
  const address = nonEmpty(input.address);
  const phone = phoneDigits(input.phone);
  const gstin = normalizeGstin(input.gstin);
  if (!warehouseName) throw new Error('Delhivery warehouse name is required.');
  if (!address) throw new Error('Ship-from address is required to update Delhivery warehouse.');
  if (!phone) throw new Error('Ship-from phone is required to update Delhivery warehouse.');
  if (!gstin) throw new Error('Ship-from GSTIN is required to update Delhivery warehouse.');

  const pin = Number(String(input.pin || pinFromText(address) || '683503').replace(/\D/g, '').slice(0, 6));
  const auth = await getValidDelhiveryJwt(db);
  const base = delhiveryLtlBaseUrl(auth.env);
  const body = {
    cl_warehouse_name: warehouseName,
    update_dict: {
      ...(nonEmpty(input.city) ? { city: nonEmpty(input.city) } : {}),
      ...(nonEmpty(input.state) ? { state: nonEmpty(input.state) } : {}),
      country: 'India',
      address_details: {
        address,
        contact_person: 'Interweighing',
        phone_number: phone,
        company: 'Interweighing Pvt Ltd',
        email: 'admin@yesweigh.in',
      },
      billing_details: {
        gst_number: gstin,
        legal_address: {
          same_as_physical_address: true,
          pin_code: Number.isFinite(pin) ? pin : 683503,
        },
      },
    },
  };

  const res = await fetch(`${base}/client-warehouses/update`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${auth.jwt}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  if (!res.ok || json?.success === false) {
    const message = json?.error?.message
      || json?.message
      || text.slice(0, 300)
      || `Warehouse update failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return {
    ok: true,
    warehouseName,
    phone,
    gstin,
    env: auth.env,
    result: json?.data?.result || json?.data || null,
  };
}

/**
 * Sync site ship-from phone/GSTIN onto the Delhivery pickup warehouse used for booking.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} site
 * @param {string} [warehouseName]
 */
export async function syncDelhiveryWarehouseForSite(db, site, warehouseName) {
  const config = await loadDelhiveryB2bPublicConfig(db);
  const contact = await loadShipFromContactForSite(db, site);
  const name = nonEmpty(warehouseName)
    || nonEmpty(config.pickupLocationBySite?.[site])
    || nonEmpty(config.pickupLocationBySite?.cochin)
    || nonEmpty(config.pickupLocationBySite?.head_office);
  if (!name) {
    throw new Error('Delhivery pickup location name is not configured for this site.');
  }
  if (!contact.address) {
    throw new Error('Ship-from address is missing in Logistics Settings → Sites.');
  }
  return updateDelhiveryWarehouseContacts(db, {
    warehouseName: name,
    address: contact.address,
    phone: contact.phone,
    gstin: contact.gstin,
    pin: contact.pin,
    city: /cochin|kochi/i.test(contact.address) ? 'Cochin' : undefined,
    state: /kerala/i.test(contact.address) ? 'Kerala' : undefined,
  });
}
