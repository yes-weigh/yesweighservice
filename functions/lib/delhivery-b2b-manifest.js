/**
 * Delhivery B2B manifest (create LR) via POST /v2/manifest + poll GET ?job_id=
 *
 * Production schema (probed):
 *   - dropoff_location (+ zip), not drop_location
 *   - suborders[] with ident
 *   - invoices[] with ident, n_value, description, count
 *   - dimensions[] with ident, count, description
 *   - freight_mode: FoP (BTC) | FoD (FOD)
 *   - payment_mode: Prepaid (goods CoD not used)
 *
 * We never book goods CoD — only freight FoP/FoD.
 */

import {
  delhiveryB2bFetch,
  loadDelhiveryB2bPublicConfig,
} from './delhivery-b2b.js';

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

/** @param {unknown} raw @returns {'FoD' | 'FoP'} */
export function delhiveryFreightModeFromBilling(raw) {
  const value = String(raw || '').trim().toLowerCase();
  // FOD = consignee pays freight; BTC / default = bill to client (FoP).
  return value === 'fod' ? 'FoD' : 'FoP';
}

/**
 * Build the /v2/manifest body from booking inputs.
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

  let totalWeight = 0;
  let boxCount = 0;
  const dimensions = boxes.map((box, index) => {
    const count = Math.max(1, Math.round(asNumber(box.quantity, 1)));
    const length = Math.max(1, asNumber(box.lengthCm, 10));
    const width = Math.max(1, asNumber(box.widthCm, 10));
    const height = Math.max(1, asNumber(box.heightCm, 10));
    const weight = Math.max(0.1, asNumber(box.weightKg, 1));
    totalWeight += weight * count;
    boxCount += count;
    const ident = `BOX${index + 1}`;
    return {
      ident,
      box_count: count,
      count,
      length,
      width,
      height,
      weight,
      description: `Box ${index + 1}`,
    };
  });

  const invoiceValue = Math.max(1, asNumber(input.invoiceValueInr, 1));
  const invoiceNumber = nonEmpty(input.invoiceNumber) || String(input.orderId || 'INV');
  const invoiceDate = nonEmpty(input.invoiceDate)
    || new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
  const productsDesc = nonEmpty(input.productsDesc) || 'Goods';
  const freightMode = delhiveryFreightModeFromBilling(input.freightBillingMode);

  const dropoff_location = {
    name,
    phone,
    address,
    city: nonEmpty(consignee.city) || 'NA',
    state: nonEmpty(consignee.state) || 'NA',
    country: nonEmpty(consignee.country) || 'India',
    pin: Number(pin),
    zip: pin,
  };

  const ret = input.returnAddress || null;
  const return_address = ret && nonEmpty(ret.address)
    ? {
      name: nonEmpty(ret.name) || pickup,
      phone: String(ret.phone || phone).replace(/\D/g, '') || phone,
      address: nonEmpty(ret.address),
      city: nonEmpty(ret.city) || 'NA',
      state: nonEmpty(ret.state) || 'NA',
      country: nonEmpty(ret.country) || 'India',
      pin: Number(String(ret.pincode || '').replace(/\D/g, '') || pin),
      zip: String(ret.pincode || '').replace(/\D/g, '') || pin,
    }
    : undefined;

  const suborders = dimensions.map((dim, index) => ({
    ident: `SO${index + 1}`,
    count: dim.count,
    weight: dim.weight,
    description: dim.description,
  }));

  const invoiceIdent = `INV1`;
  const invoices = [
    {
      ident: invoiceIdent,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      invoice_value: invoiceValue,
      n_value: invoiceValue,
      description: productsDesc,
      count: 1,
      ewaybill: '',
    },
  ];

  return {
    pickup_location: pickup,
    dropoff_location,
    ...(return_address ? { return_address } : {}),
    // Freight billing only: FoP = BTC, FoD = FOD. Not goods CoD.
    freight_mode: freightMode,
    // d_mode must mirror freight for FOD/BTC (not goods CoD / not Surface).
    d_mode: freightMode,
    amount: invoiceValue,
    weight: Math.round(totalWeight * 1000) / 1000,
    count: boxCount,
    box_count: boxCount,
    dimensions,
    suborders,
    products_desc: productsDesc,
    description: productsDesc,
    cod_amount: 0,
    tax_value: 0,
    // Always prepaid for goods — FOD/BTC is freight_mode only.
    payment_mode: 'Prepaid',
    seller_gst_tin: nonEmpty(input.sellerGstin) || '',
    client_gst_tin: nonEmpty(input.sellerGstin) || '',
    consignee_gst_tin: '',
    hsn_code: nonEmpty(input.hsnCode) || '',
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    invoices,
    ewaybill: '',
    order: String(input.orderId || `YW-${Date.now()}`),
  };
}

function extractJobId(json) {
  if (!json || typeof json !== 'object') return '';
  const candidates = [
    json.job_id,
    json.jobId,
    json.data?.job_id,
    json.data?.jobId,
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
    json.lr_number,
    json.lrNumber,
    json.master_waybill,
    json.waybill,
    json.data?.lrn,
    json.data?.lr_number,
    json.data?.lrNumber,
    json.result?.lrn,
    json.shipments?.[0]?.lrn,
    json.data?.shipments?.[0]?.lrn,
    json.data?.success?.[0]?.lrn,
    json.data?.success?.[0]?.lr_number,
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
  return String(
    json?.error?.message
    || json?.message
    || json?.error
    || text
    || `Delhivery manifest failed (${status})`,
  );
}

function formatManifestError(message) {
  const raw = String(message || '').trim();
  if (/CoD is not allowed/i.test(raw)) {
    return (
      'Delhivery blocked this booking: goods CoD is not enabled for INTERWEIGHING B2B. '
      + 'We only send FOD/BTC freight (FoD/FoP) with prepaid goods. '
      + 'Ask Delhivery to enable FoP/FoD on the API client (d_mode), or enter the LR manually.'
    );
  }
  if (/not one of \['CoD'\]/i.test(raw)) {
    return (
      'Delhivery API schema for this account only lists d_mode=CoD, but we book FOD/BTC (FoD/FoP), not goods CoD. '
      + 'Ask Delhivery B2B support to allow FoP/FoD on manifest d_mode for INTERWEIGHING B2B, '
      + 'or enter the LR manually.'
    );
  }
  if (/SchemaValidationError/i.test(raw)) {
    const detail = raw.replace(/^.*SchemaValidationError<?/i, '').replace(/>$/, '').trim();
    return (
      `Delhivery rejected the booking payload (${detail || 'SchemaValidationError'}). `
      + 'Enter the LR manually if booking must proceed now.'
    );
  }
  return raw;
}

/**
 * Create a Delhivery B2B LR and wait for job completion when async.
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
  const created = await delhiveryB2bFetch(db, '/v2/manifest', {
    method: 'POST',
    body: payload,
  });

  if (!created.ok) {
    throw new Error(formatManifestError(
      extractErrorMessage(created.json, created.text, created.status),
    ));
  }

  let lrn = extractLrn(created.json);
  let jobId = extractJobId(created.json);
  if (lrn) {
    return {
      ok: true,
      lrn,
      jobId: jobId || null,
      env: config.env,
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

  const pollMs = Number(options.pollMs) > 0 ? Number(options.pollMs) : 1500;
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 20;
  let lastJson = created.json;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(pollMs);
    const polled = await delhiveryB2bFetch(db, '/v2/manifest', {
      method: 'GET',
      query: { job_id: jobId },
    });
    lastJson = polled.json;
    if (!polled.ok) {
      const message = extractErrorMessage(polled.json, polled.text, polled.status);
      if (/invalid job/i.test(message) && attempt < 3) continue;
      throw new Error(formatManifestError(message));
    }
    lrn = extractLrn(polled.json);
    if (lrn) {
      return {
        ok: true,
        lrn,
        jobId,
        env: config.env,
        raw: polled.json,
        payload,
      };
    }
    const statusText = String(
      polled.json?.status
      || polled.json?.data?.status
      || polled.json?.state
      || '',
    ).toLowerCase();
    if (statusText.includes('fail') || statusText.includes('error')) {
      throw new Error(formatManifestError(
        extractErrorMessage(polled.json, polled.text, polled.status),
      ));
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
