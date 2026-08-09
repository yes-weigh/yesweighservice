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
 * @param {string} lrn
 * @param {unknown} raw
 */
export function parseDelhiveryFreightChargeEntry(lrn, raw) {
  const fetchedAt = new Date().toISOString();
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      lrn,
      totalInr: null,
      chargedWeightKg: null,
      minChargedWeightKg: null,
      breakup: null,
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
  return {
    ok,
    lrn,
    totalInr,
    chargedWeightKg,
    minChargedWeightKg,
    breakup,
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
 * Firestore patch fields from a single LRN freight result.
 * @param {ReturnType<typeof parseDelhiveryFreightChargeEntry>} freight
 */
export function buildDelhiveryFreightPatch(freight) {
  /** @type {Record<string, unknown>} */
  const patch = {
    courierFreight: freight,
    freightFetchedAt: freight.fetchedAt,
  };
  if (freight.ok && freight.totalInr != null) {
    patch.actualFreightInr = freight.totalInr;
  }
  if (freight.ok && freight.chargedWeightKg != null) {
    patch.chargeableWeightKg = freight.chargedWeightKg;
  }
  return patch;
}
