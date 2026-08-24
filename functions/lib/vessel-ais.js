/**
 * Live vessel AIS for catalog / PO maps.
 * Identity: Shipxy / ShipFinder public search (searchv3.shipfinder.com).
 * Dynamics: official GetSingleShip when SHIPFINDER_API_KEY / SHIPXY_API_KEY is set,
 * else the public ShipFinder vessel page (same numbers as shipfinder.com).
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
  if (/shipfinder\.com/i.test(url)) {
    headers.Referer = 'https://www.shipfinder.com/';
  } else if (/shipxy\.com/i.test(url)) {
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

function officialAisKeys() {
  return [...new Set(
    [process.env.SHIPFINDER_API_KEY, process.env.SHIPXY_API_KEY]
      .map(value => String(value || '').trim())
      .filter(Boolean),
  )];
}

function unixToIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function snapshotAgeMs(snap) {
  const iso = Date.parse(String(snap?.updated || ''));
  if (!Number.isFinite(iso)) return Number.POSITIVE_INFINITY;
  return Date.now() - iso;
}

function isPreciseFix(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  // VesselFinder's free HTML rounds to whole degrees — unusable for a live plot.
  const latWhole = Math.abs(lat - Math.round(lat)) < 1e-6;
  const lonWhole = Math.abs(lon - Math.round(lon)) < 1e-6;
  return !(latWhole && lonWhole);
}

function isLiveSnapshot(snap, maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!snap) return false;
  const updated = String(snap.updated || '');
  if (/hours?\s+ago|days?\s+ago/i.test(updated)) return false;
  if (!isPreciseFix(snap.lat, snap.lon) && snap.sog == null) return false;
  const age = snapshotAgeMs(snap);
  if (!Number.isFinite(age)) return isPreciseFix(snap.lat, snap.lon) || snap.sog != null;
  return age <= maxAgeMs;
}

function pickFreshest(snapshots) {
  const usable = snapshots.filter(Boolean);
  if (!usable.length) return null;
  return usable.slice().sort((a, b) => {
    const liveA = isLiveSnapshot(a) ? 1 : 0;
    const liveB = isLiveSnapshot(b) ? 1 : 0;
    if (liveA !== liveB) return liveB - liveA;
    const satA = String(a.source || '').includes('satellite') ? 1 : 0;
    const satB = String(b.source || '').includes('satellite') ? 1 : 0;
    if (satA !== satB) return satB - satA;
    return snapshotAgeMs(a) - snapshotAgeMs(b);
  })[0];
}

/** Official Shipxy / ShipFinder GetSingleShip: lat/lon in 1e-6 deg, SOG in mm/s. */
function fromOfficialSingleShip(row, source) {
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
  const from = Number(row.from ?? row.From);
  const satelliteTs = Number(row.satelliteutc || row.satellittime || row.obctime || 0);
  const last = Number(row.lasttime);
  const bestTs = [satelliteTs, last].filter(n => Number.isFinite(n) && n > 0).sort((a, b) => b - a)[0];
  const updated = unixToIso(bestTs);
  const hasFix = isPreciseFix(lat, lon);
  const hasSpeed = Number.isFinite(sog);
  if (!hasFix && !hasSpeed) return null;
  const satellite = from === 1 || (Number.isFinite(satelliteTs) && satelliteTs >= last);
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
    source: satellite ? `${source}-satellite` : source,
  });
}

async function fetchOfficialSingleShip(mmsi) {
  const id = String(mmsi || '').replace(/\D/g, '');
  const keys = officialAisKeys();
  if (!keys.length || !/^\d{9}$/.test(id)) return null;
  const urls = keys.flatMap(key => ([
    `https://api.shipfinder.com/apicall/GetSingleShip?v=2&k=${encodeURIComponent(key)}&enc=1&id=${encodeURIComponent(id)}&idtype=0`,
    `https://api.shipxy.com/apicall/GetSingleShip?v=2&k=${encodeURIComponent(key)}&enc=1&id=${encodeURIComponent(id)}`,
  ]));
  const snapshots = [];
  await Promise.all(urls.map(async url => {
    try {
      const json = await fetchJson(url);
      if (!json || Number(json.status) !== 0) return;
      const row = Array.isArray(json.data) ? json.data[0] : json.data;
      const source = /shipfinder\.com/i.test(url) ? 'shipfinder' : 'shipxy';
      snapshots.push(fromOfficialSingleShip(row, source));
    } catch (err) {
      console.warn('Official AIS lookup failed:', err?.message || err);
    }
  }));
  return pickFreshest(snapshots);
}

function htmlField(html, id) {
  const match = String(html || '').match(
    new RegExp(`<(label|div|span|td|strong)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`, 'i'),
  );
  return String(match?.[2] || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#176;|&deg;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ShipFinder page coords look like `5-57.758 N`. */
function parseShipfinderDm(value) {
  const match = String(value || '').trim().match(
    /^(\d{1,3})-(\d{1,2}(?:\.\d+)?)\s*([NSEW])$/i,
  );
  if (!match) return null;
  const deg = Number(match[1]) + Number(match[2]) / 60;
  if (!Number.isFinite(deg)) return null;
  const hemi = match[3].toUpperCase();
  return hemi === 'S' || hemi === 'W' ? -deg : deg;
}

function parseShipfinderEta(raw, reportedAt) {
  const text = String(raw || '').trim();
  if (!text || /^[-—]+$/.test(text)) return null;
  const md = text.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!md) return text;
  const reported = Date.parse(String(reportedAt || '').replace(' ', 'T'));
  const year = Number.isFinite(reported) ? new Date(reported).getUTCFullYear() : new Date().getUTCFullYear();
  const month = Number(md[1]);
  const day = Number(md[2]);
  let y = year;
  if (Number.isFinite(reported)) {
    const rm = new Date(reported).getUTCMonth() + 1;
    if (month < rm - 6) y = year + 1;
  }
  const hh = md[3] ? String(md[3]).padStart(2, '0') : '00';
  const mm = md[4] ? String(md[4]).padStart(2, '0') : '00';
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${hh}:${mm}`;
}

function fromShipfinderDetailHtml(html) {
  const name = htmlField(html, 'ais-name');
  const imo = htmlField(html, 'ais-imo').replace(/\D/g, '');
  const mmsi = htmlField(html, 'ais-mmsi').replace(/\D/g, '');
  const lat = parseShipfinderDm(htmlField(html, 'ais-_lat'));
  const lon = parseShipfinderDm(htmlField(html, 'ais-_lon'));
  const sog = finiteOrNull(htmlField(html, 'ais-_sog').replace(/[^\d.]/g, ''));
  const cog = finiteOrNull(htmlField(html, 'ais-course_f').replace(/[^\d.]/g, ''));
  const dest = htmlField(html, 'ais-dest') || null;
  const lastTime = htmlField(html, 'ais-lastTime') || null;
  const eta = parseShipfinderEta(htmlField(html, 'ais-_eta'), lastTime);
  const precise = isPreciseFix(lat, lon);
  if (!precise && sog == null && !dest) return null;
  const updated = lastTime
    ? (unixToIso(Date.parse(lastTime.replace(' ', 'T'))) || lastTime)
    : null;
  return snapshot({
    name,
    imo,
    mmsi,
    lat: precise ? lat : null,
    lon: precise ? lon : null,
    sog,
    cog,
    dest,
    eta,
    updated,
    source: 'shipfinder',
  });
}

async function fetchShipfinderDetail(mmsi) {
  const id = String(mmsi || '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(id)) return null;
  const html = await fetchText(`https://www.shipfinder.com/ship/detail/mmsi/${encodeURIComponent(id)}`);
  return fromShipfinderDetailHtml(html);
}

function collectMmsiCandidates(search, parsed) {
  const ids = [];
  const push = value => {
    const id = String(value || '').replace(/\D/g, '');
    if (/^\d{9}$/.test(id) && !ids.includes(id)) ids.push(id);
  };
  push(parsed.mmsi);
  for (const row of Array.isArray(search?.ship) ? search.ship : []) push(row?.m);
  return ids.slice(0, 4);
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
  const precise = isPreciseFix(lat, lon);
  return snapshot({
    name,
    imo: /^\d{7}$/.test(imo) ? imo : '',
    mmsi: /^\d{9}$/.test(mmsi) ? mmsi : '',
    lat: precise ? lat : null,
    lon: precise ? lon : null,
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
  let search = null;
  let shipxyRow = null;
  try {
    search = await searchShipxy(searchKw);
    shipxyRow = pickShipxyShip(search?.ship, parsed);
  } catch (err) {
    console.warn('Shipxy search failed:', err?.message || err);
  }

  const imo = parsed.imo || String(shipxyRow?.i ?? '').replace(/\D/g, '');
  const mmsi = parsed.mmsi || String(shipxyRow?.m ?? '').replace(/\D/g, '');
  const name = String(shipxyRow?.n ?? parsed.name ?? '').trim();
  const identity = snapshot({ name, imo, mmsi, source: 'shipxy' });

  const mmsis = collectMmsiCandidates(search, { ...parsed, mmsi, imo });
  if (mmsis.length) {
    const official = pickFreshest(await Promise.all(mmsis.map(id => fetchOfficialSingleShip(id))));
    const pages = [];
    for (const id of mmsis.slice(0, 2)) {
      try {
        pages.push(await fetchShipfinderDetail(id));
      } catch (err) {
        console.warn('ShipFinder detail failed:', err?.message || err);
      }
    }
    const live = pickFreshest([official, ...pages]);
    if (live && (isLiveSnapshot(live) || isPreciseFix(live.lat, live.lon))) {
      return mergeSnapshots(identity, live);
    }
  }

  if (/^\d{7}$/.test(imo)) {
    const details = await fetchVesselDetails(imo);
    if (isLiveSnapshot(details)) return mergeSnapshots(identity, details);
    return mergeSnapshots(identity, snapshot({
      name: details.name,
      imo: details.imo,
      mmsi: details.mmsi,
      dest: details.dest,
      eta: details.eta,
      source: details.source,
    }));
  }

  if (parsed.name && !imo) {
    const searchHtml = await fetchText(
      `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(parsed.mmsi || parsed.name)}`,
    );
    const row = pickSearchRow(parseSearchRows(searchHtml), parsed.name);
    if (row?.imo) {
      const details = await fetchVesselDetails(row.imo);
      if (isLiveSnapshot(details)) return mergeSnapshots(identity, details);
      return mergeSnapshots(identity, snapshot({
        name: details.name,
        imo: details.imo,
        mmsi: details.mmsi,
        dest: details.dest,
        eta: details.eta,
        source: details.source,
      }));
    }
  }

  if (identity.imo || identity.mmsi) return identity;
  throw new Error('Could not find that vessel on the live map.');
}
