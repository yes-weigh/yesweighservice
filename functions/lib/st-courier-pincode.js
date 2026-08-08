/**
 * Fetch ST Courier serviceable-area / delivery-office contact for a pincode.
 * Flow mirrors https://stcourier.com/pincode-search
 * (POST /helpdesk/check_area, then reload page and read first Communication cell).
 */

const PINCODE_PAGE = 'https://stcourier.com/pincode-search';
const CHECK_AREA = 'https://stcourier.com/helpdesk/check_area';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function normalizePincode(raw) {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 6);
}

function isValidPincode(pin) {
  return /^\d{6}$/.test(pin);
}

function stripTags(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
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
 * Parse first data row's Communication column from hubDespatch table.
 * @param {string} html
 * @returns {{ communication: string|null, serviceCenter: string|null, hubCenter: string|null }}
 */
export function parseStCourierPincodeTable(html) {
  const empty = { communication: null, serviceCenter: null, hubCenter: null };
  const tableMatch = /<table[^>]*id=["']hubDespatch["'][^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!tableMatch) return empty;

  const tableHtml = tableMatch[1];
  const headerCells = [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
    .map(m => stripTags(m[1]).toLowerCase());
  const communicationIndex = headerCells.findIndex(h => /communication/i.test(h));
  const hubIndex = headerCells.findIndex(h => /hub\s*center/i.test(h));
  const serviceIndex = headerCells.findIndex(h => /service\s*center/i.test(h));
  if (communicationIndex < 0) return empty;

  const bodyMatch = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(tableHtml);
  const bodyHtml = bodyMatch?.[1] || tableHtml;
  const firstRow = /<tr[^>]*>([\s\S]*?)<\/tr>/i.exec(bodyHtml);
  if (!firstRow) return empty;

  const cells = [...firstRow[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(m => stripTags(m[1]));
  if (!cells.length) return empty;

  const communication = cells[communicationIndex]?.trim() || null;
  if (!communication || /^[-–—]$/.test(communication)) {
    return empty;
  }

  return {
    communication,
    serviceCenter: serviceIndex >= 0 ? (cells[serviceIndex]?.trim() || null) : null,
    hubCenter: hubIndex >= 0 ? (cells[hubIndex]?.trim() || null) : null,
  };
}

/**
 * @param {string} pincodeRaw
 * @returns {Promise<{
 *   pincode: string,
 *   ok: boolean,
 *   error: string | null,
 *   communication: string | null,
 *   serviceCenter: string | null,
 *   hubCenter: string | null,
 *   sourceUrl: string,
 *   fetchedAt: string,
 * }>}
 */
export async function fetchStCourierDeliveryOffice(pincodeRaw) {
  const pincode = normalizePincode(pincodeRaw);
  const fetchedAt = new Date().toISOString();
  if (!isValidPincode(pincode)) {
    return {
      pincode,
      ok: false,
      error: 'Pincode must be a 6-digit number.',
      communication: null,
      serviceCenter: null,
      hubCenter: null,
      sourceUrl: PINCODE_PAGE,
      fetchedAt,
    };
  }

  const jar = new Map();
  const baseHeaders = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  const warm = await fetch(PINCODE_PAGE, { headers: baseHeaders, redirect: 'follow' });
  collectSetCookies(warm, jar);
  await warm.arrayBuffer();

  const form = new FormData();
  form.append('keyword', pincode);
  const checkRes = await fetch(CHECK_AREA, {
    method: 'POST',
    body: form,
    redirect: 'follow',
    headers: {
      ...baseHeaders,
      Accept: '*/*',
      Origin: 'https://stcourier.com',
      Referer: PINCODE_PAGE,
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
  if (checkJson && Number(checkJson.code) !== 200) {
    return {
      pincode,
      ok: false,
      error: String(checkJson.msg || 'Pincode not serviceable on ST Courier.'),
      communication: null,
      serviceCenter: null,
      hubCenter: null,
      sourceUrl: PINCODE_PAGE,
      fetchedAt,
    };
  }

  const resultRes = await fetch(PINCODE_PAGE, {
    headers: {
      ...baseHeaders,
      Referer: PINCODE_PAGE,
      Cookie: cookieHeader(jar),
    },
    redirect: 'follow',
  });
  const html = await resultRes.text();
  const parsed = parseStCourierPincodeTable(html);
  if (!parsed.communication) {
    return {
      pincode,
      ok: false,
      error: 'No delivery office found for this pincode.',
      communication: null,
      serviceCenter: null,
      hubCenter: null,
      sourceUrl: PINCODE_PAGE,
      fetchedAt,
    };
  }

  return {
    pincode,
    ok: true,
    error: null,
    communication: parsed.communication,
    serviceCenter: parsed.serviceCenter,
    hubCenter: parsed.hubCenter,
    sourceUrl: PINCODE_PAGE,
    fetchedAt,
  };
}
