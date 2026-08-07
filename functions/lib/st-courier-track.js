/**
 * Fetch ST Courier shipment status from the public track website.
 * Flow mirrors https://www.stcourier.com/track/shipment (POST /track/doCheck, then reload).
 */

const TRACK_PAGE = 'https://stcourier.com/track/shipment';
const DO_CHECK = 'https://stcourier.com/track/doCheck';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const FIELD_MAP = {
  'Current Status': 'status',
  'Orgin SRC': 'origin',
  'Origin SRC': 'origin',
  Destination: 'destination',
  Consignment: 'consignmentType',
  'Book Date/Time': 'bookedAt',
  'Delivery Date/Time': 'deliveredAt',
};

function normalizeAwb(raw) {
  return String(raw ?? '').replace(/\D/g, '').trim();
}

function isValidAwb(awb) {
  return /^\d{11}$/.test(awb);
}

function stripTags(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function linesFromHtml(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<i[\s\S]*?<\/i>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * ST Courier track page renders movement as a vertical timeline (div.tl07),
 * not a history table. Parse date/time anchors + following status/location.
 */
function parseTimelineHistory(source) {
  const history = [];
  const seen = new Set();
  const dateRe =
    /([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s*<br\s*\/?>\s*(\d{1,2}:\d{2}\s*[AP]M)/gi;
  let match = dateRe.exec(source);
  while (match) {
    const at = `${match[1]} ${match[2]}`.trim();
    const after = source.slice(
      match.index + match[0].length,
      match.index + match[0].length + 1600,
    );
    const textRe = /<div[^>]*>\s*([^<\s][^<]*?)<br\s*\/?>\s*([\s\S]*?)<\/div>/gi;
    let textMatch = textRe.exec(after);
    let activity = '';
    let location = '';
    while (textMatch) {
      const first = stripTags(textMatch[1]);
      if (
        first
        && !/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/.test(first)
        && !/^fa\b/i.test(first)
      ) {
        activity = first;
        location = linesFromHtml(textMatch[2]).join(' · ');
        break;
      }
      textMatch = textRe.exec(after);
    }
    if (activity) {
      const key = `${at}|${activity}|${location}`;
      if (!seen.has(key)) {
        seen.add(key);
        history.push({ at, location, activity });
      }
    }
    match = dateRe.exec(source);
  }
  return history;
}

/** Fallback when date-anchor parse misses — scrape known timeline item class. */
function parseTimelineHistoryByClass(source) {
  const history = [];
  const blockRe =
    /<div[^>]*class="[^"]*\btl07\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\btl07\b[^"]*"|$)/gi;
  let blockMatch = blockRe.exec(source);
  while (blockMatch) {
    const texts = [...blockMatch[1].matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)]
      .map(m => linesFromHtml(m[1]))
      .filter(lines => lines.length > 0);
    let at = '';
    let activity = '';
    let location = '';
    for (const lines of texts) {
      if (
        /^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(lines[0] || '')
        && /\d{1,2}:\d{2}\s*[AP]M/i.test(lines[1] || '')
      ) {
        at = `${lines[0]} ${lines[1]}`.trim();
        continue;
      }
      if (!activity && lines[0] && !/^fa\b/i.test(lines[0])) {
        activity = lines[0];
        location = lines.slice(1).join(' · ');
      }
    }
    if (at && activity) history.push({ at, location, activity });
    blockMatch = blockRe.exec(source);
  }
  return history;
}

function collectSetCookies(response, jar) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const list = typeof getSetCookie === 'function'
    ? getSetCookie()
    : [];
  const single = response.headers.get('set-cookie');
  const all = list.length ? list : (single ? [single] : []);
  for (const entry of all) {
    const pair = String(entry).split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * @param {string} html
 * @returns {{
 *   ok: boolean,
 *   error: string | null,
 *   fields: Record<string, string>,
 *   history: Array<{ at: string, location: string, activity: string }>,
 * }}
 */
export function parseStCourierTrackHtml(html) {
  const source = String(html ?? '');
  const errorMatch = /<h4[^>]*class="[^"]*text-danger[^"]*"[^>]*>([\s\S]*?)<\/h4>/i.exec(source)
    || /Sorry,\s*Invalid AWB Number[\s\S]*?!?\s*\(([^)]+)\)/i.exec(source);
  if (errorMatch) {
    const msg = stripTags(errorMatch[1] || errorMatch[0]);
    if (/invalid\s*awb/i.test(msg) || /sorry/i.test(msg)) {
      return { ok: false, error: msg || 'Invalid AWB number', fields: {}, history: [] };
    }
  }

  const fields = {};
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch = rowRe.exec(source);
  while (rowMatch) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => stripTags(m[1]));
    if (cells.length === 2) {
      const key = FIELD_MAP[cells[0]];
      if (key && cells[1]) fields[key] = cells[1];
    } else if (cells.length >= 3) {
      // Scan / history style rows — keep for later pass
    }
    rowMatch = rowRe.exec(source);
  }

  // Prefer vertical timeline (current ST site); fall back to history tables.
  let history = parseTimelineHistory(source);
  if (!history.length) history = parseTimelineHistoryByClass(source);
  if (!history.length) {
    const histBlock = /(?:Tracking\s*History|Shipment\s*Status|Movement)[\s\S]{0,200}<table[^>]*>([\s\S]*?)<\/table>/i.exec(source);
    const histHtml = histBlock?.[1] || '';
    if (histHtml) {
      const hRowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let hMatch = hRowRe.exec(histHtml);
      while (hMatch) {
        const cells = [...hMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
          .map(m => stripTags(m[1]));
        if (
          cells.length >= 3
          && cells[0]
          && !/date\/?time/i.test(cells[0])
          && !/location/i.test(cells[1] || '')
        ) {
          history.push({
            at: cells[0],
            location: cells[1] || '',
            activity: cells[2] || cells.slice(2).join(' · '),
          });
        }
        hMatch = hRowRe.exec(histHtml);
      }
    }
  }

  if (!fields.status && !Object.keys(fields).length) {
    return {
      ok: false,
      error: 'Tracking details not found on ST Courier.',
      fields: {},
      history: [],
    };
  }

  return { ok: true, error: null, fields, history };
}

/**
 * @param {string} awbRaw
 * @returns {Promise<{
 *   awb: string,
 *   ok: boolean,
 *   error: string | null,
 *   status: string | null,
 *   origin: string | null,
 *   destination: string | null,
 *   consignmentType: string | null,
 *   bookedAt: string | null,
 *   deliveredAt: string | null,
 *   history: Array<{ at: string, location: string, activity: string }>,
 *   sourceUrl: string,
 *   fetchedAt: string,
 * }>}
 */
export async function fetchStCourierTrack(awbRaw) {
  const awb = normalizeAwb(awbRaw);
  if (!isValidAwb(awb)) {
    return {
      awb,
      ok: false,
      error: 'ST Courier AWB must be an 11-digit number.',
      status: null,
      origin: null,
      destination: null,
      consignmentType: null,
      bookedAt: null,
      deliveredAt: null,
      history: [],
      sourceUrl: TRACK_PAGE,
      fetchedAt: new Date().toISOString(),
    };
  }

  const jar = new Map();
  const baseHeaders = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  const warm = await fetch(TRACK_PAGE, { headers: baseHeaders, redirect: 'follow' });
  collectSetCookies(warm, jar);
  await warm.arrayBuffer();

  const form = new FormData();
  form.append('awb_no', awb);
  const checkRes = await fetch(DO_CHECK, {
    method: 'POST',
    body: form,
    redirect: 'follow',
    headers: {
      ...baseHeaders,
      Accept: '*/*',
      Origin: 'https://stcourier.com',
      Referer: TRACK_PAGE,
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookieHeader(jar),
    },
  });
  collectSetCookies(checkRes, jar);
  const checkText = await checkRes.text();
  let checkJson = null;
  try {
    checkJson = JSON.parse(checkText);
  } catch {
    // continue — page scrape may still work
  }
  if (checkJson && Number(checkJson.code) !== 200 && checkJson.msg) {
    return {
      awb,
      ok: false,
      error: String(checkJson.msg),
      status: null,
      origin: null,
      destination: null,
      consignmentType: null,
      bookedAt: null,
      deliveredAt: null,
      history: [],
      sourceUrl: TRACK_PAGE,
      fetchedAt: new Date().toISOString(),
    };
  }

  const resultRes = await fetch(TRACK_PAGE, {
    headers: {
      ...baseHeaders,
      Referer: TRACK_PAGE,
      Cookie: cookieHeader(jar),
    },
    redirect: 'follow',
  });
  const html = await resultRes.text();
  const parsed = parseStCourierTrackHtml(html);

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
export function renderStCourierTrackHtml(result) {
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
      <h1>ST Courier tracking</h1>
      <p class="ok">${escapeHtml(result.status || 'Found')}</p>
      <table>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
      ${historyRows ? `<h2>History</h2><table><thead><tr><th>When</th><th>Location</th><th>Activity</th></tr></thead><tbody>${historyRows}</tbody></table>` : ''}
    `
    : `
      <h1>ST Courier tracking</h1>
      <p class="err">${escapeHtml(result.error || 'Not found')}</p>
      <p>AWB <strong>${escapeHtml(result.awb)}</strong></p>
    `;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ST Courier · ${escapeHtml(result.awb || 'Track')}</title>
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
    <a href="${escapeHtml(result.sourceUrl)}" target="_blank" rel="noreferrer">Open ST Courier website</a>
  </div>
  <p style="margin-top:1.5rem;font-size:0.75rem;color:#64748b">Fetched ${escapeHtml(result.fetchedAt)}</p>
</body>
</html>`;
}
