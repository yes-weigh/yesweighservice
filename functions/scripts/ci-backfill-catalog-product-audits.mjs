/**
 * Post-deploy audit snapshot backfill for GitHub Actions (idempotent).
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { backfillLegacyCatalogProductAudits } from '../lib/catalog-product-audit.js';

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

if (!credentialsPath) {
  console.log('Skipping audit backfill: GOOGLE_APPLICATION_CREDENTIALS not set.');
  process.exit(0);
}

try {
  const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  const projectId = parsed.project_id || 'yesweigh-service';
  initializeApp({
    credential: cert(parsed),
    storageBucket: `${projectId}.firebasestorage.app`,
  });

  const summary = await backfillLegacyCatalogProductAudits({
    dryRun: false,
    onlyMissing: true,
  });

  console.log(
    `Audit backfill: ${summary.created} created, `
    + `${summary.skippedHasSnapshot} skipped (already snapshotted), `
    + `${summary.candidates} candidates.`,
  );

  if (summary.errors.length) {
    console.error('Audit backfill errors:', summary.errors.slice(0, 5));
    process.exit(1);
  }
} catch (err) {
  console.error('Audit backfill failed:', err?.message ?? err);
  process.exit(1);
}
