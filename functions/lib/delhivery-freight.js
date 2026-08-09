/**
 * Delhivery B2B freight charges (actual billed breakup after weight capture).
 *
 * Docs: GET /lrn/freight-breakup?lrns=LRN1,LRN2 (max 25)
 * Host: https://ltl-clients-api.delhivery.com
 * Auth: Bearer JWT from ums/login
 *
 * @see https://one.delhivery.com/developer-portal/document/b2b/detail/freight_charges
 */

import { delhiveryB2bFetch, loadDelhiveryB2bPublicConfig, normalizeDelhiveryB2bEnv } from './delhivery-b2b.js';
import { normalizeDelhiveryLrn, uniqueDelhiveryTrackIds } from './delhivery-track.js';

export const DELHIVERY_LTL_BASE_URLS = Object.freeze({
  staging: 'https://ltl-clients-api-dev.delhivery.com',
  production: 'https://ltl-clients-api.delhivery.com',
});

/**
 * @param {'staging' | 'production' | string} env
 */
export function delhiveryLtlBaseUrl(env) {
  return DELHIVERY_LTL_BASE_URLS[normalizeDelhiveryB2bEnv(env)];
}

/**
 * @param {unknown} track
 */
export function trackHasWeightCaptured(track) {
  if (!track || typeof track !== 'object') return false;
  const bits = [
    String(/** @type {Record<string, unknown>} */ (track).status || ''),
    ...(Array.isArray(/** @type {Record<string, unknown>} */ (track).history)
      ? /** @type {Array<{ activity?: string }>} */ (
        /** @type {Record<string, unknown>} */ (track).history
      ).map(item => String(item?.activity || ''))
      : []),
  ].join(' ').toLowerCase();
  return /\bweight\s*captured\b/.test(bits);
}

/**
 * @param {unknown} raw
 */
function asNumber(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} rawBreakup
 */
function normalizeBreakup(rawBreakup) {
  if (!rawBreakup || typeof rawBreakup !== 'object') return null;
  const b = /** @type {Record<string, unknown>} */ (rawBreakup);
  const oda = b.oda && typeof b.oda === 'object'
    ? /** @type {Record<string, unknown>} */ (b.oda)
    : {};
  return {
    baseFreightCharge: asNumber(b.base_freight_charge),
    fuelSurcharge: asNumber(b.fuel_surcharge),
    fuelHike: asNumber(b.fuel_hike),
    insuranceRov: asNumber(b.insurance_rov),
    odaFm: asNumber(oda.fm),
    odaLm: asNumber(oda.lm),
    fm: asNumber(b.fm),
    lm: asNumber(b.lm),
    green: asNumber(b.green),
    preTaxFreight: asNumber(b.pre_tax_freight ?? b.pre_tax_freight_charges),
    gst: asNumber(b.gst),
    gstPercent: asNumber(b.gst_percent),
    markup: asNumber(b.markup),
    otherHandlingCharges: asNumber(b.other_handling_charges),
  };
}

/**
 * Normalize Delhivery freight billing: FOD (consignee pays) vs BTC (bill to client).
 * Delhivery API uses freight_mode `fod` | `fop` (FOP ≈ BTC / bill-to-client).
 * Accepts freight_mode / billing_mode / bill_to / shipment_type style strings.
 *
 * @param {...unknown} values
 * @returns {'fod' | 'btc' | null}
 */
export function normalizeDelhiveryFreightBillingMode(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (!text) continue;
    if (/\bfod\b|freight\s*on\s*delivery|bill\s*to\s*consignee|collect\s*freight/.test(text)) {
      return 'fod';
    }
    // FOP / BTC / bill-to-client = shipper billed
    if (/\bbtc\b|\bfop\b|bill\s*to\s*client|freight\s*on\s*prepaid|bill\s*to\s*shipper/.test(text)) {
      return 'btc';
    }
  }
  return null;
}

/**
 * Map app billing mode → Delhivery freight_mode for manifest / estimate.
 * B2B accounts often reject explicit `fop`; omit freight_mode for BTC instead.
 *
 * @param {'fod' | 'btc' | string | null | undefined} mode
 * @returns {'fod' | null}
 */
export function delhiveryFreightModeForApi(mode) {
  return normalizeDelhiveryFreightBillingMode(mode) === 'fod' ? 'fod' : null;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function extractIndianPincode(raw) {
  const match = String(raw ?? '').match(/\b(\d{6})\b/);
  return match?.[1] || '';
}

/**
 * Pick closer estimate when one clearly matches actual freight.
 * BTC shipments match default /freight/estimate totals exactly on this account;
 * FOD estimates include a to_pay surcharge and diverge when mode is FOD at booking.
 *
 * @param {{
 *   actualTotal: number | null | undefined,
 *   btcTotal: number | null | undefined,
 *   fodTotal: number | null | undefined,
 * }} input
 * @returns {'fod' | 'btc' | null}
 */
export function inferFreightBillingModeFromEstimateTotals(input) {
  const actual = asNumber(input.actualTotal);
  const btc = asNumber(input.btcTotal);
  const fod = asNumber(input.fodTotal);
  if (actual == null || btc == null || fod == null) return null;

  const abs = (n) => Math.abs(n);
  const dBtc = abs(actual - btc);
  const dFod = abs(actual - fod);
  const matchTol = Math.max(5, actual * 0.005);
  const btcMatch = dBtc <= matchTol;
  const fodMatch = dFod <= matchTol;
  if (btcMatch && !fodMatch) return 'btc';
  if (fodMatch && !btcMatch) return 'fod';
  if (btcMatch && fodMatch) {
    return dBtc <= dFod ? 'btc' : 'fod';
  }
  // Clear relative winner even if absolute match is soft (rate drift).
  const margin = Math.max(50, actual * 0.03);
  if (dFod + margin < dBtc) return 'fod';
  if (dBtc + margin < dFod) return 'btc';
  return null;
}

/**
 * POST /freight/estimate — used to recognise FOD vs BTC when LR APIs omit freight_mode.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{
 *   sourcePin: string,
 *   consigneePin: string,
 *   invAmount?: number,
 *   weightG: number,
 *   dimensions?: Array<{ box_count?: number, length_cm?: number, width_cm?: number, height_cm?: number }>,
 *   freightMode?: 'fod' | 'fop' | null,
 * }} input
 */
export async function fetchDelhiveryFreightEstimate(db, input) {
  const sourcePin = String(input.sourcePin || '').replace(/\D/g, '');
  const consigneePin = String(input.consigneePin || '').replace(/\D/g, '');
  const weightG = Math.max(1, Math.round(Number(input.weightG) || 0));
  if (sourcePin.length !== 6 || consigneePin.length !== 6 || !weightG) {
    return {
      ok: false,
      error: 'source pin, consignee pin, and weight are required',
      total: null,
      preTax: null,
      toPay: null,
      chargedWt: null,
    };
  }
  const config = await loadDelhiveryB2bPublicConfig(db);
  const base = delhiveryLtlBaseUrl(config.env);
  const body = {
    source_pin: sourcePin,
    consignee_pin: consigneePin,
    inv_amount: Math.max(1, Number(input.invAmount) || 1000),
    weight_g: weightG,
    dimensions: Array.isArray(input.dimensions) && input.dimensions.length
      ? input.dimensions
      : [{ box_count: 1, length_cm: 30, width_cm: 30, height_cm: 30 }],
    payment_mode: 'prepaid',
    ...(input.freightMode ? { freight_mode: input.freightMode } : {}),
  };
  const res = await delhiveryB2bFetch(db, `${base}/freight/estimate`, {
    method: 'POST',
    body,
  });
  const root = res.json && typeof res.json === 'object'
    ? /** @type {Record<string, unknown>} */ (res.json)
    : {};
  if (!res.ok || root.success === false) {
    const errObj = root.error && typeof root.error === 'object'
      ? /** @type {Record<string, unknown>} */ (root.error)
      : null;
    return {
      ok: false,
      error: String(errObj?.message || root.message || res.text || `Estimate failed (${res.status})`),
      total: null,
      preTax: null,
      toPay: null,
      chargedWt: null,
    };
  }
  const data = root.data && typeof root.data === 'object'
    ? /** @type {Record<string, unknown>} */ (root.data)
    : {};
  const breakup = data.price_breakup && typeof data.price_breakup === 'object'
    ? /** @type {Record<string, unknown>} */ (data.price_breakup)
    : {};
  const meta = breakup.meta_charges && typeof breakup.meta_charges === 'object'
    ? /** @type {Record<string, unknown>} */ (breakup.meta_charges)
    : {};
  return {
    ok: true,
    error: null,
    total: asNumber(data.total),
    preTax: asNumber(breakup.pre_tax_freight_charges ?? breakup.pre_tax_freight),
    toPay: asNumber(meta.to_pay),
    chargedWt: asNumber(data.charged_wt),
  };
}

/**
 * Infer FOD/BTC for a logistics booking by comparing freight-breakup actuals
 * to /freight/estimate (default = BTC, freight_mode=fod = FOD).
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {Record<string, unknown>} booking
 * @param {number | null | undefined} actualTotalInr
 * @returns {Promise<{ mode: 'fod' | 'btc' | null, btcTotal: number | null, fodTotal: number | null, error: string | null }>}
 */
export async function inferDelhiveryFreightBillingMode(db, booking, actualTotalInr) {
  const sourcePin = extractIndianPincode(booking.shipFromAddress);
  const destPin = extractIndianPincode(booking.deliveryAddress)
    || extractIndianPincode(/** @type {Record<string, unknown>} */ (booking.dealerSnapshot || {}).shippingAddress);
  const chargedKg = asNumber(
    booking.courierFreight && typeof booking.courierFreight === 'object'
      ? /** @type {Record<string, unknown>} */ (booking.courierFreight).chargedWeightKg
      : null,
  ) || asNumber(booking.chargeableWeightKg) || asNumber(booking.actualWeightKg);
  if (!sourcePin || !destPin || chargedKg == null || chargedKg <= 0) {
    return {
      mode: null,
      btcTotal: null,
      fodTotal: null,
      error: 'Need ship-from pin, delivery pin, and charged weight to infer FOD/BTC',
    };
  }
  const boxes = Array.isArray(booking.boxes) ? booking.boxes : [];
  const dimensions = boxes.length
    ? boxes.map((box) => {
      const b = /** @type {Record<string, unknown>} */ (box || {});
      return {
        box_count: Math.max(1, Math.round(Number(b.quantity) || 1)),
        length_cm: Math.max(1, Number(b.lengthCm) || 30),
        width_cm: Math.max(1, Number(b.widthCm) || 30),
        height_cm: Math.max(1, Number(b.heightCm) || 30),
      };
    })
    : [{
      box_count: Math.max(1, Math.round(Number(booking.numberOfBoxes) || 1)),
      length_cm: 30,
      width_cm: 30,
      height_cm: 30,
    }];
  const weightG = Math.max(1000, Math.round(chargedKg * 1000));
  const invAmount = asNumber(booking.invoiceValueInr)
    || asNumber(booking.invoiceAmount)
    || 1000;
  const [btcEst, fodEst] = await Promise.all([
    fetchDelhiveryFreightEstimate(db, {
      sourcePin,
      consigneePin: destPin,
      invAmount,
      weightG,
      dimensions,
      freightMode: null,
    }),
    fetchDelhiveryFreightEstimate(db, {
      sourcePin,
      consigneePin: destPin,
      invAmount,
      weightG,
      dimensions,
      freightMode: 'fod',
    }),
  ]);
  if (!btcEst.ok || !fodEst.ok) {
    return {
      mode: null,
      btcTotal: btcEst.total,
      fodTotal: fodEst.total,
      error: btcEst.error || fodEst.error || 'Estimate failed',
    };
  }
  return {
    mode: inferFreightBillingModeFromEstimateTotals({
      actualTotal: actualTotalInr,
      btcTotal: btcEst.total,
      fodTotal: fodEst.total,
    }),
    btcTotal: btcEst.total,
    fodTotal: fodEst.total,
    error: null,
  };
}

/**
 * @param {string} lrn
 * @param {unknown} raw
 * @param {{ previousBillingMode?: 'fod' | 'btc' | null }} [options]
 */
export function parseDelhiveryFreightChargeEntry(lrn, raw, options = {}) {
  const fetchedAt = new Date().toISOString();
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      lrn,
      totalInr: null,
      chargedWeightKg: null,
      minChargedWeightKg: null,
      breakup: null,
      billingMode: options.previousBillingMode || null,
      error: 'No freight data',
      fetchedAt,
      source: 'delhivery_freight_breakup',
    };
  }
  const data = /** @type {Record<string, unknown>} */ (raw);
  const totalInr = asNumber(data.total);
  const chargedWeightKg = asNumber(data.charged_wt);
  const minChargedWeightKg = asNumber(data.min_charged_wt);
  const breakup = normalizeBreakup(data.fwd_price_breakup || data.price_breakup);
  const ok = totalInr != null;
  const billingMode = normalizeDelhiveryFreightBillingMode(
    data.freight_mode,
    data.freightMode,
    data.billing_mode,
    data.billingMode,
    data.bill_to,
    data.billTo,
    data.shipment_type,
    data.shipmentType,
    data.payment_mode,
    data.paymentMode,
  ) || options.previousBillingMode || null;
  return {
    ok,
    lrn,
    totalInr,
    chargedWeightKg,
    minChargedWeightKg,
    breakup,
    billingMode,
    error: ok ? null : 'Freight total missing',
    fetchedAt,
    source: 'delhivery_freight_breakup',
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string | string[]} lrns
 * @returns {Promise<{
 *   ok: boolean,
 *   error: string | null,
 *   byLrn: Record<string, ReturnType<typeof parseDelhiveryFreightChargeEntry>>,
 *   fetchedAt: string,
 * }>}
 */
export async function fetchDelhiveryFreightCharges(db, lrns) {
  const ids = uniqueDelhiveryTrackIds(lrns).slice(0, 25);
  const fetchedAt = new Date().toISOString();
  if (!ids.length) {
    return { ok: false, error: 'LRN is required', byLrn: {}, fetchedAt };
  }

  const config = await loadDelhiveryB2bPublicConfig(db);
  const base = delhiveryLtlBaseUrl(config.env);
  const url = `${base}/lrn/freight-breakup?lrns=${encodeURIComponent(ids.join(','))}`;
  const res = await delhiveryB2bFetch(db, url, { method: 'GET' });

  if (!res.ok) {
    const message = String(
      res.json?.error?.message
      || res.json?.message
      || res.text
      || `Freight charges failed (${res.status})`,
    );
    return { ok: false, error: message, byLrn: {}, fetchedAt };
  }

  const root = res.json && typeof res.json === 'object'
    ? /** @type {Record<string, unknown>} */ (res.json)
    : {};
  if (root.success === false) {
    const errObj = root.error && typeof root.error === 'object'
      ? /** @type {Record<string, unknown>} */ (root.error)
      : null;
    return {
      ok: false,
      error: String(errObj?.message || root.error || root.message || 'Freight charges failed'),
      byLrn: {},
      fetchedAt,
    };
  }

  const data = root.data && typeof root.data === 'object'
    ? /** @type {Record<string, unknown>} */ (root.data)
    : {};

  /** @type {Record<string, ReturnType<typeof parseDelhiveryFreightChargeEntry>>} */
  const byLrn = {};
  for (const id of ids) {
    const entry = data[id] ?? data[normalizeDelhiveryLrn(id)];
    byLrn[id] = parseDelhiveryFreightChargeEntry(id, entry);
  }

  const anyOk = Object.values(byLrn).some(item => item.ok);
  return {
    ok: anyOk,
    error: anyOk ? null : 'No freight data for requested LRNs',
    byLrn,
    fetchedAt,
  };
}

/**
 * Freight amount used in-app (excl. GST).
 * @param {ReturnType<typeof parseDelhiveryFreightChargeEntry>} freight
 */
export function delhiveryFreightExclGstInr(freight) {
  const round2 = (n) => Math.round(n * 100) / 100;
  const preTax = freight?.breakup?.preTaxFreight;
  if (typeof preTax === 'number' && Number.isFinite(preTax)) return round2(preTax);
  if (
    typeof freight?.totalInr === 'number'
    && Number.isFinite(freight.totalInr)
    && typeof freight?.breakup?.gst === 'number'
    && Number.isFinite(freight.breakup.gst)
  ) {
    return round2(freight.totalInr - freight.breakup.gst);
  }
  return typeof freight?.totalInr === 'number' && Number.isFinite(freight.totalInr)
    ? round2(freight.totalInr)
    : null;
}

/**
 * Firestore patch fields from a single LRN freight result.
 * @param {ReturnType<typeof parseDelhiveryFreightChargeEntry>} freight
 * @param {{
 *   previousBillingMode?: 'fod' | 'btc' | null,
 *   billingModeSource?: 'booking' | 'api' | 'inferred' | 'manual' | null,
 * }} [options]
 */
export function buildDelhiveryFreightPatch(freight, options = {}) {
  const billingMode = freight.billingMode
    || options.previousBillingMode
    || null;
  const courierFreight = {
    ...freight,
    billingMode,
  };
  /** @type {Record<string, unknown>} */
  const patch = {
    courierFreight,
    freightFetchedAt: freight.fetchedAt,
  };
  if (billingMode) {
    patch.freightBillingMode = billingMode;
    if (options.billingModeSource) {
      patch.freightBillingModeSource = options.billingModeSource;
    }
  }
  const exclGst = delhiveryFreightExclGstInr(courierFreight);
  if (courierFreight.ok && exclGst != null) {
    // Persist excl. GST for freight compare / ops views.
    patch.actualFreightInr = exclGst;
  }
  if (courierFreight.ok && courierFreight.chargedWeightKg != null) {
    patch.chargeableWeightKg = courierFreight.chargedWeightKg;
  }
  return patch;
}
