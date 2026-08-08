/**
 * Delhivery B2B LR tracking via GET /v2/track/lr?lrn=
 */

import { delhiveryB2bFetch } from './delhivery-b2b.js';

const OFFICIAL_TRACK_URL = 'https://www.delhivery.com/track/package/';

/**
 * @param {unknown} raw
 */
export function normalizeDelhiveryLrn(raw) {
  return String(raw ?? '').replace(/[^\dA-Za-z]/g, '').trim().toUpperCase();
}

function asText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function pushHistory(history, item) {
  const at = asText(item.at || item.timestamp || item.date || item.status_date || item.ScanDateTime);
  const location = asText(item.location || item.city || item.ScannedLocation || item.place);
  const activity = asText(
    item.activity
    || item.status
    || item.Scan
    || item.instructions
    || item.Instructions
    || item.remark
    || item.message,
  );
  if (!at && !activity && !location) return;
  history.push({
    at: at || '',
    location: location || '',
    activity: activity || 'Update',
  });
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
  };

  if (!json || typeof json !== 'object') {
    return { ...empty, error: 'Empty track response' };
  }

  const root = /** @type {Record<string, unknown>} */ (json);
  const data = (root.data && typeof root.data === 'object')
    ? /** @type {Record<string, unknown>} */ (root.data)
    : root;
  const shipment = Array.isArray(data.shipments)
    ? data.shipments[0]
    : (data.shipment && typeof data.shipment === 'object'
      ? data.shipment
      : data);

  if (root.success === false || root.error) {
    return {
      ...empty,
      error: asText(root.error?.message || root.error || root.message) || 'Track failed',
    };
  }

  const message = asText(root.message);
  if (/invalid\s*lrn/i.test(message)) {
    return { ...empty, error: 'Invalid LRN' };
  }

  const status = asText(
    shipment?.status
    || shipment?.Status
    || shipment?.current_status
    || shipment?.shipment_status
    || data.status
    || data.Status,
  ) || null;

  const origin = asText(
    shipment?.origin
    || shipment?.Origin
    || shipment?.pickup_location
    || shipment?.origin_city,
  ) || null;
  const destination = asText(
    shipment?.destination
    || shipment?.Destination
    || shipment?.drop_location
    || shipment?.destination_city,
  ) || null;
  const bookedAt = asText(
    shipment?.booked_at
    || shipment?.pickup_date
    || shipment?.OrderDate
    || shipment?.manifested_at,
  ) || null;
  const deliveredAt = asText(
    shipment?.delivered_at
    || shipment?.DeliveryDate
    || shipment?.delivered_date,
  ) || null;

  /** @type {Array<{ at: string, location: string, activity: string }>} */
  const history = [];
  const scans = shipment?.scans
    || shipment?.ScanDetail
    || shipment?.tracking_history
    || shipment?.history
    || data.scans
    || data.history
    || [];
  if (Array.isArray(scans)) {
    for (const scan of scans) {
      if (scan && typeof scan === 'object') {
        pushHistory(history, scan.ScanDetail && typeof scan.ScanDetail === 'object'
          ? scan.ScanDetail
          : scan);
      }
    }
  }

  const ok = Boolean(status || history.length || deliveredAt);
  return {
    awb: lrn,
    ok,
    error: ok ? null : (message || 'No tracking data'),
    status,
    origin,
    destination,
    consignmentType: asText(shipment?.service_type || shipment?.d_mode || data.service_type) || null,
    bookedAt,
    deliveredAt,
    history,
    sourceUrl,
    fetchedAt,
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} rawLrn
 */
export async function fetchDelhiveryTrack(db, rawLrn) {
  const lrn = normalizeDelhiveryLrn(rawLrn);
  if (!lrn) {
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
    };
  }

  const res = await delhiveryB2bFetch(db, '/v2/track/lr', {
    method: 'GET',
    query: { lrn },
  });

  if (!res.ok) {
    const message = String(
      res.json?.error?.message
      || res.json?.message
      || res.text
      || `Track failed (${res.status})`,
    );
    return {
      awb: lrn,
      ok: false,
      error: message,
      status: null,
      origin: null,
      destination: null,
      consignmentType: null,
      bookedAt: null,
      deliveredAt: null,
      history: [],
      sourceUrl: `${OFFICIAL_TRACK_URL}${encodeURIComponent(lrn)}`,
      fetchedAt: new Date().toISOString(),
    };
  }

  return parseDelhiveryTrackJson(res.json, lrn);
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
<p><strong>Status</strong> ${escapeHtml(status)}</p>
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
