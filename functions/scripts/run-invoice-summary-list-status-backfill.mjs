/**
 * One-shot local run of backfillInvoiceSummaryListStatus.
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\to\sa.json
 *   node functions/scripts/run-invoice-summary-list-status-backfill.mjs
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { backfillInvoiceSummaryListStatus } from '../lib/invoice-stats.js';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
if (!credPath) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path.');
  process.exit(1);
}

if (!getApps().length) {
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({
    credential: cert(sa),
    projectId: sa.project_id || 'yesweigh-service',
    storageBucket: 'yesweigh-service.firebasestorage.app',
  });
}

console.log('Starting invoice summary listStatus backfill…');
const started = Date.now();
const result = await backfillInvoiceSummaryListStatus({
  onProgress: msg => console.log(msg),
});
console.log('Done in', Math.round((Date.now() - started) / 1000), 's');
console.log(JSON.stringify(result, null, 2));
