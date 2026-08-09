/**
 * Fetch Delhivery freight-breakup for logistics bookings that already passed
 * "weight captured", and persist courierFreight / actualFreightInr.
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=secrets\yesweigh-service-firebase-adminsdk-....json
 *   node scripts/backfill-delhivery-freight.mjs [--dry-run] [--force] [--limit=N]
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { syncDelhiveryFreightForBookings } from '../functions/lib/delhivery-track-sync.js';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const INCLUDE_CANCELLED = process.argv.includes('--include-cancelled');

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  if (!hit) return fallback;
  const num = Number(hit.slice(prefix.length));
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
  `Delhivery freight backfill`
  + ` (force=${FORCE}, includeCancelled=${INCLUDE_CANCELLED}, dryRun=${DRY_RUN},`
  + ` limit=${LIMIT || 'all'}, concurrency=${CONCURRENCY})`,
);

const summary = await syncDelhiveryFreightForBookings(db, {
  includeDelivered: true,
  includeCancelled: INCLUDE_CANCELLED,
  force: FORCE,
  dryRun: DRY_RUN,
  concurrency: CONCURRENCY,
  delayMs: 350,
  limit: LIMIT,
  onProgress: (event) => {
    if (event.type === 'fetched') {
      const bit = event.ok
        ? ` ₹${event.totalInr} / ${event.chargedWeightKg}kg`
        : ` fail=${event.error || '?'}`;
      console.log(
        `${DRY_RUN ? '[dry] ' : ''}${event.id}  LRN=${event.awb}${bit}`,
      );
    } else if (event.type === 'error' || event.type === 'write_error') {
      console.warn(`${event.type} ${event.id} LRN=${event.awb}: ${event.error}`);
    }
  },
});

console.log(
  `Done. scanned=${summary.scanned} targeted=${summary.targeted}`
  + ` ok=${summary.fetchedOk} fail=${summary.fetchedFail}`
  + ` updated=${summary.updated} skipped=${summary.skipped}`
  + ` errors=${summary.errors.length}`,
);
process.exit(summary.errors.length ? 1 : 0);
