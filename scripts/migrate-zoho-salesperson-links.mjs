/**
 * Copy legacy users.zohoSalespersonId → zohoSalespersonIds + zohoSalespersonLinks.
 *
 *   node scripts/migrate-zoho-salesperson-links.mjs
 *   node scripts/migrate-zoho-salesperson-links.mjs --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

initFirebase();
const db = getFirestore();
const snap = await db.collection('users').get();

let updated = 0;
let skipped = 0;

for (const docSnap of snap.docs) {
  const data = docSnap.data() || {};
  const role = String(data.role ?? '');
  if (role !== 'staff' && role !== 'super_admin') {
    skipped += 1;
    continue;
  }

  const existingIds = Array.isArray(data.zohoSalespersonIds)
    ? data.zohoSalespersonIds.map(id => String(id).trim()).filter(Boolean)
    : [];
  const legacyId = data.zohoSalespersonId != null ? String(data.zohoSalespersonId).trim() : '';
  const legacyName = data.zohoSalespersonName != null
    ? String(data.zohoSalespersonName).trim() || null
    : null;

  const byId = new Map();
  if (Array.isArray(data.zohoSalespersonLinks)) {
    for (const link of data.zohoSalespersonLinks) {
      const id = String(link?.id ?? '').trim();
      if (!id) continue;
      byId.set(id, link?.name != null && String(link.name).trim() ? String(link.name).trim() : null);
    }
  }
  for (const id of existingIds) {
    if (!byId.has(id)) byId.set(id, null);
  }
  if (legacyId && !byId.has(legacyId)) byId.set(legacyId, legacyName);

  if (!byId.size) {
    skipped += 1;
    continue;
  }

  const links = [...byId.entries()].map(([id, name]) => ({ id, name }));
  const ids = links.map(link => link.id);
  const first = links[0];

  const needsWrite = !Array.isArray(data.zohoSalespersonIds)
    || data.zohoSalespersonIds.length !== ids.length
    || !Array.isArray(data.zohoSalespersonLinks)
    || data.zohoSalespersonLinks.length !== links.length
    || String(data.zohoSalespersonId ?? '') !== first.id
    || String(data.zohoSalespersonName ?? '') !== String(first.name ?? '');

  if (!needsWrite) {
    skipped += 1;
    continue;
  }

  console.log(
    dryRun ? 'would update' : 'update',
    docSnap.id,
    data.displayName,
    ids,
  );

  if (!dryRun) {
    await docSnap.ref.set({
      zohoSalespersonIds: ids,
      zohoSalespersonLinks: links,
      zohoSalespersonId: first.id,
      zohoSalespersonName: first.name,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }
  updated += 1;
}

console.log(JSON.stringify({ dryRun, updated, skipped, total: snap.size }, null, 2));
