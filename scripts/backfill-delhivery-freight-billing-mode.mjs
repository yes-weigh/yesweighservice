/**
 * Resolve missing Delhivery FOD/BTC (freightBillingMode) on logistics bookings.
 *
 * Uses stored freight-breakup totals + /freight/estimate comparison when the
 * LR detail APIs do not return freight_mode.
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=secrets\yesweigh-service-firebase-adminsdk-....json
 *   node scripts/backfill-delhivery-freight-billing-mode.mjs [--dry-run] [--force] [--limit=N]
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { syncDelhiveryFreightForBookings } from '../functions/lib/delhivery-track-sync.js';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  if (!hit) return fallback;
  const num = Number(hit.slice(prefix.length));
  return Number.isFinite(num) ? num : fallback;
}

const LIMIT = argValue('limit', 0);

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
  `Delhivery FOD/BTC backfill (force=${FORCE}, dryRun=${DRY_RUN}, limit=${LIMIT || 'all'})`,
);

const summary = await syncDelhiveryFreightForBookings(db, {
  includeDelivered: true,
  includeCancelled: false,
  force: FORCE,
  dryRun: DRY_RUN,
  concurrency: 1,
  delayMs: 400,
  limit: LIMIT,
  onProgress: (event) => {
    if (event.type === 'fetched') {
      console.log(
        `${DRY_RUN ? '[dry] ' : ''}${event.id} LRN=${event.awb}`
        + ` total=${event.totalInr ?? '—'}`
        + (event.modeOnly ? ' (mode-only)' : ''),
      );
    } else if (event.type === 'error' || event.type === 'write_error') {
      console.warn(`${event.type} ${event.id}: ${event.error}`);
    }
  },
});

console.log(
  `Done. scanned=${summary.scanned} targeted=${summary.targeted}`
  + ` ok=${summary.fetchedOk} fail=${summary.fetchedFail}`
  + ` updated=${summary.updated} skipped=${summary.skipped}`
  + ` errors=${summary.errors.length}`,
);

// Print resulting modes
const snap = await db.collection('logisticsBookings').where('partnerId', '==', 'delhivery').get();
for (const doc of snap.docs) {
  const d = doc.data();
  console.log(
    doc.id,
    d.consignmentNo,
    d.freightBillingMode || '—',
    d.freightBillingModeSource || '—',
    d.invoiceNumber || '',
  );
}
