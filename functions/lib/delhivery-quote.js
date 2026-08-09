/**
 * Delhivery B2B pre-book quote helpers (LTL clients API).
 *
 * Docs:
 *   GET  /pincode-service/{pincode}?weight=
 *     https://one.delhivery.com/developer-portal/document/b2b/detail/pincode_serviceability
 *   GET  /tat/estimate?origin_pin=&destination_pin=
 *     https://one.delhivery.com/developer-portal/document/b2b/detail/tat
 *   POST /freight/estimate
 *     https://one.delhivery.com/developer-portal/document/b2b/detail/freight_estimation
 *   GET  /lrn/freight-breakup?lrns=
 *     https://one.delhivery.com/developer-portal/document/b2b/detail/freight_charges
 */

import { delhiveryB2bFetch, loadDelhiveryB2bPublicConfig } from './delhivery-b2b.js';
import {
  delhiveryFreightModeForApi,
  delhiveryLtlBaseUrl,
  extractIndianPincode,
  fetchDelhiveryFreightCharges,
  fetchDelhiveryFreightEstimate,
  normalizeDelhiveryFreightBillingMode,
} from './delhivery-freight.js';

/**
 * @param {unknown} raw
 */
function asNumber(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ pincode: string, weightG?: number | null }} input
 */
export async function checkDelhiveryPincodeServiceability(db, input) {
  const pincode = String(input.pincode || '').replace(/\D/g, '');
  if (pincode.length !== 6) {
    return {
      ok: false,
      serviceable: false,
      failOnDemand: false,
      error: 'A 6-digit pincode is required.',
      pincode: '',
      center: null,
      city: null,
      state: null,
      oda: null,
      paymentTypes: [],
    };
  }

  const config = await loadDelhiveryB2bPublicConfig(db);
  const base = delhiveryLtlBaseUrl(config.env);
  const weightG = Math.max(1, Math.round(Number(input.weightG) || 1000));
  const url = `${base}/pincode-service/${encodeURIComponent(pincode)}?weight=${encodeURIComponent(String(weightG))}`;
  const res = await delhiveryB2bFetch(db, url, { method: 'GET' });
  const root = res.json && typeof res.json === 'object'
    ? /** @type {Record<string, unknown>} */ (res.json)
    : {};

  if (!res.ok || root.success === false) {
    const errObj = root.error && typeof root.error === 'object'
      ? /** @type {Record<string, unknown>} */ (root.error)
      : null;
    return {
      ok: false,
      serviceable: false,
      failOnDemand: false,
      error: String(errObj?.message || root.message || res.text || `Serviceability failed (${res.status})`),
      pincode,
      center: null,
      city: null,
      state: null,
      oda: null,
      paymentTypes: [],
    };
  }

  const data = root.data && typeof root.data === 'object'
    ? /** @type {Record<string, unknown>} */ (root.data)
    : {};
  const rows = Array.isArray(data.pincode_serviceability_data)
    ? data.pincode_serviceability_data
    : [];
  const failList = Array.isArray(data.b2b_fail_on_demand_pincodes)
    ? data.b2b_fail_on_demand_pincodes.map((v) => String(v).replace(/\D/g, ''))
    : [];
  const row = rows.find((item) => {
    if (!item || typeof item !== 'object') return false;
    return String(/** @type {Record<string, unknown>} */ (item).pincode || '').replace(/\D/g, '') === pincode;
  }) || rows[0] || null;
  const info = row && typeof row === 'object'
    ? /** @type {Record<string, unknown>} */ (row)
    : null;
  const paymentRaw = String(info?.payment_type || '');
  /** @type {string[]} */
  let paymentTypes = [];
  try {
    const parsed = JSON.parse(paymentRaw);
    if (Array.isArray(parsed)) paymentTypes = parsed.map((v) => String(v));
  } catch {
    paymentTypes = paymentRaw
      ? paymentRaw.replace(/[[\]"]/g, '').split(',').map((v) => v.trim()).filter(Boolean)
      : [];
  }

  const serviceable = Boolean(info);
  const failOnDemand = failList.includes(pincode);

  return {
    ok: true,
    serviceable,
    failOnDemand,
    error: serviceable ? null : 'Pincode is not serviceable (NSZ).',
    pincode,
    center: info?.center != null ? String(info.center) : null,
    city: info?.city != null ? String(info.city) : null,
    state: info?.state != null ? String(info.state) : null,
    oda: typeof info?.oda === 'boolean' ? info.oda : null,
    paymentTypes,
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ originPin: string, destinationPin: string }} input
 */
export async function fetchDelhiveryTat(db, input) {
  const originPin = String(input.originPin || '').replace(/\D/g, '');
  const destinationPin = String(input.destinationPin || '').replace(/\D/g, '');
  if (originPin.length !== 6 || destinationPin.length !== 6) {
    return {
      ok: false,
      tatDays: null,
      error: 'Origin and destination 6-digit pincodes are required.',
      originPin,
      destinationPin,
    };
  }

  const config = await loadDelhiveryB2bPublicConfig(db);
  const base = delhiveryLtlBaseUrl(config.env);
  const url = `${base}/tat/estimate?origin_pin=${encodeURIComponent(originPin)}`
    + `&destination_pin=${encodeURIComponent(destinationPin)}`;
  const res = await delhiveryB2bFetch(db, url, { method: 'GET' });
  const root = res.json && typeof res.json === 'object'
    ? /** @type {Record<string, unknown>} */ (res.json)
    : {};

  if (!res.ok || root.success === false) {
    const errObj = root.error && typeof root.error === 'object'
      ? /** @type {Record<string, unknown>} */ (root.error)
      : null;
    return {
      ok: false,
      tatDays: null,
      error: String(errObj?.message || root.message || res.text || `TAT failed (${res.status})`),
      originPin,
      destinationPin,
    };
  }

  const data = root.data && typeof root.data === 'object'
    ? /** @type {Record<string, unknown>} */ (root.data)
    : {};
  const tatDays = asNumber(data.tat ?? data.tat_days ?? root.tat);

  return {
    ok: tatDays != null,
    tatDays,
    error: tatDays != null ? null : 'TAT missing in response.',
    originPin,
    destinationPin,
  };
}

/**
 * Combined pre-book quote: serviceability + TAT + freight estimate.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{
 *   originPin?: string | null,
 *   destinationPin: string,
 *   weightG?: number | null,
 *   invAmount?: number | null,
 *   dimensions?: Array<{ box_count?: number, length_cm?: number, width_cm?: number, height_cm?: number }>,
 *   freightBillingMode?: 'fod' | 'btc' | string | null,
 *   includeEstimate?: boolean,
 * }} input
 */
export async function quoteDelhiveryLane(db, input) {
  const destinationPin = extractIndianPincode(input.destinationPin)
    || String(input.destinationPin || '').replace(/\D/g, '');
  const originPin = extractIndianPincode(input.originPin)
    || String(input.originPin || '').replace(/\D/g, '');
  const weightG = Math.max(1, Math.round(Number(input.weightG) || 1000));
  const includeEstimate = input.includeEstimate !== false;

  const serviceability = await checkDelhiveryPincodeServiceability(db, {
    pincode: destinationPin,
    weightG,
  });

  const tat = originPin.length === 6 && destinationPin.length === 6
    ? await fetchDelhiveryTat(db, { originPin, destinationPin })
    : {
      ok: false,
      tatDays: null,
      error: originPin.length === 6 ? null : 'Origin pincode needed for TAT.',
      originPin,
      destinationPin,
    };

  const freightMode = delhiveryFreightModeForApi(
    normalizeDelhiveryFreightBillingMode(input.freightBillingMode) || 'btc',
  );

  const estimate = includeEstimate && originPin.length === 6 && destinationPin.length === 6
    ? await fetchDelhiveryFreightEstimate(db, {
      sourcePin: originPin,
      consigneePin: destinationPin,
      weightG,
      invAmount: input.invAmount,
      dimensions: input.dimensions,
      freightMode,
    })
    : {
      ok: false,
      error: includeEstimate ? 'Origin and destination pins required for estimate.' : null,
      total: null,
      preTax: null,
      toPay: null,
      chargedWt: null,
    };

  return {
    ok: serviceability.ok || tat.ok || estimate.ok,
    originPin: originPin || null,
    destinationPin: destinationPin || null,
    weightG,
    freightBillingMode: normalizeDelhiveryFreightBillingMode(input.freightBillingMode) || 'btc',
    serviceability,
    tat,
    estimate: {
      ok: Boolean(estimate.ok),
      error: estimate.error || null,
      totalInr: estimate.total,
      preTaxInr: estimate.preTax,
      toPayInr: estimate.toPay,
      // charged_wt from /freight/estimate is already in kg for LTL.
      chargedWeightKg: estimate.chargedWt != null ? Number(estimate.chargedWt) : null,
    },
  };
}

export { fetchDelhiveryFreightCharges };
