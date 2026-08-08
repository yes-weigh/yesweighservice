/**
 * One-time (or ad-hoc): fetch Trackon tracking for ALL trackon_* logistics
 * bookings (including delivered) and persist courierTrack + history on each doc.
 * Advances pipeline status from Trackon, and corrects false "delivered" marks when
 * Trackon still shows in-transit / undelivered.
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=secrets\yesweigh-service-firebase-adminsdk-....json
 *   node scripts/backfill-trackon-tracking.mjs [--dry-run] [--limit=N] [--concurrency=2]
 *
 * Options:
 *   --dry-run          Fetch and log only; no Firestore writes
 *   --limit=N          Process at most N bookings
 *   --concurrency=N    Parallel Trackon fetches (default 2)
 *   --include-cancelled  Also sync cancelled bookings
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { syncTrackonTrackingForBookings } from '../functions/lib/trackon-track-sync.js';

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
  `Trackon tracking backfill`
  + ` (includeDelivered=true, correctFalseDelivered=true, includeCancelled=${INCLUDE_CANCELLED},`
  + ` dryRun=${DRY_RUN}, limit=${LIMIT || 'all'}, concurrency=${CONCURRENCY})`,
);

const summary = await syncTrackonTrackingForBookings(db, {
  includeDelivered: true,
  correctFalseDelivered: true,
  includeCancelled: INCLUDE_CANCELLED,
  dryRun: DRY_RUN,
  concurrency: CONCURRENCY,
  delayMs: 400,
  limit: LIMIT,
  onProgress: (event) => {
    if (event.type === 'fetched') {
      const from = event.currentStatus || '?';
      const statusBit = event.nextStatus
        ? (event.correctedDelivered
          ? `  CORRECT ${from} → ${event.nextStatus}`
          : `  ${from} → ${event.nextStatus}`)
        : `  [${from}]`;
      const st = event.ok ? (event.stStatus || 'ok') : (event.error || 'fail');
      console.log(
        `${DRY_RUN ? '[dry] ' : ''}${event.id}  AWB=${event.awb}  Trackon=${st}${statusBit}`,
      );
    } else if (event.type === 'error' || event.type === 'write_error') {
      console.warn(`${event.type} ${event.id} AWB=${event.awb}: ${event.error}`);
    }
  },
});

console.log(
  `Done. scanned=${summary.scanned} targeted=${summary.targeted}`
  + ` ok=${summary.fetchedOk} fail=${summary.fetchedFail}`
  + ` updated=${summary.updated} statusAdvanced=${summary.statusAdvanced}`
  + ` statusCorrected=${summary.statusCorrected} errors=${summary.errors.length}`,
);
process.exit(summary.errors.length ? 1 : 0);
