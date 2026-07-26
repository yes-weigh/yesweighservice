/**
 * Fill missing salespersonId on invoices / salesOrders from zohoSalespersons name cache.
 *
 *   node scripts/backfill-salesperson-ids.mjs
 *   node scripts/backfill-salesperson-ids.mjs --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const dryRun = process.argv.includes('--dry-run');

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

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[-_/.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

initFirebase();
const db = getFirestore();

const zohoSnap = await db.collection('zohoSalespersons').get();
const idByName = new Map();
for (const doc of zohoSnap.docs) {
  const data = doc.data() || {};
  const name = normalizeName(data.name);
  const id = String(data.id || doc.id).trim();
  if (name && id && !idByName.has(name)) idByName.set(name, id);
}
console.log(`Loaded ${idByName.size} salesperson name→id mappings`);

async function backfillCollectionGroup(collectionId, label) {
  let updated = 0;
  let scanned = 0;
  let missingName = 0;
  let alreadyHadId = 0;
  let unmatched = 0;

  const snap = await db.collectionGroup(collectionId).select(
    'salespersonId',
    'salespersonName',
  ).get();

  let batch = db.batch();
  let ops = 0;
  const commit = async () => {
    if (!ops || dryRun) {
      ops = 0;
      return;
    }
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const doc of snap.docs) {
    scanned += 1;
    const data = doc.data() || {};
    const existingId = String(data.salespersonId ?? '').trim();
    if (existingId) {
      alreadyHadId += 1;
      continue;
    }
    const name = String(data.salespersonName ?? '').trim();
    if (!name) {
      missingName += 1;
      continue;
    }
    const id = idByName.get(normalizeName(name));
    if (!id) {
      unmatched += 1;
      continue;
    }
    updated += 1;
    if (!dryRun) {
      batch.set(doc.ref, {
        salespersonId: id,
        syncedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      ops += 1;
      if (ops >= 400) await commit();
    }
  }
  await commit();

  console.log(label, {
    scanned,
    updated,
    alreadyHadId,
    missingName,
    unmatched,
    dryRun,
  });
  return { scanned, updated };
}

// Invoices live under zohoCustomers/{id}/invoices — collection group works.
await backfillCollectionGroup('invoices', 'invoices');
await backfillCollectionGroup('salesOrders', 'salesOrders');
