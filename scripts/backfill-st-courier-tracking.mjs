/**
 * One-time (or ad-hoc): fetch ST Courier tracking for ALL st_courier logistics
 * bookings (including delivered) and persist courierTrack + history on each doc.
 * Advances pipeline status when ST reports delivered / in-transit.
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=secrets\yesweigh-service-firebase-adminsdk-....json
 *   node scripts/backfill-st-courier-tracking.mjs [--dry-run] [--limit=N] [--concurrency=2]
 *
 * Options:
 *   --dry-run          Fetch and log only; no Firestore writes
 *   --limit=N          Process at most N bookings
 *   --concurrency=N    Parallel ST fetches (default 2)
 *   --include-cancelled  Also sync cancelled bookings
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { syncStCourierTrackingForBookings } from '../functions/lib/st-courier-track-sync.js';

const DRY_RUN = process.argv.includes('--dry-run');
const INCLUDE_CANCELLED = process.argv.includes('--include-cancelled');

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
  `ST Courier tracking backfill`
  + ` (includeDelivered=true, includeCancelled=${INCLUDE_CANCELLED},`
  + ` dryRun=${DRY_RUN}, limit=${LIMIT || 'all'}, concurrency=${CONCURRENCY})`,
);

const summary = await syncStCourierTrackingForBookings(db, {
  includeDelivered: true,
  includeCancelled: INCLUDE_CANCELLED,
  dryRun: DRY_RUN,
  concurrency: CONCURRENCY,
  delayMs: 400,
  limit: LIMIT,
  onProgress: (event) => {
    if (event.type === 'fetched') {
      const statusBit = event.nextStatus ? ` → ${event.nextStatus}` : '';
      const st = event.ok ? (event.stStatus || 'ok') : (event.error || 'fail');
      console.log(
        `${DRY_RUN ? '[dry] ' : ''}${event.id}  AWB=${event.awb}  ${st}${statusBit}`,
      );
      return;
    }
    if (event.type === 'error' || event.type === 'write_error') {
      console.warn(`! ${event.id}  AWB=${event.awb}  ${event.error}`);
    }
  },
});

console.log('---');
console.log(`Scanned ST bookings: ${summary.scanned}`);
console.log(`Targeted: ${summary.targeted}`);
console.log(`Fetch ok: ${summary.fetchedOk}`);
console.log(`Fetch fail: ${summary.fetchedFail}`);
console.log(`Updated: ${summary.updated}`);
console.log(`Status advanced: ${summary.statusAdvanced}`);
if (DRY_RUN) console.log(`Dry-run skipped writes: ${summary.skipped}`);
if (summary.errors.length) {
  console.log(`Errors: ${summary.errors.length}`);
  for (const row of summary.errors.slice(0, 20)) {
    console.log(`  - ${row.id} ${row.awb}: ${row.error}`);
  }
}
console.log(DRY_RUN ? 'Dry run complete — no writes.' : 'Done.');
