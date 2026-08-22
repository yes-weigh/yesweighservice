/**
 * Live vessel AIS for catalog / PO maps.
 * Identity: Shipxy / ShipFinder public search (searchv3.shipxy.com).
 * Dynamics: Shipxy GetSingleShip when SHIPXY_API_KEY is set; otherwise the
 * public vessel page used by the same AIS network (speed, dest, ETA, position).
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const SHIPXY_SEARCH_HOSTS = [
  'https://searchv3.shipxy.com',
  'https://searchv3.shipfinder.com',
];

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

function snapshot({
  name = '',
  imo = '',
  mmsi = '',
  lat = null,
  lon = null,
  sog = null,
  cog = null,
  dest = null,
  eta = null,
  updated = null,
  source = '',
}) {
  const imoId = /^\d{7}$/.test(String(imo)) ? String(imo) : '';
  const mmsiId = /^\d{9}$/.test(String(mmsi)) ? String(mmsi) : '';
  return {
    name: String(name || '').trim(),
    imo: imoId,
    mmsi: mmsiId,
    lat,
    lon,
    sog,
    cog,
    dest: dest ? String(dest).trim() : null,
    eta: eta ? String(eta).trim() : null,
    updated: updated ? String(updated).trim() : null,
    source,
    mapUrl: vesselFinderAisMapUrl({ imo: imoId, mmsi: mmsiId }),
  };
}

async function fetchText(url, accept = 'text/html,application/xhtml+xml') {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: accept,
  };
  if (/shipxy\.com|shipfinder\.com/i.test(url)) {
    headers.Referer = 'https://www.shipxy.com/';
  }
  const res = await fetch(url, {
    headers,
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Vessel lookup failed (${res.status}).`);
  }
  return res.text();
}

async function fetchJson(url) {
  const text = await fetchText(url, 'application/json, text/plain, */*');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Vessel lookup returned invalid JSON.');
  }
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

function pickShipxyShip(ships, parsed) {
  if (!Array.isArray(ships) || !ships.length) return null;
  const mmsi = String(parsed.mmsi || '');
  if (/^\d{9}$/.test(mmsi)) {
    const hit = ships.find(row => String(row?.m ?? '') === mmsi);
    if (hit) return hit;
  }
  const imo = String(parsed.imo || '');
  if (/^\d{7}$/.test(imo)) {
    const hits = ships.filter(row => String(row?.i ?? '') === imo);
    if (hits.length) return hits[0];
  }
  if (parsed.name) {
    let best = null;
    let bestScore = 0;
    for (const row of ships) {
      const score = scoreName(row?.n, parsed.name);
      if (score > bestScore) {
        best = row;
        bestScore = score;
      }
    }
    if (bestScore >= 60) return best;
  }
  return ships[0];
}

async function searchShipxy(keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) return null;
  let lastError = null;
  for (const host of SHIPXY_SEARCH_HOSTS) {
    try {
      const json = await fetchJson(
        `${host}/shipdata/search3.ashx?f=srch&kw=${encodeURIComponent(kw)}`,
      );
      if (json && Number(json.status) === 0) {
        return json;
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return null;
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Shipxy GetSingleShip stores lat/lon in 1e-6 deg and SOG in mm/s. */
function fromShipxySingleShip(row) {
  if (!row || typeof row !== 'object') return null;
  let lat = Number(row.lat);
  let lon = Number(row.lon);
  if (Number.isFinite(lat) && Math.abs(lat) > 90) lat /= 1e6;
  if (Number.isFinite(lon) && Math.abs(lon) > 180) lon /= 1e6;
  let sog = Number(row.sog);
  if (Number.isFinite(sog) && sog > 200) sog = (sog * 3600) / 1_852_000;
  let cog = Number(row.cog);
  if (Number.isFinite(cog) && cog > 360) cog /= 100;
  const dest = String(row.dest_std || row.dest || '').trim() || null;
  const eta = String(row.eta_std || row.eta || '').trim() || null;
  const last = Number(row.lasttime);
  const updated = Number.isFinite(last) && last > 0
    ? new Date(last * 1000).toISOString()
    : null;
  const hasFix = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
  const hasSpeed = Number.isFinite(sog);
  if (!hasFix && !hasSpeed) return null;
  return snapshot({
    name: row.name,
    imo: row.imo,
    mmsi: row.mmsi || row.ShipID,
    lat: hasFix ? lat : null,
    lon: hasFix ? lon : null,
    sog: hasSpeed ? sog : null,
    cog: Number.isFinite(cog) ? cog : null,
    dest,
    eta,
    updated,
    source: 'shipxy',
  });
}

async function fetchShipxySingleShip(mmsi) {
  const key = String(process.env.SHIPXY_API_KEY || '').trim();
  if (!key || !/^\d{9}$/.test(String(mmsi))) return null;
  const url =
    `https://api.shipxy.com/apicall/GetSingleShip?v=2&k=${encodeURIComponent(key)}`
    + `&enc=1&id=${encodeURIComponent(mmsi)}`;
  const json = await fetchJson(url);
  if (!json || Number(json.status) !== 0) return null;
  const row = Array.isArray(json.data) ? json.data[0] : json.data;
  return fromShipxySingleShip(row);
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
  const lat = finiteOrNull(parsed.ship_lat);
  const lon = finiteOrNull(parsed.ship_lon);
  let sog = finiteOrNull(parsed.ship_sog);
  if (sog == null) {
    sog = finiteOrNull(html.match(/speed of ([\d.]+)\s*knots/i)?.[1]);
  }
  const dest =
    String(html.match(/en route to the port of <strong>([^<]+)<\/strong>/i)?.[1] || '')
      .replace(/\s+/g, ' ')
      .trim()
    || String(parsed.dest || '').trim()
    || null;
  const eta =
    String(html.match(/\bETA:\s*([^<]+)/i)?.[1] || '')
      .replace(/\s+/g, ' ')
      .trim()
    || null;
  return snapshot({
    name,
    imo: /^\d{7}$/.test(imo) ? imo : '',
    mmsi: /^\d{9}$/.test(mmsi) ? mmsi : '',
    lat,
    lon,
    cog: finiteOrNull(parsed.ship_cog),
    sog,
    dest,
    eta,
    updated: String(parsed.lrpd || '').trim() || null,
    source: 'ais',
  });
}

async function fetchVesselDetails(imo) {
  const html = await fetchText(`https://www.vesselfinder.com/vessels/details/${encodeURIComponent(imo)}`);
  const details = parseDetails(html, imo);
  if (!details.imo && !details.mmsi) {
    throw new Error('Vessel position is not available.');
  }
  return details;
}

function mergeSnapshots(base, extra) {
  if (!extra) return base;
  if (!base) return extra;
  return snapshot({
    name: extra.name || base.name,
    imo: extra.imo || base.imo,
    mmsi: extra.mmsi || base.mmsi,
    lat: extra.lat ?? base.lat,
    lon: extra.lon ?? base.lon,
    sog: extra.sog ?? base.sog,
    cog: extra.cog ?? base.cog,
    dest: extra.dest || base.dest,
    eta: extra.eta || base.eta,
    updated: extra.updated || base.updated,
    source: extra.source || base.source,
  });
}

export async function lookupVesselAis(rawKeyword) {
  const parsed = parseVesselKeyword(rawKeyword);
  if (!parsed.imo && !parsed.mmsi && !parsed.name) {
    throw new Error('Enter a vessel name, IMO, or MMSI on the bill of lading.');
  }

  const searchKw = parsed.imo || parsed.mmsi || parsed.name;
  let shipxyRow = null;
  try {
    const search = await searchShipxy(searchKw);
    shipxyRow = pickShipxyShip(search?.ship, parsed);
  } catch (err) {
    console.warn('Shipxy search failed:', err?.message || err);
  }

  const imo = parsed.imo || String(shipxyRow?.i ?? '').replace(/\D/g, '');
  const mmsi = parsed.mmsi || String(shipxyRow?.m ?? '').replace(/\D/g, '');
  const name = String(shipxyRow?.n ?? parsed.name ?? '').trim();
  const identity = snapshot({ name, imo, mmsi, source: 'shipxy' });

  if (mmsi) {
    try {
      const live = await fetchShipxySingleShip(mmsi);
      if (live && (live.sog != null || live.lat != null)) {
        return mergeSnapshots(identity, live);
      }
    } catch (err) {
      console.warn('Shipxy GetSingleShip failed:', err?.message || err);
    }
  }

  if (/^\d{7}$/.test(imo)) {
    const details = await fetchVesselDetails(imo);
    return mergeSnapshots(identity, details);
  }

  if (parsed.name && !imo) {
    const searchHtml = await fetchText(
      `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(parsed.mmsi || parsed.name)}`,
    );
    const row = pickSearchRow(parseSearchRows(searchHtml), parsed.name);
    if (row?.imo) {
      const details = await fetchVesselDetails(row.imo);
      return mergeSnapshots(identity, details);
    }
  }

  if (identity.imo || identity.mmsi) return identity;
  throw new Error('Could not find that vessel on the live map.');
}
