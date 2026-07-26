/**
 * List catalog products that use SAC (service) codes on the HSN field.
 *
 *   node scripts/list-sac-items.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const KNOWN = {
  998717: 'service',
  998346: 'gatc',
  996812: 'freight',
};

function initFirebase() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    const parsed = JSON.parse(
      fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'),
    );
    if (parsed.private_key && parsed.client_email) {
      initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || 'yesweigh-service',
      });
      return;
    }
  }
  const firebaseAdc = path.join(
    process.env.APPDATA || '',
    'firebase',
    'mhdfazalvs_gmail_com_application_default_credentials.json',
  );
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(firebaseAdc)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = firebaseAdc;
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: 'yesweigh-service',
  });
}

function norm(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function isSac(hsn) {
  const h = norm(hsn);
  if (!h) return false;
  if (KNOWN[h]) return true;
  // SAC codes are typically 6-digit starting with 99
  return /^99\d{4,}$/.test(h);
}

initFirebase();
const db = getFirestore();
const snap = await db.collection('catalogProducts').get();
const rows = [];

for (const doc of snap.docs) {
  const d = doc.data() || {};
  const hsn = norm(d.hsn);
  if (!isSac(hsn)) continue;
  rows.push({
    id: doc.id,
    sku: String(d.sku || d.itemSku || '').trim(),
    name: String(d.name || d.itemName || '').trim(),
    hsn,
    kind: KNOWN[hsn] || 'sac',
    categoryName: String(d.categoryName || '').trim(),
    active: d.active !== false,
  });
}

rows.sort((a, b) => a.hsn.localeCompare(b.hsn) || a.name.localeCompare(b.name));

console.log(`SAC-based catalog items: ${rows.length}`);
console.log('---');

const byHsn = new Map();
for (const row of rows) {
  if (!byHsn.has(row.hsn)) byHsn.set(row.hsn, []);
  byHsn.get(row.hsn).push(row);
}

for (const [hsn, items] of byHsn) {
  console.log(`\nSAC ${hsn} (${KNOWN[hsn] || 'other'}) — ${items.length} item(s)`);
  for (const row of items) {
    const sku = row.sku || 'no-sku';
    const name = row.name || '(unnamed)';
    const cat = row.categoryName ? `  cat=${row.categoryName}` : '';
    const inactive = row.active ? '' : '  (inactive)';
    console.log(`  - [${sku}] ${name}  id=${row.id}${cat}${inactive}`);
  }
}
