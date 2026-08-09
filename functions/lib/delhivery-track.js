/**
 * Delhivery tracking:
 * 1) B2B GET /v2/track/lr?lrn= (JWT)
 * 2) Fallback Express GET track.delhivery.com/api/v1/packages/json/?waybill= (same JWT)
 *
 * Delhivery One shows LRN + Master AWB (MWB). B2B track/lr often returns Invalid LRN
 * for live Surface LRs; Express packages/json tracks the Master AWB reliably.
 */

import { delhiveryB2bFetch, getValidDelhiveryJwt } from './delhivery-b2b.js';

const OFFICIAL_TRACK_URL = 'https://www.delhivery.com/track/package/';
const EXPRESS_PACKAGES_URL = 'https://track.delhivery.com/api/v1/packages/json/';

/**
 * @param {unknown} raw
 */
export function normalizeDelhiveryLrn(raw) {
  return String(raw ?? '').replace(/[^\dA-Za-z]/g, '').trim().toUpperCase();
}

/** Classic Delhivery B2B Lorry Receipt Number (9 digits). */
export function isDelhiveryB2bLrn(raw) {
  return /^\d{9}$/.test(normalizeDelhiveryLrn(raw));
}

/** Master AWB / waybill (longer than LRN; commonly 14 digits starting 2056). */
export function isDelhiveryMasterAwb(raw) {
  const id = normalizeDelhiveryLrn(raw);
  if (!id || isDelhiveryB2bLrn(id)) return false;
  return /^\d{12,}$/.test(id);
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    // Nested Delhivery Status blocks: { Status, StatusType, Instructions, ... }
    const obj = /** @type {Record<string, unknown>} */ (value);
    const nested = obj.Status ?? obj.status ?? obj.Instructions ?? obj.instructions
      ?? obj.message ?? obj.Remark ?? obj.remark;
    if (nested != null && typeof nested !== 'object') return String(nested).trim();
    return '';
  }
  return String(value).trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function statusObject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return /** @type {Record<string, unknown>} */ (raw);
}

/**
 * @param {Array<{ at: string, location: string, activity: string }>} history
 * @param {Record<string, unknown>} item
 */
function pushHistory(history, item) {
  const nested = statusObject(item.Status) || statusObject(item.status) || item;
  const at = firstText(
    nested.StatusDateTime,
    nested.status_date_time,
    nested.statusDateTime,
    item.at,
    item.timestamp,
    item.date,
    item.status_date,
    item.ScanDateTime,
    item.scan_datetime,
    item.ScanDate,
    item.updated_at,
  );
  const location = firstText(
    nested.StatusLocation,
    nested.status_location,
    nested.statusLocation,
    item.location,
    item.city,
    item.ScannedLocation,
    item.scanned_location,
    item.place,
    item.center,
    item.hub,
  );
  const activity = firstText(
    nested.Instructions,
    nested.instructions,
    nested.Status,
    nested.status,
    item.activity,
    item.status,
    item.Scan,
    item.scan,
    item.remark,
    item.message,
    item.nsl,
    item.NSLCode,
  );
  if (!at && !activity && !location) return;
  history.push({
    at: at || '',
    location: location || '',
    activity: activity || 'Update',
  });
}

/**
 * Collect scan/history arrays from common B2B / Express shapes.
 * Prefer the first non-empty array found (avoids double-counting when
 * data === shipment).
 * @param {Record<string, unknown>} root
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} shipment
 */
function collectScanArrays(root, data, shipment) {
  const candidates = [
    shipment.Scans,
    shipment.scans,
    shipment.ScanDetail,
    shipment.scan_details,
    shipment.tracking_history,
    shipment.trackingHistory,
    shipment.history,
    shipment.events,
    shipment.status_history,
    data.Scans,
    data.scans,
    data.ScanDetail,
    data.tracking_history,
    data.history,
    data.events,
    root.scans,
    root.history,
  ];
  /** @type {unknown[][]} */
  const seen = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || !candidate.length) continue;
    if (seen.includes(candidate)) continue;
    seen.push(candidate);
  }
  if (!seen.length) return [];
  // Use the richest history list (most events).
  let best = seen[0];
  for (const list of seen) {
    if (list.length > best.length) best = list;
  }
  return best;
}

/**
 * Normalize heterogeneous Delhivery track JSON into the shared courierTrack shape.
 *
 * @param {unknown} json
 * @param {string} lrn
 */
export function parseDelhiveryTrackJson(json, lrn) {
  const fetchedAt = new Date().toISOString();
  const sourceUrl = `${OFFICIAL_TRACK_URL}${encodeURIComponent(lrn)}`;
  const empty = {
    awb: lrn,
    ok: false,
    error: 'No tracking data',
    status: null,
    origin: null,
    destination: null,
    consignmentType: null,
    bookedAt: null,
    deliveredAt: null,
    history: [],
    sourceUrl,
    fetchedAt,
    /** @type {string | null} */
    statusType: null,
  };

  if (!json || typeof json !== 'object') {
    return { ...empty, error: 'Empty track response' };
  }

  const root = /** @type {Record<string, unknown>} */ (json);
  const data = (root.data && typeof root.data === 'object')
    ? /** @type {Record<string, unknown>} */ (root.data)
    : root;

  let shipment = data;
  if (Array.isArray(data.ShipmentData) && data.ShipmentData[0] && typeof data.ShipmentData[0] === 'object') {
    const row = /** @type {Record<string, unknown>} */ (data.ShipmentData[0]);
    shipment = (row.Shipment && typeof row.Shipment === 'object')
      ? /** @type {Record<string, unknown>} */ (row.Shipment)
      : row;
  } else if (Array.isArray(data.shipments) && data.shipments[0] && typeof data.shipments[0] === 'object') {
    shipment = /** @type {Record<string, unknown>} */ (data.shipments[0]);
  } else if (data.shipment && typeof data.shipment === 'object') {
    shipment = /** @type {Record<string, unknown>} */ (data.shipment);
  } else if (data.Shipment && typeof data.Shipment === 'object') {
    shipment = /** @type {Record<string, unknown>} */ (data.Shipment);
  } else if (Array.isArray(data.lr_list) && data.lr_list[0] && typeof data.lr_list[0] === 'object') {
    shipment = /** @type {Record<string, unknown>} */ (data.lr_list[0]);
  } else if (data.lr && typeof data.lr === 'object') {
    shipment = /** @type {Record<string, unknown>} */ (data.lr);
  }

  const errMessage = firstText(
    root.error && typeof root.error === 'object'
      ? /** @type {Record<string, unknown>} */ (root.error).message
      : root.error,
    root.Error,
    root.message,
    data.message,
    data.error,
    data.Error,
  );
  if (
    root.Success === false
    || root.success === false
    || /invalid\s*lrn/i.test(errMessage)
    || /does not exists for provided waybill/i.test(errMessage)
  ) {
    return {
      ...empty,
      error: errMessage || 'Track failed',
    };
  }

  const statusBlock = statusObject(shipment.Status)
    || statusObject(shipment.status)
    || statusObject(data.Status)
    || statusObject(data.status);

  const statusType = firstText(
    statusBlock?.StatusType,
    statusBlock?.status_type,
    statusBlock?.statusType,
    shipment.status_type,
    shipment.StatusType,
    shipment.statusType,
    data.status_type,
    data.StatusType,
  ).toUpperCase() || null;

  const status = firstText(
    statusBlock?.Status,
    statusBlock?.status,
    statusBlock?.Instructions,
    shipment.current_status,
    shipment.shipment_status,
    shipment.lr_status,
    shipment.Status,
    shipment.status,
    data.current_status,
    data.shipment_status,
    data.status,
    data.Status,
  ) || null;

  const origin = firstText(
    shipment.origin,
    shipment.Origin,
    shipment.pickup_location,
    shipment.origin_city,
    shipment.origin_center,
    shipment.from_city,
    data.origin,
    data.Origin,
  ) || null;

  const destination = firstText(
    shipment.destination,
    shipment.Destination,
    shipment.drop_location,
    shipment.destination_city,
    shipment.destination_center,
    shipment.to_city,
    data.destination,
    data.Destination,
  ) || null;

  const bookedAt = firstText(
    shipment.booked_at,
    shipment.pickup_date,
    shipment.PickUpDate,
    shipment.OrderDate,
    shipment.manifested_at,
    shipment.created_at,
    data.booked_at,
    data.pickup_date,
  ) || null;

  const deliveredAt = firstText(
    shipment.delivered_at,
    shipment.DeliveryDate,
    shipment.delivered_date,
    shipment.delivery_date,
    statusType === 'DL' ? (statusBlock?.StatusDateTime || statusBlock?.status_date_time) : '',
    data.delivered_at,
    data.DeliveryDate,
  ) || null;

  /** @type {Array<{ at: string, location: string, activity: string }>} */
  const history = [];
  for (const scan of collectScanArrays(root, data, shipment)) {
    if (!scan || typeof scan !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (scan);
    pushHistory(
      history,
      row.ScanDetail && typeof row.ScanDetail === 'object'
        ? /** @type {Record<string, unknown>} */ (row.ScanDetail)
        : row,
    );
  }

  // Newest-first if timestamps look sortable; keep API order otherwise.
  if (history.length > 1) {
    const dated = history.every(item => item.at && !Number.isNaN(Date.parse(item.at)));
    if (dated) {
      history.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    }
  }

  // Seed current status into history when scans are missing.
  if (!history.length && (status || statusBlock)) {
    pushHistory(history, {
      ...(statusBlock || {}),
      Status: status,
      StatusType: statusType,
      StatusLocation: firstText(statusBlock?.StatusLocation, destination, origin),
      StatusDateTime: firstText(statusBlock?.StatusDateTime, deliveredAt, bookedAt, fetchedAt),
    });
  }

  // When API omits booked_at, use the oldest scan (not latest status / fetchedAt).
  let resolvedBookedAt = bookedAt;
  if (!resolvedBookedAt && history.length) {
    let earliest = null;
    let earliestMs = Infinity;
    for (const item of history) {
      const at = item?.at ? String(item.at).trim() : '';
      if (!at) continue;
      const ms = Date.parse(at);
      if (!Number.isNaN(ms) && ms < earliestMs) {
        earliestMs = ms;
        earliest = at;
      }
    }
    resolvedBookedAt = earliest;
  }

  const ok = Boolean(status || statusType || history.length || deliveredAt);
  return {
    awb: firstText(shipment.lrn, shipment.LRN, shipment.awb, shipment.AWB, data.lrn, lrn) || lrn,
    ok,
    error: ok ? null : (errMessage || 'No tracking data'),
    status,
    origin,
    destination,
    consignmentType: firstText(
      shipment.service_type,
      shipment.d_mode,
      shipment.freight_mode,
      data.service_type,
    ) || null,
    bookedAt: resolvedBookedAt,
    deliveredAt,
    history,
    sourceUrl,
    fetchedAt,
    statusType,
  };
}

/**
 * @param {unknown[]} values
 * @returns {string[]}
 */
export function uniqueDelhiveryTrackIds(...values) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const inner of value) {
        const id = normalizeDelhiveryLrn(inner);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      continue;
    }
    const id = normalizeDelhiveryLrn(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  // Prefer 9-digit LRN first (freight + display), then Master AWB for Express track.
  return out.sort((a, b) => {
    const aRank = isDelhiveryB2bLrn(a) ? 0 : isDelhiveryMasterAwb(a) ? 1 : 2;
    const bRank = isDelhiveryB2bLrn(b) ? 0 : isDelhiveryMasterAwb(b) ? 1 : 2;
    return aRank - bRank;
  });
}

/**
 * Express packages/json track (Master AWB / waybill). Uses B2B JWT as Bearer.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} waybill
 * @param {string} [displayId]
 */
export async function fetchDelhiveryExpressTrack(db, waybill, displayId) {
  const id = normalizeDelhiveryLrn(waybill);
  const label = normalizeDelhiveryLrn(displayId) || id;
  if (!id) {
    return parseDelhiveryTrackJson(null, label);
  }

  const auth = await getValidDelhiveryJwt(db);
  const url = `${EXPRESS_PACKAGES_URL}?waybill=${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${auth.jwt}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    return {
      awb: label,
      ok: false,
      error: String(json?.Error || json?.message || text || `Track failed (${res.status})`),
      status: null,
      origin: null,
      destination: null,
      consignmentType: null,
      bookedAt: null,
      deliveredAt: null,
      history: [],
      sourceUrl: `${OFFICIAL_TRACK_URL}${encodeURIComponent(id)}`,
      fetchedAt: new Date().toISOString(),
      statusType: null,
      masterAwb: id,
    };
  }

  const parsed = parseDelhiveryTrackJson(json, label);
  const masterAwb = firstText(parsed.awb, id) || id;
  return {
    ...parsed,
    // Keep LRN (displayId) as primary awb when provided; stash Master AWB separately.
    awb: label || masterAwb,
    masterAwb,
    sourceUrl: `${OFFICIAL_TRACK_URL}${encodeURIComponent(masterAwb)}`,
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} rawLrn
 * @param {{ alternateIds?: unknown[] }} [options]
 */
export async function fetchDelhiveryTrack(db, rawLrn, options = {}) {
  const ids = uniqueDelhiveryTrackIds(rawLrn, options.alternateIds);
  if (!ids.length) {
    return {
      awb: '',
      ok: false,
      error: 'LRN is required',
      status: null,
      origin: null,
      destination: null,
      consignmentType: null,
      bookedAt: null,
      deliveredAt: null,
      history: [],
      sourceUrl: OFFICIAL_TRACK_URL,
      fetchedAt: new Date().toISOString(),
      statusType: null,
      masterAwb: null,
    };
  }

  const lrn = ids.find(id => isDelhiveryB2bLrn(id)) || null;
  const primary = lrn || ids[0];
  /** @type {string | null} */
  let lastError = null;

  // 1) B2B LR track for each candidate (usually the 9-digit LRN).
  for (const id of ids) {
    const res = await delhiveryB2bFetch(db, '/v2/track/lr', {
      method: 'GET',
      query: { lrn: id },
    });
    if (res.ok) {
      const parsed = parseDelhiveryTrackJson(res.json, primary);
      if (parsed.ok) {
        return {
          ...parsed,
          awb: primary,
          masterAwb: ids.find(candidate => isDelhiveryMasterAwb(candidate))
            || ids.find(candidate => candidate !== primary)
            || null,
        };
      }
      lastError = parsed.error;
      continue;
    }
    lastError = String(
      res.json?.error?.message
      || res.json?.message
      || res.text
      || `Track failed (${res.status})`,
    );
  }

  // 2) Express packages/json — Master AWB works; LRN usually does not.
  const expressIds = [...ids].sort((a, b) => (
    Number(isDelhiveryB2bLrn(a)) - Number(isDelhiveryB2bLrn(b))
  ));
  for (const id of expressIds) {
    const parsed = await fetchDelhiveryExpressTrack(db, id, primary);
    if (parsed.ok) {
      return {
        ...parsed,
        awb: primary,
        masterAwb: isDelhiveryMasterAwb(id)
          ? id
          : (parsed.masterAwb || ids.find(candidate => isDelhiveryMasterAwb(candidate)) || id),
      };
    }
    lastError = parsed.error || lastError;
  }

  return {
    awb: primary,
    ok: false,
    error: lastError || 'No tracking data',
    status: null,
    origin: null,
    destination: null,
    consignmentType: null,
    bookedAt: null,
    deliveredAt: null,
    history: [],
    sourceUrl: `${OFFICIAL_TRACK_URL}${encodeURIComponent(primary)}`,
    fetchedAt: new Date().toISOString(),
    statusType: null,
    masterAwb: ids.find(candidate => isDelhiveryMasterAwb(candidate))
      || ids.find(candidate => candidate !== primary)
      || null,
  };
}

/**
 * Minimal HTML page for public hosting rewrite (optional).
 * @param {Awaited<ReturnType<typeof fetchDelhiveryTrack>>} track
 */
export function renderDelhiveryTrackHtml(track) {
  const title = track.ok ? `Delhivery ${track.awb}` : 'Delhivery track';
  const status = track.status || track.error || 'Unknown';
  const rows = (track.history || []).map(item => (
    `<tr><td>${escapeHtml(item.at)}</td><td>${escapeHtml(item.location)}</td><td>${escapeHtml(item.activity)}</td></tr>`
  )).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;color:#111}
table{border-collapse:collapse;width:100%;margin-top:16px}
td,th{border:1px solid #ddd;padding:8px;text-align:left;font-size:14px}
.muted{color:#666}
</style></head><body>
<h1>Delhivery tracking</h1>
<p><strong>LRN</strong> ${escapeHtml(track.awb || '—')}</p>
<p><strong>Status</strong> ${escapeHtml(status)}${track.statusType ? ` (${escapeHtml(track.statusType)})` : ''}</p>
${track.origin ? `<p class="muted">Origin: ${escapeHtml(track.origin)}</p>` : ''}
${track.destination ? `<p class="muted">Destination: ${escapeHtml(track.destination)}</p>` : ''}
${rows ? `<table><thead><tr><th>When</th><th>Location</th><th>Activity</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No scan history.</p>'}
<p class="muted"><a href="${escapeHtml(track.sourceUrl || OFFICIAL_TRACK_URL)}">Official Delhivery page</a></p>
</body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
