/**
 * Fetch + parse Blue Dart published Air Fuel Surcharge (FS) and CAF tables.
 * Sources:
 *   https://www.bluedart.com/fuel-surcharge
 *   https://www.bluedart.com/currency-adjustment-factor
 */
import { HttpsError } from 'firebase-functions/v2/https';

export const BLUE_DART_FUEL_SURCHARGE_URL = 'https://www.bluedart.com/fuel-surcharge';
export const BLUE_DART_CAF_URL = 'https://www.bluedart.com/currency-adjustment-factor';

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function parseEffectiveDate(raw) {
  const text = String(raw ?? '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  // e.g. "01 August, 2026" or "01 August 2026"
  const match = /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (!month || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  return {
    day,
    month,
    year,
    iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    label: text,
  };
}

function parsePercent(raw) {
  const text = String(raw ?? '').replace(/&nbsp;/gi, ' ').trim();
  const match = /([\d.]+)\s*%?/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 200) return null;
  return value;
}

function stripTags(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTbody(html, headerPattern, label) {
  const source = String(html ?? '');
  const tableMatch = new RegExp(
    `${headerPattern}[\\s\\S]{0,200}?<tbody[^>]*>([\\s\\S]*?)<\\/tbody>`,
    'i',
  ).exec(source);
  if (!tableMatch) {
    throw new HttpsError(
      'failed-precondition',
      `Could not find the ${label} table on Blue Dart’s page.`,
    );
  }
  return tableMatch[1];
}

function parseRowsFromTbody(tbodyHtml, percentCellIndex, label) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch = rowRe.exec(tbodyHtml);
  while (rowMatch) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => stripTags(m[1]));
    if (cells.length > percentCellIndex) {
      const date = parseEffectiveDate(cells[0]);
      const percent = parsePercent(cells[percentCellIndex]);
      if (date && percent != null) {
        rows.push({
          effectiveDate: date.iso,
          effectiveLabel: date.label,
          percent,
          _sort: date.year * 10000 + date.month * 100 + date.day,
        });
      }
    }
    rowMatch = rowRe.exec(tbodyHtml);
  }

  if (!rows.length) {
    throw new HttpsError(
      'failed-precondition',
      `${label} table was empty or unreadable.`,
    );
  }

  rows.sort((a, b) => b._sort - a._sort);
  return rows.map(({ effectiveDate, effectiveLabel, percent }) => ({
    effectiveDate,
    effectiveLabel,
    percent,
  }));
}

/** Prefer latest published row whose effective date is on/before today. */
export function pickCurrentSurchargeRow(rows, now = new Date()) {
  if (!rows.length) {
    throw new HttpsError('failed-precondition', 'No surcharge rows available.');
  }
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const todayKey = y * 10000 + m * 100 + d;

  for (const row of rows) {
    const [yy, mm, dd] = row.effectiveDate.split('-').map(Number);
    const key = yy * 10000 + mm * 100 + dd;
    if (key <= todayKey) return row;
  }
  // All rows are in the future — use the earliest upcoming (last after desc sort).
  return rows[rows.length - 1];
}

/**
 * Parse Domestic Fuel Surcharge % rows (column 1 after Effective Date).
 * @returns {{ effectiveDate: string, effectiveLabel: string, percent: number }[]}
 */
export function parseBlueDartFuelSurchargeHtml(html) {
  const tbody = extractTbody(
    html,
    'Effective\\s*Date[\\s\\S]{0,400}?Domestic[\\s\\S]{0,200}?Regional',
    'Fuel Surcharge',
  );
  return parseRowsFromTbody(tbody, 1, 'Fuel Surcharge');
}

/**
 * Parse CAF % rows.
 * @returns {{ effectiveDate: string, effectiveLabel: string, percent: number }[]}
 */
export function parseBlueDartCafHtml(html) {
  const tbody = extractTbody(
    html,
    'Effective\\s*Date[\\s\\S]{0,200}?CAF',
    'Currency Adjustment Factor',
  );
  return parseRowsFromTbody(tbody, 1, 'Currency Adjustment Factor');
}

async function fetchPageHtml(url, label) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': `YesWeighService/1.0 (+https://service.yesweigh.in; ${label} sync)`,
      },
    });
  } catch (err) {
    throw new HttpsError(
      'unavailable',
      err?.message ?? `Could not reach Blue Dart ${label} page.`,
    );
  }

  if (!response.ok) {
    throw new HttpsError(
      'unavailable',
      `Blue Dart ${label} page returned HTTP ${response.status}.`,
    );
  }

  return response.text();
}

/** Fetch current published Domestic FS % and CAF % for Air / DP shared charges. */
export async function fetchBlueDartAirSurcharges() {
  const [fsHtml, cafHtml] = await Promise.all([
    fetchPageHtml(BLUE_DART_FUEL_SURCHARGE_URL, 'fuel-surcharge'),
    fetchPageHtml(BLUE_DART_CAF_URL, 'currency-adjustment-factor'),
  ]);

  const fsRows = parseBlueDartFuelSurchargeHtml(fsHtml);
  const cafRows = parseBlueDartCafHtml(cafHtml);
  const fs = pickCurrentSurchargeRow(fsRows);
  const caf = pickCurrentSurchargeRow(cafRows);

  return {
    fuel: {
      sourceUrl: BLUE_DART_FUEL_SURCHARGE_URL,
      percent: fs.percent,
      effectiveDate: fs.effectiveDate,
      effectiveLabel: fs.effectiveLabel,
      recent: fsRows.slice(0, 6),
    },
    caf: {
      sourceUrl: BLUE_DART_CAF_URL,
      percent: caf.percent,
      effectiveDate: caf.effectiveDate,
      effectiveLabel: caf.effectiveLabel,
      recent: cafRows.slice(0, 6),
    },
    fetchedAt: new Date().toISOString(),
  };
}
