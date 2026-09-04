/**
 * Print Delhivery billed freight for one or more LRNs.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=...json node scripts/lookup-delhivery-freight.mjs 314344753
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'functions', 'package.json'));
const { initializeApp, cert, applicationDefault, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const {
  fetchDelhiveryFreightCharges,
  delhiveryFreightExclGstInr,
} = await import('../functions/lib/delhivery-freight.js');

function initAdmin() {
  if (getApps().length) return;
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

const lrns = process.argv.slice(2).map(s => String(s || '').trim()).filter(Boolean);
if (!lrns.length) {
  console.error('Usage: node scripts/lookup-delhivery-freight.mjs <LRN> [LRN...]');
  process.exit(1);
}

initAdmin();
const result = await fetchDelhiveryFreightCharges(getFirestore(), lrns);
const rows = Object.entries(result.byLrn || {}).map(([lrn, freight]) => ({
  lrn,
  ok: Boolean(freight?.ok),
  totalInr: freight?.totalInr ?? null,
  exclGstInr: delhiveryFreightExclGstInr(freight),
  chargedWeightKg: freight?.chargedWeightKg ?? null,
  billingMode: freight?.billingMode ?? null,
  breakup: freight?.breakup ?? null,
  error: freight?.error || result.error || null,
}));

console.log(JSON.stringify({
  ok: result.ok,
  error: result.error,
  fetchedAt: result.fetchedAt,
  rows,
}, null, 2));

if (!result.ok) process.exit(2);
