/**
 * One-time: fold removed logistics status into the current pipeline.
 *   shipped → in_transit
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=secrets\yesweigh-service-firebase-adminsdk-....json
 *   node scripts/backfill-logistics-status-rename.mjs [--dry-run] [--limit=N]
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY_RUN = process.argv.includes('--dry-run');

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  if (!hit) return fallback;
  const raw = hit.slice(prefix.length);
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

const LIMIT = argValue('limit', 0);

const STATUS_MAP = Object.freeze({
  shipped: 'in_transit',
});

function initAdmin() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    initializeApp({
      credential: cert(parsed),
      projectId: parsed.project_id || 'yesweigh-service',
    });
    return;
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: 'yesweigh-service',
  });
}

initAdmin();
const db = getFirestore();

console.log(`Logistics status rename backfill (dryRun=${DRY_RUN}, limit=${LIMIT || 'all'})`);

const snap = await db.collection('logisticsBookings').get();
const updatedAt = new Date().toISOString();
let scanned = 0;
let updated = 0;
let skipped = 0;

for (const docSnap of snap.docs) {
  scanned += 1;
  const data = docSnap.data() || {};
  const current = String(data.status || '');
  const next = STATUS_MAP[current];
  if (!next) {
    skipped += 1;
    continue;
  }
  if (LIMIT && updated >= LIMIT) break;

  console.log(`${DRY_RUN ? '[dry] ' : ''}${docSnap.id}  ${current} → ${next}`);
  if (!DRY_RUN) {
    /** @type {Record<string, unknown>} */
    const patch = { status: next, updatedAt };
    if (next === 'in_transit' && !data.inTransitAt) {
      patch.inTransitAt = data.shippedAt || updatedAt;
    }
    await docSnap.ref.update(patch);
  }
  updated += 1;
}

console.log(JSON.stringify({ scanned, updated, skipped, dryRun: DRY_RUN }, null, 2));
