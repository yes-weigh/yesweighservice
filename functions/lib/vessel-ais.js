/**
 * Resolve a vessel name / IMO / MMSI to public AIS identifiers for a single-ship map.
 * Reads VesselFinder public vessel pages (same data shown on their website).
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function normalizeVesselName(raw) {
  return String(raw ?? '')
    .replace(/\b(?:IMO|MMSI)\s*:?\s*\d+\b/gi, ' ')
    .split('/')[0]
    .replace(/\bM\.?\s*V\.?\b/gi, ' ')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function parseVesselKeyword(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { keyword: '', name: '', imo: '', mmsi: '' };
  const mmsiMatch = text.match(/\b(?:MMSI\s*:?\s*)([0-9]{9})\b/i) || text.match(/\b([0-9]{9})\b/);
  const imoLabeled = text.match(/\bIMO\s*:?\s*([0-9]{7})\b/i);
  const imoBare = !mmsiMatch ? text.match(/\b([0-9]{7})\b/) : null;
  const name = normalizeVesselName(text);
  return {
    keyword: text,
    name,
    imo: imoLabeled?.[1] || imoBare?.[1] || '',
    mmsi: mmsiMatch?.[1] || '',
  };
}

function vesselFinderAisMapUrl({ imo, mmsi }) {
  const params = new URLSearchParams();
  params.set('zoom', '4');
  params.set('names', 'true');
  params.set('show_track', 'true');
  if (mmsi) params.set('mmsi', String(mmsi));
  if (imo) params.set('imo', String(imo));
  if (!imo && !mmsi) return '';
  return `https://www.vesselfinder.com/aismap?${params.toString()}`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Vessel lookup failed (${res.status}).`);
  }
  return res.text();
}

function parseSearchRows(html) {
  const rows = [];
  const re = /href="\/vessels\/details\/(\d+)"[\s\S]*?class="slna">([^<]+)/gi;
  let match = re.exec(html);
  while (match) {
    rows.push({
      imo: match[1],
      name: String(match[2] ?? '').replace(/\s+/g, ' ').trim(),
    });
    match = re.exec(html);
  }
  return rows;
}

function scoreName(candidate, query) {
  const a = normalizeVesselName(candidate);
  const b = normalizeVesselName(query);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(b) && b.length >= 5) return 80;
  if (b.startsWith(a) && a.length >= 5) return 70;
  if (a.includes(b) && b.length >= 8) return 60;
  return 0;
}

function pickSearchRow(rows, query) {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const score = scoreName(row.name, query);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return bestScore >= 60 ? best : null;
}

function parseDetails(html, fallbackImo) {
  const jsonMatch = html.match(/data-json='(\{[^']*\})'/i);
  let parsed = {};
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch {
      parsed = {};
    }
  }
  const imo =
    String(html.match(/var vu_imo=(\d+)/i)?.[1] || fallbackImo || '').trim()
    || '';
  const mmsi =
    String(parsed.mmsi || html.match(/var MMSI=(\d+)/i)?.[1] || '').trim();
  const title = String(html.match(/<title>([^<]+)<\/title>/i)?.[1] || '');
  const name = title.split(',')[0].trim() || '';
  const lat = Number(parsed.ship_lat);
  const lon = Number(parsed.ship_lon);
  return {
    name,
    imo: /^\d{7}$/.test(imo) ? imo : '',
    mmsi: /^\d{9}$/.test(mmsi) ? mmsi : '',
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    cog: Number.isFinite(Number(parsed.ship_cog)) ? Number(parsed.ship_cog) : null,
    sog: Number.isFinite(Number(parsed.ship_sog)) ? Number(parsed.ship_sog) : null,
    updated: String(parsed.lrpd || '').trim() || null,
  };
}

async function fetchVesselDetails(imo) {
  const html = await fetchText(`https://www.vesselfinder.com/vessels/details/${encodeURIComponent(imo)}`);
  const details = parseDetails(html, imo);
  if (!details.imo && !details.mmsi) {
    throw new Error('Vessel position is not available.');
  }
  return {
    ...details,
    mapUrl: vesselFinderAisMapUrl({ imo: details.imo, mmsi: details.mmsi }),
  };
}

export async function lookupVesselAis(rawKeyword) {
  const parsed = parseVesselKeyword(rawKeyword);
  if (!parsed.imo && !parsed.mmsi && !parsed.name) {
    throw new Error('Enter a vessel name, IMO, or MMSI on the bill of lading.');
  }

  if (parsed.imo) {
    return fetchVesselDetails(parsed.imo);
  }

  const query = parsed.mmsi || parsed.name;
  const searchHtml = await fetchText(
    `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(query)}`,
  );
  const row = pickSearchRow(parseSearchRows(searchHtml), parsed.name || query);
  if (!row?.imo) {
    throw new Error('Could not find that vessel on the live map.');
  }
  return fetchVesselDetails(row.imo);
}
