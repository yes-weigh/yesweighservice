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

const FIELD_MAP = {
  'current status': 'status',
  status: 'status',
  'shipment status': 'status',
  origin: 'origin',
  'origin city': 'origin',
  'from': 'origin',
  destination: 'destination',
  'destination city': 'destination',
  'to': 'destination',
  consignment: 'consignmentType',
  'consignment type': 'consignmentType',
  'service type': 'consignmentType',
  'book date': 'bookedAt',
  'booked on': 'bookedAt',
  'booking date': 'bookedAt',
  'booking datetime': 'bookedAt',
  'delivery date': 'deliveredAt',
  'delivered on': 'deliveredAt',
  'delivery datetime': 'deliveredAt',
};

function normalizeAwb(raw) {
  return String(raw ?? '').replace(/[^\dA-Za-z]/g, '').trim().toUpperCase();
}

/** Trackon form: min 7, max 12 (digits; some refs alphanumeric). */
function isValidAwb(awb) {
  return /^[A-Z0-9]{7,12}$/.test(awb);
}

function stripTags(html) {
  return String(html ?? '')
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

function extractDivTrackStatus(html) {
  const match = /<div[^>]*id=["']divtrackStatus["'][^>]*>([\s\S]*?)<\/div>\s*<div class=["']text-right["']/i
    .exec(html)
    || /<div[^>]*id=["']divtrackStatus["'][^>]*>([\s\S]*?)$/i.exec(html);
  return match?.[1] || '';
}

/**
 * @param {string} html
 * @param {string} awb
 */
export function parseTrackonTrackHtml(html, awb = '') {
  const source = String(html ?? '');
  const block = extractDivTrackStatus(source) || source;

  const notFound = /Consignment\s*No\s*:\s*([A-Z0-9]+)\s*\(\s*Not\s*Found\s*\)/i.exec(block)
    || /(?:AWB|Consignment)[^\n<]{0,40}\(\s*Not\s*Found\s*\)/i.exec(block);
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

  const fields = {};
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch = rowRe.exec(block);
  while (rowMatch) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => stripTags(m[1]));
    if (cells.length === 2) {
      const key = FIELD_MAP[cells[0].toLowerCase()];
      if (key && cells[1]) fields[key] = cells[1];
    }
    rowMatch = rowRe.exec(block);
  }

  // Label: value pairs outside tables
  const labelRe = /(?:^|\n)\s*([A-Za-z][A-Za-z /]{1,40}?)\s*[:\-]\s*([^\n]{2,120})/g;
  let labelMatch = labelRe.exec(stripTags(block).replace(/\s*\n\s*/g, '\n'));
  while (labelMatch) {
    const key = FIELD_MAP[labelMatch[1].trim().toLowerCase()];
    if (key && !fields[key]) fields[key] = labelMatch[2].trim();
    labelMatch = labelRe.exec(stripTags(block).replace(/\s*\n\s*/g, '\n'));
  }

  const history = [];
  const seen = new Set();
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch = tableRe.exec(block);
  while (tableMatch) {
    const rows = [];
    const tRowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tRow = tRowRe.exec(tableMatch[1]);
    while (tRow) {
      const cells = [...tRow[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(m => stripTags(m[1]));
      if (cells.some(Boolean)) rows.push(cells);
      tRow = tRowRe.exec(tableMatch[1]);
    }
    if (rows.length >= 2) {
      const header = rows[0].map(c => c.toLowerCase());
      const looksKeyValue = rows.every(r => r.length === 2)
        && rows.some(r => FIELD_MAP[String(r[0] || '').toLowerCase()]);
      if (looksKeyValue) {
        tableMatch = tableRe.exec(block);
        continue;
      }
      const looksHistory = (
        header.some(h => /^(date|time)$/.test(h) || h.includes('date') || h.includes('time'))
        && header.some(h => /status|activity|remark|scan|location|place/.test(h))
      ) || rows.slice(1).some(r => (
        r.length >= 3 && /\d{1,2}[\/\-.]\d{1,2}|\d{4}/.test(r[0] || '')
      ));
      if (looksHistory) {
        for (const cells of rows.slice(1)) {
          if (cells.length < 2) continue;
          if (/^date$/i.test(cells[0]) || /^s\.?no/i.test(cells[0])) continue;
          let at = '';
          let location = '';
          let activity = '';
          if (header.includes('date') || header.includes('time')) {
            const dateIdx = header.findIndex(h => h.includes('date'));
            const timeIdx = header.findIndex(h => h.includes('time'));
            const locIdx = header.findIndex(h => h.includes('location') || h.includes('place'));
            const actIdx = header.findIndex(h => (
              h.includes('status') || h.includes('activity') || h.includes('remark') || h.includes('scan')
            ));
            const date = dateIdx >= 0 ? cells[dateIdx] : '';
            const time = timeIdx >= 0 ? cells[timeIdx] : '';
            at = [date, time].filter(Boolean).join(' ').trim();
            location = locIdx >= 0 ? (cells[locIdx] || '') : '';
            activity = actIdx >= 0 ? (cells[actIdx] || '') : (cells[cells.length - 1] || '');
          } else if (cells.length >= 3) {
            at = cells[0];
            // Date + time split across first two cells
            if (/^\d{1,2}:\d{2}/.test(cells[1] || '') || /AM|PM/i.test(cells[1] || '')) {
              at = `${cells[0]} ${cells[1]}`.trim();
              location = cells[2] || '';
              activity = cells[3] || cells.slice(3).join(' · ') || cells[2] || '';
              if (cells.length === 3) {
                activity = cells[2];
                location = '';
              }
            } else {
              location = cells[1] || '';
              activity = cells[2] || cells.slice(2).join(' · ');
            }
          } else {
            at = cells[0];
            activity = cells[1] || '';
          }
          if (!activity && !at) continue;
          const key = `${at}|${activity}|${location}`;
          if (seen.has(key)) continue;
          seen.add(key);
          history.push({ at, location, activity: activity || 'Update' });
        }
      }
    }
    tableMatch = tableRe.exec(block);
  }

  // Fallback: alert-success / status badges
  if (!fields.status) {
    const statusBadge = /(?:Current\s*Status|Status)\s*[:\-]?\s*([^<\n]{2,80})/i.exec(block);
    if (statusBadge) fields.status = stripTags(statusBadge[1]);
  }
  if (!fields.status && history[0]?.activity) {
    fields.status = history[0].activity;
  }

  if (!fields.status && !history.length && !Object.keys(fields).length) {
    return {
      ok: false,
      error: 'Tracking details not found on Trackon.',
      fields: {},
      history: [],
    };
  }

  // Prefer newest-first timeline (Trackon multi often oldest-first).
  const newestFirst = [...history].reverse();

  return {
    ok: true,
    error: null,
    fields,
    history: newestFirst.length ? newestFirst : history,
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
