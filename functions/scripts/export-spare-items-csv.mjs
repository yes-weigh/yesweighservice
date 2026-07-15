/**
 * Export spare catalog items (generic spare parts + uncategorized) to CSV.
 *
 * Columns: sku, name, locations
 * Locations = Yes Store bins (rack · row · bin) and Cochin/HO site zones (ZONE · row),
 * comma-separated when multi-location.
 *
 * Usage (from functions/):
 *   node scripts/export-spare-items-csv.mjs
 *   node scripts/export-spare-items-csv.mjs --out=../spare-items.csv
 */
import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'yesweigh-service';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const outArg = process.argv.find(a => a.startsWith('--out='))?.slice('--out='.length)?.trim();
const outPath = resolve(outArg || join(__dirname, '..', '..', 'spare-items.csv'));

function accessToken() {
  const fromEnv = process.env.GCLOUD_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      shell: true,
    }).trim();
  } catch {
    throw new Error(
      'No access token. Set GCLOUD_ACCESS_TOKEN or ensure gcloud auth print-access-token works.',
    );
  }
}

function decodeValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) {
    const fields = v.mapValue.fields || {};
    return Object.fromEntries(Object.entries(fields).map(([k, val]) => [k, decodeValue(val)]));
  }
  return null;
}

function decodeDoc(doc) {
  const id = doc.name.split('/').pop();
  const fields = doc.fields || {};
  const data = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
  return { id, ...data };
}

async function listCollection(token, collectionId) {
  const docs = [];
  let pageToken = '';
  for (;;) {
    const url = new URL(`${BASE}/${collectionId}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to list ${collectionId}: ${res.status} ${body}`);
    }
    const json = await res.json();
    for (const doc of json.documents || []) docs.push(decodeDoc(doc));
    pageToken = json.nextPageToken || '';
    if (!pageToken) break;
  }
  return docs;
}

function isGenericSparePartsCategory(category) {
  const name = String(category?.name ?? '').trim().toLowerCase();
  return (
    name === 'generic spare parts'
    || name === 'generic spares'
    || name.includes('generic spare')
  );
}

function hasCatalogCategory(product) {
  const id = product.categoryId?.trim?.() ?? String(product.categoryId ?? '').trim();
  return Boolean(id && id !== '-1');
}

function isCatalogSparePartProduct(product, categories) {
  const genericCategoryIds = new Set(
    categories.filter(isGenericSparePartsCategory).map(c => c.id),
  );
  if (!hasCatalogCategory(product)) return true;
  if (product.categoryId && genericCategoryIds.has(String(product.categoryId))) return true;
  if (product.categoryName && isGenericSparePartsCategory({ name: product.categoryName })) {
    return true;
  }
  return false;
}

function formatBinLocation(rackId, rowNumber, binNumber) {
  if (!rackId || rowNumber == null || binNumber == null) return null;
  return `${String(rackId).toUpperCase()} · ${rowNumber} · ${binNumber}`;
}

function formatZoneLocation(zoneId, zoneRowNumber) {
  if (!zoneId || zoneRowNumber == null) return null;
  return `${String(zoneId).trim().toUpperCase()} · ${zoneRowNumber}`;
}

function siteInventoryLocations(record) {
  if (record.locations?.length) {
    return record.locations
      .map(row => formatZoneLocation(row.zoneId, row.zoneRowNumber))
      .filter(Boolean);
  }
  const one = formatZoneLocation(record.zoneId, record.zoneRowNumber);
  return one ? [one] : [];
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const token = accessToken();
console.log('Loading catalog + locations from Firestore…');

const [products, categories, yesStoreItems, siteInventory] = await Promise.all([
  listCollection(token, 'catalogProducts'),
  listCollection(token, 'catalogCategories'),
  listCollection(token, 'yesStoreItems'),
  listCollection(token, 'catalogSiteInventory'),
]);

const spares = products
  .filter(p => (p.status ?? 'active') === 'active')
  .filter(p => isCatalogSparePartProduct(p, categories))
  .sort((a, b) => String(a.sku || '').localeCompare(String(b.sku || ''))
    || String(a.name || '').localeCompare(String(b.name || '')));

/** @type {Map<string, string[]>} */
const locationsByProductId = new Map();

function pushLocations(productId, labels) {
  if (!productId || !labels.length) return;
  const existing = locationsByProductId.get(productId) || [];
  for (const label of labels) {
    if (label && !existing.includes(label)) existing.push(label);
  }
  locationsByProductId.set(productId, existing);
}

for (const item of yesStoreItems) {
  const productId = item.catalogProductId?.trim?.() || String(item.catalogProductId || '').trim();
  const label = formatBinLocation(item.rackId, item.rowNumber, item.binNumber);
  if (label) pushLocations(productId, [label]);
}

for (const record of siteInventory) {
  const productId = record.catalogProductId?.trim?.() || String(record.catalogProductId || '').trim();
  pushLocations(productId, siteInventoryLocations(record));
}

for (const [, labels] of locationsByProductId) {
  labels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

const lines = ['sku,name,locations'];
for (const product of spares) {
  const sku = product.sku ?? '';
  const name = product.name ?? '';
  const locations = (locationsByProductId.get(product.id) || []).join(', ');
  lines.push([csvEscape(sku), csvEscape(name), csvEscape(locations)].join(','));
}

writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

const withLocations = spares.filter(p => (locationsByProductId.get(p.id) || []).length > 0).length;
console.log(`Wrote ${spares.length} spare items (${withLocations} with locations) → ${outPath}`);
