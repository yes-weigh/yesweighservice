/**
 * One-time: fetch ST Courier destination delivery-office Communication for all
 * st_courier logistics bookings missing courierDeliveryOffice, and persist it.
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=secrets\yesweigh-service-firebase-adminsdk-....json
 *   node scripts/backfill-st-courier-delivery-office.mjs [--dry-run] [--limit=N] [--concurrency=2]
 *
 * Options:
 *   --dry-run          Fetch and log only; no Firestore writes
 *   --force            Re-fetch even when courierDeliveryOffice already set
 *   --limit=N          Process at most N bookings
 *   --concurrency=N    Parallel ST fetches (default 2)
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { syncStCourierDeliveryOfficesForBookings } from '../functions/lib/st-courier-delivery-office-sync.js';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  if (!hit) return fallback;
  const raw = hit.slice(prefix.length);
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

const LIMIT = argValue('limit', 0);
const CONCURRENCY = argValue('concurrency', 2);

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

console.log(
  `ST Courier delivery-office backfill`
  + ` (force=${FORCE}, dryRun=${DRY_RUN}, limit=${LIMIT || 'all'}, concurrency=${CONCURRENCY})`,
);

const summary = await syncStCourierDeliveryOfficesForBookings(db, {
  dryRun: DRY_RUN,
  force: FORCE,
  concurrency: CONCURRENCY,
  delayMs: 400,
  limit: LIMIT,
  onProgress: (event) => {
    if (event.type === 'updated') {
      console.log(
        `${DRY_RUN ? '[dry] ' : ''}${event.id}  PIN=${event.pincode}  ${event.communication}`,
      );
      return;
    }
    if (event.type === 'skipped') {
      if (event.reason === 'not_found' || event.reason === 'no_pincode') {
        console.log(
          `~ ${event.id}  skipped (${event.reason}${event.pincode ? ` pin=${event.pincode}` : ''})`,
        );
      }
      return;
    }
    if (event.type === 'error') {
      console.warn(`! ${event.id}  ${event.error}`);
    }
  },
});

console.log('---');
console.log(`Scanned ST bookings: ${summary.scanned}`);
console.log(`Targeted: ${summary.targeted}`);
console.log(`Updated: ${summary.updated}`);
console.log(`Skipped: ${summary.skipped}`);
console.log(`Not found: ${summary.notFound}`);
if (summary.errors.length) {
  console.log(`Errors: ${summary.errors.length}`);
  for (const row of summary.errors.slice(0, 20)) {
    console.log(`  - ${row.id}: ${row.error}`);
  }
}
console.log(DRY_RUN ? 'Dry run complete — no writes.' : 'Done.');
