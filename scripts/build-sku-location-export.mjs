/**
 * Build CSV: Item Name, Old SKU, New SKU, Location Details, Quantity
 * Categorized products only (excludes Generic spare parts).
 *
 * SKU mapping sources (Downloads):
 * - sku-invalid-chars.csv: dirty → cleaned
 * - sku_proposed (1).csv / bulk-sku-update-*.csv: cleaned/old → new proposed
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';

const require = createRequire(resolve('functions/package.json'));
const admin = require('firebase-admin');

const PROJECT_ID = 'yesweigh-service';
const DOWNLOADS = resolve(homedir(), 'Downloads');
const ADC = resolve(
  process.env.APPDATA || '',
  'firebase/mhdfazalvs_gmail_com_application_default_credentials.json',
);

const INVALID_CSV = resolve(DOWNLOADS, 'sku-invalid-chars.csv');
const PROPOSED_CSV = resolve(DOWNLOADS, 'sku_proposed (1).csv');
const BULK_CSV = resolve(DOWNLOADS, 'bulk-sku-update-2026-07-16-09-23-05.csv');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some(cell => cell.trim() !== '')) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim();
    });
    return obj;
  });
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normSku(sku) {
  return String(sku ?? '').trim().toUpperCase();
}

function normName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isGenericSpareCategoryName(name) {
  const n = String(name ?? '').trim().toLowerCase();
  return n === 'generic spare parts' || n === 'generic spares' || n.includes('generic spare');
}

function hasCategory(product) {
  const id = String(product.categoryId ?? '').trim();
  return Boolean(id && id !== '-1');
}

function formatSiteLocation(site, zoneId, zoneRowNumber) {
  const siteLabel = site === 'head_office' ? 'Head Office' : 'Cochin';
  const zone = String(zoneId ?? '').trim().toUpperCase() || '?';
  return `${siteLabel} / ${zone} / ${zoneRowNumber ?? '?'}`;
}

function formatHeadOfficeBin(rackId, rowNumber, binNumber) {
  const rack = String(rackId ?? '').trim().toUpperCase() || '?';
  return `Head Office / ${rack} / ${rowNumber ?? '?'} / ${binNumber ?? '?'}`;
}

function loadMaps() {
  const invalid = parseCsv(readFileSync(INVALID_CSV, 'utf8'));
  const proposed = [
    ...parseCsv(readFileSync(PROPOSED_CSV, 'utf8')),
    ...parseCsv(readFileSync(BULK_CSV, 'utf8')),
  ];

  /** cleaned → dirty original */
  const cleanToDirty = new Map();
  /** dirty → cleaned */
  const dirtyToClean = new Map();
  /** name → invalid row */
  const invalidByName = new Map();

  for (const row of invalid) {
    const dirty = row['Old SKU'] || '';
    const clean = row['New SKU'] || '';
    if (dirty && clean) {
      dirtyToClean.set(normSku(dirty), dirty);
      cleanToDirty.set(normSku(clean), { dirty, clean, name: row.Name || '', category: row.Category || '' });
      dirtyToClean.set(normSku(dirty), { dirty, clean, name: row.Name || '', category: row.Category || '' });
    }
    const n = normName(row.Name);
    if (n) invalidByName.set(n, row);
  }

  /** any sku → { oldSku, newSku, itemName } from proposed */
  const proposedBySku = new Map();
  const proposedByName = new Map();
  for (const row of proposed) {
    const oldSku = row['Old SKU'] || '';
    const newSku = row['New Proposed SKU'] || row['New SKU'] || '';
    const itemName = row['Item Name'] || row.Name || '';
    if (!oldSku || !newSku) continue;
    const entry = { oldSku, newSku, itemName };
    proposedBySku.set(normSku(oldSku), entry);
    proposedBySku.set(normSku(newSku), entry);
    const n = normName(itemName);
    if (n) proposedByName.set(n, entry);
  }

  return {
    cleanToDirty,
    dirtyToClean,
    invalidByName,
    proposedBySku,
    proposedByName,
    proposedCount: new Set([...proposedBySku.values()].map(e => normSku(e.oldSku))).size,
  };
}

/**
 * Resolve old/new for a Firebase product SKU + name.
 * Prefer proposed rename; else invalid-chars dirty→clean; else current=current.
 */
function resolveSkuPair(currentSku, _productName, maps) {
  // SKU-only matching (name matching mis-links products that were renamed again in Zoho).
  const skuKey = normSku(currentSku);

  const proposed = maps.proposedBySku.get(skuKey) || null;
  const invalid = maps.cleanToDirty.get(skuKey) || maps.dirtyToClean.get(skuKey) || null;

  let proposedViaInvalid = null;
  if (!proposed && invalid?.clean) {
    proposedViaInvalid = maps.proposedBySku.get(normSku(invalid.clean));
  }

  const finalProposed = proposed || proposedViaInvalid;

  if (finalProposed) {
    const dirty = invalid?.dirty
      || maps.cleanToDirty.get(normSku(finalProposed.oldSku))?.dirty
      || finalProposed.oldSku;
    return {
      oldSku: dirty,
      newSku: finalProposed.newSku,
      source: proposedViaInvalid && !proposed ? 'invalid+proposed' : 'proposed',
    };
  }

  if (invalid) {
    return {
      oldSku: invalid.dirty,
      newSku: invalid.clean,
      source: 'invalid-chars',
    };
  }

  const current = String(currentSku || '').trim();
  return {
    oldSku: current,
    newSku: current,
    source: 'unchanged',
  };
}

async function main() {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = ADC;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT_ID,
    });
  }
  const db = admin.firestore();
  const maps = loadMaps();
  console.log(`Proposed rename pairs: ${maps.proposedCount}`);

  console.log('Fetching Firestore collections…');
  const [productsSnap, siteInvSnap, storeSnap] = await Promise.all([
    db.collection('catalogProducts').get(),
    db.collection('catalogSiteInventory').get(),
    db.collection('yesStoreItems').get(),
  ]);

  const products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const siteInv = siteInvSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const storeItems = storeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log(`products=${products.length} siteInv=${siteInv.length} storeItems=${storeItems.length}`);

  const shopProducts = products.filter(p => {
    if (!hasCategory(p)) return false;
    if (isGenericSpareCategoryName(p.categoryName)) return false;
    return true;
  });
  console.log(`Categorized products (excl. Generic spare parts): ${shopProducts.length}`);

  const locationsByProduct = new Map();

  for (const inv of siteInv) {
    const productId = String(inv.catalogProductId ?? '').trim();
    if (!productId) continue;
    const site = inv.site === 'head_office' ? 'head_office' : 'cochin';
    const rows = Array.isArray(inv.locations) && inv.locations.length
      ? inv.locations
      : (inv.zoneId && inv.zoneRowNumber != null
        ? [{ zoneId: inv.zoneId, zoneRowNumber: inv.zoneRowNumber, quantity: inv.quantity ?? 0 }]
        : []);
    if (!rows.length) continue;
    const list = locationsByProduct.get(productId) || [];
    for (const row of rows) {
      list.push({
        location: formatSiteLocation(site, row.zoneId, row.zoneRowNumber),
        quantity: Number(row.quantity) || 0,
      });
    }
    locationsByProduct.set(productId, list);
  }

  for (const item of storeItems) {
    const productId = String(item.catalogProductId ?? '').trim();
    if (!productId) continue;
    const list = locationsByProduct.get(productId) || [];
    list.push({
      location: formatHeadOfficeBin(item.rackId, item.rowNumber, item.binNumber),
      quantity: Number(item.quantity) || 0,
    });
    locationsByProduct.set(productId, list);
  }

  const outRows = [];
  const sourceCounts = { proposed: 0, 'invalid+proposed': 0, 'invalid-chars': 0, unchanged: 0 };

  for (const product of shopProducts) {
    const sku = String(product.sku ?? '').trim();
    const name = String(product.name ?? '').trim();
    const pair = resolveSkuPair(sku, name, maps);
    sourceCounts[pair.source] = (sourceCounts[pair.source] || 0) + 1;

    const locs = locationsByProduct.get(product.id) || [];
    const base = {
      itemName: name,
      oldSku: pair.oldSku,
      newSku: pair.newSku,
      category: String(product.categoryName || '').trim(),
      currentSku: sku,
      productId: product.id,
      mapSource: pair.source,
      zohoStock: Number(product.stock) || 0,
    };

    if (!locs.length) {
      outRows.push({ ...base, location: '', quantity: 0 });
      continue;
    }
    for (const loc of locs) {
      outRows.push({ ...base, location: loc.location, quantity: loc.quantity });
    }
  }

  outRows.sort((a, b) => {
    const n = a.itemName.localeCompare(b.itemName);
    if (n !== 0) return n;
    return a.location.localeCompare(b.location);
  });

  const outPath = resolve(DOWNLOADS, `sku-products-with-locations-${stamp()}.csv`);
  const header = [
    'Item Name',
    'Old SKU',
    'New SKU',
    'Location Details',
    'Quantity',
    'Category',
    'Current Firebase SKU',
    'Zoho Stock',
    'SKU Map Source',
    'Product ID',
  ];
  const lines = [
    header.join(','),
    ...outRows.map(r => [
      csvEscape(r.itemName),
      csvEscape(r.oldSku),
      csvEscape(r.newSku),
      csvEscape(r.location),
      csvEscape(r.quantity),
      csvEscape(r.category),
      csvEscape(r.currentSku),
      csvEscape(r.zohoStock),
      csvEscape(r.mapSource),
      csvEscape(r.productId),
    ].join(',')),
  ];
  // UTF-8 BOM so Excel on Windows opens columns correctly
  writeFileSync(outPath, `\uFEFF${lines.join('\n')}\n`, 'utf8');

  console.log('SKU map sources:', sourceCounts);
  console.log(`Output rows: ${outRows.length}`);
  console.log(`Wrote: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
