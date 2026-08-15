/**
 * Delete mirrored purchase orders dated before 01 Apr 2026 (and their PDFs).
 *
 *   node functions/scripts/purge-old-purchase-orders.mjs
 *   node functions/scripts/purge-old-purchase-orders.mjs --dry-run
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import {
  deletePurchaseOrdersBeforeKeepDate,
  PURCHASE_ORDER_KEEP_AFTER_DATE,
} from '../lib/purchase-order-sync.js';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  || 'secrets/yesweigh-service-firebase-adminsdk-fbsvc-65d526cda5.json';
const dryRun = process.argv.includes('--dry-run');

if (!getApps().length) {
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  const projectId = sa.project_id || 'yesweigh-service';
  initializeApp({
    credential: cert(sa),
    projectId,
    storageBucket: `${projectId}.firebasestorage.app`,
  });
}

console.log(
  `${dryRun ? 'Dry run' : 'Deleting'} purchaseOrders with date < ${PURCHASE_ORDER_KEEP_AFTER_DATE}`,
);

const result = await deletePurchaseOrdersBeforeKeepDate({
  dryRun,
  onProgress: ({ scanned, deleted, id, date }) => {
    console.log(`${dryRun ? 'would delete' : 'deleted'} ${id} date=${date || '—'} (${deleted} of ${scanned} scanned)`);
  },
});

console.log(JSON.stringify(result, null, 2));
