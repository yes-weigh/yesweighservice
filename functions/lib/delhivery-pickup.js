/**
 * Delhivery pickup request (first-mile).
 *
 * Works with B2B JWT against Express FM host:
 *   POST https://track.delhivery.com/fm/request/new/
 * Docs: https://one.delhivery.com/developer-portal/document/b2b/detail/pickup-request
 * Express reference: https://delhivery-express-api-doc.readme.io/reference/pickup-request-creation-api
 *
 * One open pickup per warehouse/day — if one already exists, treat as soft success
 * and return that pickup_id (pr_exist / error code 669).
 */

import { HttpsError } from 'firebase-functions/v2/https';
import {
  getValidDelhiveryJwt,
  loadDelhiveryB2bPublicConfig,
} from './delhivery-b2b.js';
import { resolveDelhiveryPickupLocationName } from './delhivery-b2b-manifest.js';

const PICKUP_URL_BY_ENV = {
  production: 'https://track.delhivery.com/fm/request/new/',
  staging: 'https://staging-express.delhivery.com/fm/request/new/',
};

/**
 * IST calendar date YYYY-MM-DD. Same-day cutoff 14:00 IST → tomorrow.
 * @param {Date} [now]
 */
export function delhiveryPickupDateIst(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find(p => p.type === type)?.value || '00';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const hour = Number(get('hour'));
  const base = new Date(Date.UTC(y, m - 1, d));
  if (hour >= 14) {
    base.setUTCDate(base.getUTCDate() + 1);
  }
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * @param {unknown} raw
 * @returns {number}
 */
function packageCountFromBoxes(raw) {
  if (!Array.isArray(raw) || !raw.length) return 1;
  let total = 0;
  for (const box of raw) {
    const q = Math.max(1, Math.floor(Number(box?.quantity ?? box?.box_count ?? 1) || 1));
    total += q;
  }
  return Math.max(1, total);
}

/**
 * @param {unknown} json
 * @param {string} text
 * @param {number} status
 */
function extractMessage(json, text, status) {
  return String(
    json?.data?.message
    || json?.error?.message
    || json?.message
    || json?.detail
    || text
    || `Pickup request failed (${status})`,
  ).trim();
}

/**
 * Create (or attach to existing) Delhivery pickup request for a warehouse.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{
 *   shipFromSite?: string,
 *   pickupLocationName?: string,
 *   expectedPackageCount?: number,
 *   boxes?: unknown[],
 *   pickupDate?: string,
 *   pickupTime?: string,
 * }} input
 */
export async function createDelhiveryPickupRequest(db, input = {}) {
  const config = await loadDelhiveryB2bPublicConfig(db);
  if (!config.passwordSet) {
    throw new HttpsError('failed-precondition', 'Delhivery B2B credentials are not configured.');
  }

  const site = String(input.shipFromSite || 'cochin').trim() || 'cochin';
  const pickupLocation = String(
    input.pickupLocationName
    || await resolveDelhiveryPickupLocationName(db, site)
    || '',
  ).trim();
  if (!pickupLocation) {
    throw new HttpsError(
      'failed-precondition',
      'Delhivery pickup location name is required (Logistics Settings → Delhivery).',
    );
  }

  const expectedPackageCount = Math.max(
    1,
    Math.floor(Number(input.expectedPackageCount) || 0)
      || packageCountFromBoxes(input.boxes),
  );
  const pickupDate = String(input.pickupDate || '').trim() || delhiveryPickupDateIst();
  const pickupTime = String(input.pickupTime || '').trim() || '16:00:00';
  const url = PICKUP_URL_BY_ENV[config.env] || PICKUP_URL_BY_ENV.production;
  const body = {
    pickup_time: pickupTime,
    pickup_date: pickupDate,
    pickup_location: pickupLocation,
    expected_package_count: expectedPackageCount,
  };

  const auth = await getValidDelhiveryJwt(db);
  async function send(jwt) {
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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

  const pickupIdRaw = json?.pickup_id ?? json?.data?.pickup_id ?? json?.pickupId;
  const pickupId = pickupIdRaw != null && String(pickupIdRaw).trim()
    ? String(pickupIdRaw).trim()
    : null;
  const message = extractMessage(json, text, res.status);
  const alreadyExists = Boolean(
    json?.pr_exist === true
    || json?.error?.code === 669
    || /already exist/i.test(message),
  );

  if (alreadyExists && pickupId) {
    return {
      ok: true,
      alreadyExisted: true,
      pickupId,
      pickupLocationName: pickupLocation,
      pickupDate,
      pickupTime,
      expectedPackageCount,
      message,
      env: config.env,
      raw: json,
    };
  }

  if (!res.ok || (json?.error && !pickupId)) {
    throw new HttpsError('failed-precondition', message || 'Pickup request failed.');
  }

  if (!pickupId) {
    throw new HttpsError(
      'internal',
      `Delhivery accepted pickup request but returned no pickup_id. ${message}`,
    );
  }

  return {
    ok: true,
    alreadyExisted: false,
    pickupId,
    pickupLocationName: json?.pickup_location_name || pickupLocation,
    pickupDate: json?.pickup_date || pickupDate,
    pickupTime: json?.pickup_time || pickupTime,
    expectedPackageCount: Number(json?.expected_package_count) || expectedPackageCount,
    message: message || 'Pickup request created.',
    env: config.env,
    raw: json,
  };
}
