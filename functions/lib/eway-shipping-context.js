/**
 * Resolve e-way shipping context from portal logistics bookings:
 * ship-from (dispatch) address, delivery address, Zoho dispatch-from id, distance (km).
 */
import { extractIndianPincode } from './delhivery-freight.js';
import { lookupPincodeLocation, normalizeStateName } from './location-utils.js';

const GST_STATE_CODES = Object.freeze({
  'andhra pradesh': '37',
  'arunachal pradesh': '12',
  assam: '18',
  bihar: '10',
  chhattisgarh: '22',
  goa: '30',
  gujarat: '24',
  haryana: '06',
  'himachal pradesh': '02',
  'jammu and kashmir': '01',
  jharkhand: '20',
  karnataka: '29',
  kerala: '32',
  'madhya pradesh': '23',
  maharashtra: '27',
  manipur: '14',
  meghalaya: '17',
  mizoram: '15',
  nagaland: '13',
  odisha: '21',
  punjab: '03',
  rajasthan: '08',
  sikkim: '11',
  'tamil nadu': '33',
  telangana: '36',
  tripura: '16',
  'uttar pradesh': '09',
  uttarakhand: '05',
  'west bengal': '19',
  'andaman and nicobar islands': '35',
  chandigarh: '04',
  'dadra and nagar haveli and daman and diu': '26',
  delhi: '07',
  lakshadweep: '31',
  puducherry: '34',
  ladakh: '38',
});

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function gstStateCode(stateName) {
  const key = cleanText(stateName).toLowerCase();
  return GST_STATE_CODES[key] || '';
}

function extractPhone(raw) {
  const match = String(raw ?? '').match(/(?:\+?91[\s-]?)?([6-9]\d{9})\b/);
  return match ? `+91 ${match[1]}` : '';
}

function detectState(raw) {
  const text = cleanText(raw).toLowerCase();
  if (!text) return '';
  for (const key of Object.keys(GST_STATE_CODES)) {
    if (text.includes(key)) {
      const titled = key.replace(/\b\w/g, ch => ch.toUpperCase());
      return normalizeStateName(titled) || titled;
    }
  }
  return '';
}

/**
 * Parse a multiline portal logistics address into Zoho dispatch-from fields.
 * @param {string} raw
 */
export function parsePortalLogisticsAddress(raw) {
  const text = String(raw ?? '').replace(/\r/g, '').trim();
  if (!text) return null;

  const zip = extractIndianPincode(text);
  const phone = extractPhone(text);
  const state = detectState(text);

  const withoutPhone = text
    .replace(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, '')
    .replace(/\bPIN\s*:?\s*\d{6}\b/gi, '')
    .trim();

  const lines = withoutPhone.split(/\n+/).map(line => cleanText(line)).filter(Boolean);
  const commaParts = withoutPhone
    .split(/[,\n]+/)
    .map(part => cleanText(part.replace(/\b\d{6}\b/g, '')))
    .filter(Boolean);

  const companyName = (lines[0] || commaParts[0] || 'Dispatch').slice(0, 100);
  const attention = (lines[1] || companyName).slice(0, 100);

  let city = '';
  if (state) {
    const stateIdx = commaParts.findIndex(part => part.toLowerCase().includes(state.toLowerCase()));
    if (stateIdx > 0) city = commaParts[stateIdx - 1];
  }
  if (!city) {
    const tail = commaParts[commaParts.length - 1] || '';
    if (tail && tail.toLowerCase() !== state.toLowerCase() && !/^\d+$/.test(tail)) {
      city = tail;
    }
  }

  const addressParts = commaParts.filter(part => {
    const lower = part.toLowerCase();
    return lower !== companyName.toLowerCase()
      && lower !== city.toLowerCase()
      && lower !== state.toLowerCase();
  });
  const address = (addressParts.join(', ') || companyName).slice(0, 100);
  const street2 = addressParts.length > 1 ? addressParts.slice(1).join(', ').slice(0, 100) : '';

  if (!zip) return null;

  return {
    attention,
    company_name: companyName,
    address,
    street2,
    city: city.slice(0, 50),
    state: state.slice(0, 50),
    state_code: gstStateCode(state),
    zip,
    country: 'India',
    country_code: 'IN',
    phone,
    fax: '',
  };
}

async function enrichAddressFromPincode(fields) {
  if (!fields?.zip) return fields;
  const loc = await lookupPincodeLocation(fields.zip);
  if (!loc) return fields;
  return {
    ...fields,
    city: fields.city || loc.district || fields.city,
    state: fields.state || loc.state || fields.state,
    state_code: fields.state_code || gstStateCode(loc.state || fields.state),
  };
}

function haversineKm(a, b) {
  const toRad = deg => (deg * Math.PI) / 180;
  const lat1 = toRad(Number(a.lat));
  const lat2 = toRad(Number(b.lat));
  const dLat = lat2 - lat1;
  const dLon = toRad(Number(b.lon) - Number(a.lon));
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function geocodeIndianPincode(pin, locationHint = null) {
  const key = String(pin ?? '').replace(/\D/g, '').slice(0, 6);
  if (key.length !== 6) return null;

  const query = locationHint?.district && locationHint?.state
    ? `${key}, ${locationHint.district}, ${locationHint.state}, India`
    : `${key}, India`;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'in');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'YesWeighService/1.0 (logistics e-way)' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const rows = await res.json();
    const hit = Array.isArray(rows) ? rows[0] : null;
    if (!hit?.lat || !hit?.lon) return null;
    return { lat: Number(hit.lat), lon: Number(hit.lon) };
  } catch {
    return null;
  }
}

/**
 * Estimate road distance (km) between two Indian pincodes.
 * @param {string} fromPin
 * @param {string} toPin
 */
export async function estimateRoadDistanceKm(fromPin, toPin) {
  const from = String(fromPin ?? '').replace(/\D/g, '').slice(0, 6);
  const to = String(toPin ?? '').replace(/\D/g, '').slice(0, 6);
  if (from.length !== 6 || to.length !== 6) return null;
  if (from === to) return 5;

  const [fromLoc, toLoc] = await Promise.all([
    lookupPincodeLocation(from),
    lookupPincodeLocation(to),
  ]);
  const [fromCoord, toCoord] = await Promise.all([
    geocodeIndianPincode(from, fromLoc),
    geocodeIndianPincode(to, toLoc),
  ]);

  if (fromCoord && toCoord) {
    const km = haversineKm(fromCoord, toCoord) * 1.25;
    return Math.max(1, Math.min(4000, Math.round(km)));
  }

  if (fromLoc?.district && toLoc?.district && fromLoc.district === toLoc.district) {
    return 30;
  }
  if (fromLoc?.state && toLoc?.state && fromLoc.state === toLoc.state) {
    return 200;
  }
  return 500;
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} bookingId
 */
export async function loadBookingShippingContext(db, bookingId) {
  const id = String(bookingId ?? '').trim();
  if (!id) return null;

  const snap = await db.collection('logisticsBookings').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};

  let shipFromAddress = String(data.shipFromAddress ?? '').trim();
  if (!shipFromAddress) {
    const site = String(data.shipFromSite ?? '').trim();
    if (site) {
      const settingsSnap = await db.doc('appSettings/logisticsSettings').get();
      const fromAddresses = settingsSnap.data()?.fromAddresses;
      if (fromAddresses && typeof fromAddresses === 'object') {
        shipFromAddress = String(fromAddresses[site] ?? '').trim();
      }
    }
  }

  const deliveryAddress = String(data.deliveryAddress ?? '').trim()
    || String(data.dealerSnapshot?.shippingAddress ?? '').trim()
    || String(data.dealerSnapshot?.billingAddress ?? '').trim();

  if (!shipFromAddress) return null;

  return {
    shipFromAddress,
    deliveryAddress,
    shipFromSite: data.shipFromSite ? String(data.shipFromSite) : null,
  };
}

function staffSiteFromZohoWarehouse(input) {
  const name = String(input?.warehouseName ?? '').trim().toLowerCase();
  if (name) {
    if (name === 'head office' || (name.includes('head') && name.includes('office'))) {
      return 'head_office';
    }
    if (name === 'cochin' || name.includes('cochin')) {
      return 'cochin';
    }
  }
  return null;
}

function inventorySiteLabel(site) {
  return site === 'head_office' ? 'Head Office' : 'Cochin';
}

/**
 * Resolve Cochin / Head Office ship-from from invoice mirror (+ linked SO when present).
 * @param {import('firebase-admin/firestore').Firestore} db
 */
export async function resolveInvoiceShipFromSite(db, invoice) {
  const salesOrderId = String(invoice?.salesOrderId ?? '').trim();
  if (salesOrderId) {
    try {
      const snap = await db.collection('salesOrders').doc(salesOrderId).get();
      if (snap.exists) {
        const data = snap.data() ?? {};
        const site = String(data.yesOneInventorySite ?? '').trim();
        if (site === 'head_office' || site === 'cochin') {
          return {
            site,
            branchLabel: String(data.yesOneBranchLabel ?? '').trim() || inventorySiteLabel(site),
          };
        }
      }
    } catch {
      // fall through
    }
  }

  const fromWarehouse = staffSiteFromZohoWarehouse({
    warehouseName: invoice?.zohoWarehouseName ?? null,
  });
  if (fromWarehouse) {
    return {
      site: fromWarehouse,
      branchLabel: inventorySiteLabel(fromWarehouse),
    };
  }

  return { site: 'cochin', branchLabel: inventorySiteLabel('cochin') };
}

/**
 * Ship-from / delivery for invoice customer pickup (no logistics booking).
 * @param {import('firebase-admin/firestore').Firestore} db
 */
export async function loadInvoiceShippingContext(db, customerId, invoiceId, shipFromSite = 'cochin') {
  const { invoicesCollection } = await import('./invoice-sync.js');
  const cid = String(customerId ?? '').trim();
  const iid = String(invoiceId ?? '').trim();
  if (!cid || !iid) return null;

  const snap = await invoicesCollection(cid).doc(iid).get();
  if (!snap.exists) return null;
  const invoice = snap.data() ?? {};

  const site = String(shipFromSite ?? 'cochin').trim() || 'cochin';
  const settingsSnap = await db.doc('appSettings/logisticsSettings').get();
  const fromAddresses = settingsSnap.data()?.fromAddresses;
  const shipFromAddress = fromAddresses && typeof fromAddresses === 'object'
    ? String(fromAddresses[site] ?? '').trim()
    : '';

  const deliveryAddress = String(invoice.shippingAddress ?? invoice.billingAddress ?? '').trim();
  if (!shipFromAddress) return null;

  return {
    shipFromAddress,
    deliveryAddress,
    shipFromSite: site,
  };
}

/** Place + GST state code for e-way Part B vehicle update. */
export function ewayVehicleOriginFromAddress(shipFromAddress) {
  const parsed = parsePortalLogisticsAddress(String(shipFromAddress ?? ''));
  if (!parsed) {
    throw new Error(
      'Ship-from address is missing a valid 6-digit pincode. Check Logistics settings.',
    );
  }
  const fromState = gstStateCode(parsed.state);
  if (!fromState) {
    throw new Error(
      'Could not determine GST state from ship-from address. Check Logistics settings.',
    );
  }
  const fromPlace = String(parsed.city || parsed.companyName || 'Dispatch').slice(0, 50);
  return { fromPlace, fromState };
}

/**
 * @param {(accessToken: string, orgId: string, path: string, opts?: object) => Promise<any>} zohoJson
 * @param {string} shipFromAddress
 * @param {{ db?: import('firebase-admin/firestore').Firestore | null; shipFromSite?: string | null }} [options]
 */
export async function ensureZohoDispatchFromAddress(
  accessToken,
  orgId,
  zohoJson,
  shipFromAddress,
  options = {},
) {
  const parsed = await enrichAddressFromPincode(parsePortalLogisticsAddress(shipFromAddress));
  if (!parsed?.zip) {
    throw new Error(
      'Ship-from address on this shipment is missing a valid 6-digit pincode. '
      + 'Update Sites → ship-from address in Logistics settings, apply it to this booking, then retry.',
    );
  }

  const db = options.db ?? null;
  const shipFromSite = String(options.shipFromSite ?? '').trim();
  if (db && shipFromSite) {
    const settingsSnap = await db.doc('appSettings/logisticsSettings').get();
    const cached = settingsSnap.data()?.zohoDispatchFromBySite?.[shipFromSite];
    if (cached?.addressId && String(cached.zip ?? '') === parsed.zip) {
      return String(cached.addressId);
    }
  }

  const created = await zohoJson(accessToken, orgId, '/ewaybills/address/dispatchfrom', {
    method: 'POST',
    body: parsed,
  });
  const addressId = created?.address_info?.address_id ?? created?.address?.address_id;
  if (!addressId) {
    throw new Error('Zoho did not return a dispatch-from address id.');
  }

  if (db && shipFromSite) {
    await db.doc('appSettings/logisticsSettings').set({
      zohoDispatchFromBySite: {
        [shipFromSite]: {
          addressId: String(addressId),
          zip: parsed.zip,
          updatedAt: new Date().toISOString(),
        },
      },
    }, { merge: true });
  }

  return String(addressId);
}

/**
 * @param {{
 *   shipFromAddress?: string | null;
 *   deliveryAddress?: string | null;
 *   zohoShippingAddress?: object | string | null;
 * }} input
 */
export async function resolvePortalEwayDistanceKm(input) {
  const fromPin = extractIndianPincode(input.shipFromAddress);
  const toPin = extractIndianPincode(input.deliveryAddress)
    || extractIndianPincode(input.zohoShippingAddress?.zip)
    || extractIndianPincode(input.zohoShippingAddress);

  if (!fromPin) return null;
  if (!toPin) return null;
  return estimateRoadDistanceKm(fromPin, toPin);
}
