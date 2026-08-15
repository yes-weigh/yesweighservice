/**
 * Rebuild one month's invoice status chip maps from live invoiceSummaries.
 *
 *   node functions/scripts/rebuild-invoice-month-status-rollups.mjs 2026-08
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { rebuildInvoiceStatusRollupsForMonth } from '../lib/invoice-stats.js';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  || 'secrets/yesweigh-service-firebase-adminsdk-fbsvc-65d526cda5.json';
const monthKey = String(process.argv[2] || '').trim();
if (!/^\d{4}-\d{2}$/.test(monthKey)) {
  console.error('Usage: node functions/scripts/rebuild-invoice-month-status-rollups.mjs YYYY-MM');
  process.exit(1);
}

if (!getApps().length) {
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({
    credential: cert(sa),
    projectId: sa.project_id || 'yesweigh-service',
  });
}

const result = await rebuildInvoiceStatusRollupsForMonth(monthKey);
console.log(JSON.stringify(result, null, 2));
