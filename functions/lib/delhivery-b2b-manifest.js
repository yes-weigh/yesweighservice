/**
 * Delhivery B2B shipment creation (manifest) per official docs:
 * https://one.delhivery.com/developer-portal/document/b2b/detail/shipment-creation
 *
 * POST multipart/form-data → {ltl}/manifest  (async job_id)
 * GET  {ltl}/manifest?job_id=…              → LR / AWB
 *
 * Hosts:
 *   staging:    https://ltl-clients-api-dev.delhivery.com
 *   production: https://ltl-clients-api.delhivery.com
 *
 * Freight: freight_mode = fop (BTC) | fod (FOD). Goods payment_mode = prepaid.
 */

import { getValidDelhiveryJwt, loadDelhiveryB2bPublicConfig } from './delhivery-b2b.js';
import { delhiveryLtlBaseUrl } from './delhivery-freight.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** @param {unknown} raw @returns {'fod' | 'fop'} */
export function delhiveryFreightModeFromBilling(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value === 'fod' ? 'fod' : 'fop';
}

/**
 * Build multipart fields for POST /manifest (LTL clients API).
 *
 * @param {{
 *   pickupLocationName: string,
 *   orderId: string,
 *   consignee: {
 *     name: string,
 *     phone: string,
 *     address: string,
 *     city?: string,
 *     state?: string,
 *     pincode: string,
 *     country?: string,
 *     email?: string,
 *   },
 *   returnAddress?: {
 *     name?: string,
 *     phone?: string,
 *     address?: string,
 *     city?: string,
 *     state?: string,
 *     pincode?: string,
 *     country?: string,
 *   } | null,
 *   boxes: Array<{
 *     lengthCm?: number,
 *     widthCm?: number,
 *     heightCm?: number,
 *     weightKg?: number,
 *     quantity?: number,
 *   }>,
 *   invoiceNumber?: string | null,
 *   invoiceValueInr?: number | null,
 *   invoiceDate?: string | null,
 *   productsDesc?: string | null,
 *   hsnCode?: string | null,
 *   sellerGstin?: string | null,
 *   paymentMode?: string | null,
 *   shippingMode?: string | null,
 *   freightBillingMode?: 'fod' | 'btc' | string | null,
 *   billingAddress?: {
 *     name?: string,
 *     company?: string,
 *     consignor?: string,
 *     address?: string,
 *     city?: string,
 *     state?: string,
 *     pin?: string,
 *     phone?: string,
 *     pan_number?: string,
 *     gst_number?: string,
 *   } | null,
 * }} input
 */
export function buildDelhiveryB2bManifestPayload(input) {
  const pickup = nonEmpty(input.pickupLocationName);
  if (!pickup) {
    throw new Error('Delhivery pickup location name is required (set it in Logistics Settings → Delhivery).');
  }
  const consignee = input.consignee || {};
  const name = nonEmpty(consignee.name);
  const phone = String(consignee.phone || '').replace(/\D/g, '');
  const address = nonEmpty(consignee.address);
  const pin = String(consignee.pincode || '').replace(/\D/g, '');
  if (!name || !phone || !address || pin.length !== 6) {
    throw new Error('Consignee name, phone, address, and 6-digit pincode are required.');
  }

  const boxes = Array.isArray(input.boxes) ? input.boxes : [];
  if (!boxes.length) {
    throw new Error('At least one box is required to book Delhivery.');
  }

  let totalWeightKg = 0;
  let boxCount = 0;
  /** @type {Array<Record<string, number>>} */
  const dimensions = [];
  for (const box of boxes) {
    const count = Math.max(1, Math.round(asNumber(box.quantity, 1)));
    // LTL /manifest dimensions schema: length, width, height, box_count (cm).
    const length = Math.max(1, Math.round(asNumber(box.lengthCm, 10)));
    const width = Math.max(1, Math.round(asNumber(box.widthCm, 10)));
    const height = Math.max(1, Math.round(asNumber(box.heightCm, 10)));
    const weightKg = Math.max(0.1, asNumber(box.weightKg, 1));
    totalWeightKg += weightKg * count;
    boxCount += count;
    dimensions.push({
      length,
      width,
      height,
      box_count: count,
    });
  }

  const weightG = Math.max(1, Math.round(totalWeightKg * 1000));
  const invoiceValue = Math.max(1, asNumber(input.invoiceValueInr, 1));
  const invoiceNumber = nonEmpty(input.invoiceNumber) || String(input.orderId || 'INV');
  const productsDesc = nonEmpty(input.productsDesc) || 'Goods';
  const freightMode = delhiveryFreightModeFromBilling(input.freightBillingMode);
  const orderId = String(input.orderId || `YW-${Date.now()}`);
  // Interweighing firm GSTIN — LTL requires PAN or GSTIN on billing_address for FoD/FoP.
  const DEFAULT_GSTIN = '32AAFCI1950F1ZZ';
  const sellerGstin = (nonEmpty(input.sellerGstin) || DEFAULT_GSTIN).toUpperCase();

  const dropoff_location = {
    consignee_name: name,
    address,
    city: nonEmpty(consignee.city) || 'NA',
    state: nonEmpty(consignee.state) || 'NA',
    zip: pin,
    phone,
    email: nonEmpty(consignee.email) || '',
  };

  // Keep shipment_details minimal — extra keys (waybills/master) break list parsing
  // when paired with wrong dimension field names.
  const shipment_details = [
    {
      order_id: orderId,
      box_count: boxCount,
      description: productsDesc,
      weight: weightG,
    },
  ];

  const invoices = [
    {
      ewaybill: '',
      inv_num: invoiceNumber,
      inv_amt: invoiceValue,
      inv_qr_code: '',
    },
  ];

  const ret = input.returnAddress || null;
  const return_address = ret && nonEmpty(ret.address)
    ? {
      name: nonEmpty(ret.name) || pickup,
      phone: String(ret.phone || phone).replace(/\D/g, '') || phone,
      address: nonEmpty(ret.address),
      city: nonEmpty(ret.city) || 'NA',
      state: nonEmpty(ret.state) || 'NA',
      zip: String(ret.pincode || '').replace(/\D/g, '') || pin,
    }
    : undefined;

  // FoD/FoP both require billing_address with PAN or GSTIN.
  const billing = input.billingAddress || null;
  const billingBase = billing && nonEmpty(billing.address)
    ? {
      name: nonEmpty(billing.name) || pickup,
      company: nonEmpty(billing.company) || nonEmpty(billing.name) || pickup,
      consignor: nonEmpty(billing.consignor) || nonEmpty(billing.company) || pickup,
      address: nonEmpty(billing.address),
      city: nonEmpty(billing.city) || 'NA',
      state: nonEmpty(billing.state) || 'NA',
      pin: String(billing.pin || '').replace(/\D/g, '') || (return_address?.zip || pin),
      phone: String(billing.phone || phone).replace(/\D/g, '') || phone,
    }
    : (return_address
      ? {
        name: return_address.name,
        company: return_address.name,
        consignor: return_address.name,
        address: return_address.address,
        city: return_address.city,
        state: return_address.state,
        pin: return_address.zip,
        phone: return_address.phone,
      }
      : {
        name: pickup,
        company: pickup,
        consignor: pickup,
        address: 'Pickup warehouse',
        city: 'NA',
        state: 'NA',
        pin,
        phone,
      });

  const billing_address = {
    ...billingBase,
    gst_number: nonEmpty(billing?.gst_number) || sellerGstin,
    ...(nonEmpty(billing?.pan_number) ? { pan_number: nonEmpty(billing.pan_number) } : {}),
  };

  return {
    pickup_location_name: pickup,
    payment_mode: 'prepaid',
    weight: weightG,
    dropoff_location,
    shipment_details,
    invoices,
    dimensions,
    freight_mode: freightMode,
    fm_pickup: true,
    rov_insurance: false,
    billing_address,
    ...(return_address ? { return_address } : {}),
    // Kept for debugging / logs (not all sent as form keys).
    _meta: {
      orderId,
      boxCount,
      totalWeightKg,
      freightBillingMode: freightMode === 'fod' ? 'fod' : 'btc',
    },
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {Record<string, unknown>} payload from buildDelhiveryB2bManifestPayload
 */
function buildManifestFormData(payload) {
  const form = new FormData();
  form.append('pickup_location_name', String(payload.pickup_location_name));
  form.append('payment_mode', String(payload.payment_mode || 'prepaid'));
  form.append('weight', String(payload.weight));
  form.append('dropoff_location', JSON.stringify(payload.dropoff_location));
  form.append('shipment_details', JSON.stringify(payload.shipment_details));
  form.append('invoices', JSON.stringify(payload.invoices));
  form.append('freight_mode', String(payload.freight_mode || 'fop'));
  form.append('fm_pickup', payload.fm_pickup === false ? 'False' : 'True');
  form.append('rov_insurance', payload.rov_insurance === true ? 'True' : 'False');
  if (Array.isArray(payload.dimensions) && payload.dimensions.length) {
    form.append('dimensions', JSON.stringify(payload.dimensions));
  }
  if (payload.return_address) {
    form.append('return_address', JSON.stringify(payload.return_address));
  }
  if (payload.billing_address) {
    form.append('billing_address', JSON.stringify(payload.billing_address));
  }
  return form;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {Record<string, unknown>} payload from buildDelhiveryB2bManifestPayload
 */
async function postLtlManifest(db, payload) {
  const auth = await getValidDelhiveryJwt(db);
  const base = delhiveryLtlBaseUrl(auth.env);
  const url = `${base}/manifest`;

  async function send(jwt) {
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/json',
      },
      // Rebuild each attempt — FormData body is single-use.
      body: buildManifestFormData(payload),
    });
  }

  let res = await send(auth.jwt);
  if (res.status === 401 || res.status === 403) {
    const fresh = await getValidDelhiveryJwt(db, { force: true });
    res = await send(fresh.jwt);
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text, env: auth.env, url };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} jobId
 */
async function getLtlManifestJob(db, jobId) {
  const auth = await getValidDelhiveryJwt(db);
  const base = delhiveryLtlBaseUrl(auth.env);
  const url = new URL(`${base}/manifest`);
  url.searchParams.set('job_id', jobId);

  async function send(jwt) {
    return fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/json',
      },
    });
  }

  let res = await send(auth.jwt);
  if (res.status === 401 || res.status === 403) {
    const fresh = await getValidDelhiveryJwt(db, { force: true });
    res = await send(fresh.jwt);
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

function extractJobId(json) {
  if (!json || typeof json !== 'object') return '';
  const candidates = [
    json.job_id,
    json.jobId,
    json.request_id,
    json.data?.job_id,
    json.data?.jobId,
    json.data?.request_id,
    json.result?.job_id,
  ];
  for (const value of candidates) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function extractLrn(json) {
  if (!json || typeof json !== 'object') return '';
  const candidates = [
    json.lrn,
    json.lrnum,
    json.lr_number,
    json.lrNumber,
    json.master_waybill,
    json.waybill,
    json.data?.lrn,
    json.data?.lrnum,
    json.data?.lr_number,
    json.data?.lrNumber,
    json.data?.lrn_number,
    json.result?.lrn,
    json.result?.lrnum,
    json.shipments?.[0]?.lrn,
    json.data?.shipments?.[0]?.lrn,
    json.data?.success?.[0]?.lrn,
    json.data?.success?.[0]?.lr_number,
    json.data?.result?.lrn,
  ];
  for (const value of candidates) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  const blob = JSON.stringify(json);
  const match = /\b(\d{9})\b/.exec(blob);
  return match?.[1] || '';
}

function extractErrorMessage(json, text, status) {
  const err = json?.error;
  const nested = err && typeof err === 'object'
    ? (err.message || err.msg || err.detail)
    : err;
  return String(
    nested
    || json?.message
    || json?.data?.message
    || text
    || `Delhivery manifest failed (${status})`,
  );
}

/**
 * Create a Delhivery B2B LR via LTL /manifest and poll for LR.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {Parameters<typeof buildDelhiveryB2bManifestPayload>[0]} input
 * @param {{ pollMs?: number, maxAttempts?: number }} [options]
 */
export async function bookDelhiveryB2bShipment(db, input, options = {}) {
  const config = await loadDelhiveryB2bPublicConfig(db);
  if (!config.passwordSet) {
    throw new Error('Delhivery B2B credentials are not configured.');
  }

  const payload = buildDelhiveryB2bManifestPayload(input);
  const created = await postLtlManifest(db, payload);

  if (!created.ok) {
    throw new Error(extractErrorMessage(created.json, created.text, created.status));
  }

  let lrn = extractLrn(created.json);
  let jobId = extractJobId(created.json);
  if (lrn) {
    return {
      ok: true,
      lrn,
      jobId: jobId || null,
      env: created.env,
      raw: created.json,
      payload,
    };
  }

  if (!jobId) {
    throw new Error(
      'Delhivery accepted the request but returned no LR number or job id. '
      + `Response: ${created.text?.slice(0, 240) || '(empty)'}`,
    );
  }

  const pollMs = Number(options.pollMs) > 0 ? Number(options.pollMs) : 2000;
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 20;
  let lastJson = created.json;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(pollMs);
    const polled = await getLtlManifestJob(db, jobId);
    lastJson = polled.json;
    if (!polled.ok) {
      const message = extractErrorMessage(polled.json, polled.text, polled.status);
      if (/invalid job|not ready|processing|pending/i.test(message) && attempt < 5) continue;
      throw new Error(message);
    }
    lrn = extractLrn(polled.json);
    if (lrn) {
      return {
        ok: true,
        lrn,
        jobId,
        env: created.env,
        raw: polled.json,
        payload,
      };
    }
    const statusText = String(
      polled.json?.status
      || polled.json?.data?.status
      || polled.json?.state
      || polled.json?.data?.state
      || '',
    ).toLowerCase();
    if (statusText.includes('fail') || statusText.includes('error')) {
      throw new Error(extractErrorMessage(polled.json, polled.text, polled.status));
    }
  }

  throw new Error(
    `Delhivery job ${jobId} did not return an LR in time. `
    + `Last response: ${JSON.stringify(lastJson)?.slice(0, 240) || '(empty)'}`,
  );
}

/**
 * Resolve configured pickup location name for a logistics site.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} site
 */
export async function resolveDelhiveryPickupLocationName(db, site) {
  const config = await loadDelhiveryB2bPublicConfig(db);
  const key = site === 'cochin' ? 'cochin' : 'head_office';
  return config.pickupLocationBySite[key] || '';
}
