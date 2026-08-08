/**
 * Fetch Trackon shipment status from the public track website.
 * Single AWB POST to /courier-tracking is ignored by their host; the working
 * path is the multi-track form (also used for one AWB):
 *   POST https://www.trackon.in/courier-tracking-Multi
 *   fields: awbMultiTrackingId, btnMulAwbTrack=Track
 */

const TRACK_PAGE = 'https://www.trackon.in/courier-tracking';
const TRACK_MULTI = 'https://www.trackon.in/courier-tracking-Multi';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function normalizeAwb(raw) {
  return String(raw ?? '').replace(/[^\dA-Za-z]/g, '').trim().toUpperCase();
}

/** Trackon form: min 7, max 12 (digits; some refs alphanumeric). */
function isValidAwb(awb) {
  return /^[A-Z0-9]{7,12}$/.test(awb);
}

function stripTags(html) {
  return String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Prefer the dedicated result container; fall back to whole document. */
function extractDivTrackStatus(html) {
  const start = /<div[^>]*\bid=["']divtrackStatus["'][^>]*>/i.exec(html);
  if (!start) return String(html ?? '');
  const from = start.index + start[0].length;
  // Balanced-ish close: stop at the sibling after page-table / alert block.
  const rest = html.slice(from);
  const endMarkers = [
    /<\/div>\s*<div class=["']text-right["']/i,
    /<\/div>\s*<div id=["']BModel["']/i,
    /<\/div>\s*<script/i,
  ];
  let end = rest.length;
  for (const re of endMarkers) {
    const m = re.exec(rest);
    if (m && m.index < end) end = m.index;
  }
  return rest.slice(0, end);
}

function cellTexts(rowHtml) {
  return [...String(rowHtml).matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map(m => stripTags(m[1]));
}

/**
 * Trackon multi-track success table:
 * Date | Transaction Number | Location | (icon) | Event
 */
function parseHistoryTable(block) {
  const history = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch = tableRe.exec(block);
  while (tableMatch) {
    const rows = [];
    const tRowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tRow = tRowRe.exec(tableMatch[1]);
    while (tRow) {
      const cells = cellTexts(tRow[1]);
      if (cells.some(Boolean)) rows.push(cells);
      tRow = tRowRe.exec(tableMatch[1]);
    }
    if (rows.length < 2) {
      tableMatch = tableRe.exec(block);
      continue;
    }
    const header = rows[0].map(c => c.toLowerCase());
    const isTrackonHistory = header.some(h => h.includes('date'))
      && header.some(h => h.includes('event') || h.includes('status') || h.includes('activity'))
      && header.some(h => h.includes('location') || h.includes('transaction'));
    if (!isTrackonHistory) {
      tableMatch = tableRe.exec(block);
      continue;
    }
    const dateIdx = header.findIndex(h => h.includes('date'));
    const locIdx = header.findIndex(h => h.includes('location'));
    const eventIdx = header.findIndex(h => (
      h.includes('event') || h.includes('status') || h.includes('activity')
    ));
    for (const cells of rows.slice(1)) {
      const at = dateIdx >= 0 ? (cells[dateIdx] || '') : (cells[0] || '');
      const location = locIdx >= 0 ? (cells[locIdx] || '') : '';
      let activity = eventIdx >= 0 ? (cells[eventIdx] || '') : '';
      if (!activity) activity = cells[cells.length - 1] || '';
      if (!at && !activity) continue;
      if (/^date$/i.test(at)) continue;
      history.push({
        at,
        location,
        activity: activity || 'Update',
      });
    }
    tableMatch = tableRe.exec(block);
  }
  return history;
}

/**
 * @param {string} html
 * @param {string} awb
 */
export function parseTrackonTrackHtml(html, awb = '') {
  const source = String(html ?? '').replace(/<!--[\s\S]*?-->/g, ' ');
  const block = extractDivTrackStatus(source);

  const notFound = /Consignment\s*No\s*:\s*([A-Z0-9]+)\s*\(\s*Not\s*Found\s*\)/i.exec(block);
  if (notFound) {
    const foundAwb = normalizeAwb(notFound[1] || awb);
    return {
      ok: false,
      error: foundAwb
        ? `Consignment No: ${foundAwb} (Not Found)`
        : 'Consignment not found on Trackon.',
      fields: {},
      history: [],
    };
  }

  const history = parseHistoryTable(block);
  const fields = {};

  const due = /DueDate\s*:\s*([^<\n]+)/i.exec(block);
  if (due) fields.dueDate = stripTags(due[1]);

  const consignmentMatch = /Consignment\s*No\s*:\s*([A-Z0-9]+)/i.exec(block);
  if (consignmentMatch) fields.consignmentNo = normalizeAwb(consignmentMatch[1]);

  if (history[0]?.activity) {
    fields.status = history[0].activity;
  }

  const deliveredRow = history.find(item => /\bdelivered\b/i.test(item.activity));
  if (deliveredRow?.at) fields.deliveredAt = deliveredRow.at;

  // Oldest event often reflects booking/origin hub.
  const oldest = history[history.length - 1];
  if (oldest?.at) fields.bookedAt = oldest.at;
  if (oldest?.location) fields.origin = oldest.location;
  if (deliveredRow?.location) fields.destination = deliveredRow.location;
  else if (history[0]?.location) fields.destination = history[0].location;

  if (!fields.status && !history.length) {
    return {
      ok: false,
      error: 'Tracking details not found on Trackon.',
      fields: {},
      history: [],
    };
  }

  return {
    ok: true,
    error: null,
    fields,
    history,
  };
}

/**
 * @param {string} awbRaw
 */
export async function fetchTrackonTrack(awbRaw) {
  const awb = normalizeAwb(awbRaw);
  const empty = (error) => ({
    awb,
    ok: false,
    error,
    status: null,
    origin: null,
    destination: null,
    consignmentType: null,
    bookedAt: null,
    deliveredAt: null,
    history: [],
    sourceUrl: TRACK_PAGE,
    fetchedAt: new Date().toISOString(),
  });

  if (!isValidAwb(awb)) {
    return empty('Trackon AWB must be 7–12 letters or digits.');
  }

  const form = new URLSearchParams();
  form.set('awbMultiTrackingId', awb);
  form.set('btnMulAwbTrack', 'Track');

  const res = await fetch(TRACK_MULTI, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://www.trackon.in',
      Referer: TRACK_PAGE,
    },
    body: form.toString(),
    redirect: 'follow',
  });
  const html = await res.text();
  if (!res.ok) {
    return empty(`Trackon tracking page returned HTTP ${res.status}.`);
  }

  const parsed = parseTrackonTrackHtml(html, awb);
  return {
    awb,
    ok: parsed.ok,
    error: parsed.error,
    status: parsed.fields.status || null,
    origin: parsed.fields.origin || null,
    destination: parsed.fields.destination || null,
    consignmentType: parsed.fields.consignmentType || null,
    bookedAt: parsed.fields.bookedAt || null,
    deliveredAt: parsed.fields.deliveredAt || null,
    history: parsed.history,
    sourceUrl: TRACK_PAGE,
    fetchedAt: new Date().toISOString(),
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal HTML result page for QR / external track links. */
export function renderTrackonTrackHtml(result) {
  const rows = [
    ['AWB', result.awb],
    ['Current status', result.status],
    ['Origin', result.origin],
    ['Destination', result.destination],
    ['Consignment', result.consignmentType],
    ['Booked', result.bookedAt],
    ['Delivered', result.deliveredAt],
  ].filter(([, v]) => v);

  const historyRows = (result.history || [])
    .map(item => (
      `<tr><td>${escapeHtml(item.at)}</td><td>${escapeHtml(item.location)}</td><td>${escapeHtml(item.activity)}</td></tr>`
    ))
    .join('');

  const body = result.ok
    ? `
      <h1>Trackon tracking</h1>
      <p class="ok">${escapeHtml(result.status || 'Found')}</p>
      <table>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
      ${historyRows ? `<h2>History</h2><table><thead><tr><th>When</th><th>Location</th><th>Activity</th></tr></thead><tbody>${historyRows}</tbody></table>` : ''}
    `
    : `
      <h1>Trackon tracking</h1>
      <p class="err">${escapeHtml(result.error || 'Not found')}</p>
      <p>AWB <strong>${escapeHtml(result.awb)}</strong></p>
    `;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Trackon · ${escapeHtml(result.awb || 'Track')}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.25rem; background: #0f172a; color: #e2e8f0; }
    h1 { font-size: 1.15rem; margin: 0 0 0.75rem; }
    h2 { font-size: 0.95rem; margin: 1.25rem 0 0.5rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.45rem 0.35rem; border-bottom: 1px solid #334155; vertical-align: top; }
    th { color: #94a3b8; font-weight: 600; width: 40%; }
    .ok { color: #4ade80; font-weight: 700; }
    .err { color: #f87171; font-weight: 700; }
    a { color: #38bdf8; }
    .actions { margin-top: 1.25rem; display: flex; flex-wrap: wrap; gap: 0.75rem; }
  </style>
</head>
<body>
  ${body}
  <div class="actions">
    <a href="${escapeHtml(result.sourceUrl)}" target="_blank" rel="noreferrer">Open Trackon website</a>
  </div>
  <p style="margin-top:1.5rem;font-size:0.75rem;color:#64748b">Fetched ${escapeHtml(result.fetchedAt)}</p>
</body>
</html>`;
}
