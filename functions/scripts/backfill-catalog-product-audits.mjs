/**
 * One-time migration: capture existing warehouse bin counts + Cochin site stock
 * as catalog product audit snapshots before / after audit-log deploy.
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json
 *   node functions/scripts/backfill-catalog-product-audits.mjs
 *   node functions/scripts/backfill-catalog-product-audits.mjs --dry-run
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { backfillLegacyCatalogProductAudits } from '../lib/catalog-product-audit.js';

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const dryRun = process.argv.includes('--dry-run');
const forceAll = process.argv.includes('--force');

if (!credentialsPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is required (service account JSON path).');
  process.exit(1);
}

try {
  const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  const projectId = parsed.project_id || 'yesweigh-service';
  initializeApp({
    credential: cert(parsed),
    storageBucket: `${projectId}.firebasestorage.app`,
  });

  const summary = await backfillLegacyCatalogProductAudits({
    dryRun,
    onlyMissing: !forceAll,
  });

  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) {
    console.log('\nDry run only — re-run without --dry-run to write snapshots.');
  } else {
    console.log(
      `\nAudit backfill complete: ${summary.created} snapshot(s) written, `
      + `${summary.skippedHasSnapshot} already had snapshot, `
      + `${summary.skippedNoProduct} missing product doc, `
      + `${summary.errors.length} error(s).`,
    );
  }

  if (summary.errors.length) {
    process.exit(1);
  }
} catch (err) {
  console.error('Audit backfill failed:', err?.message ?? err);
  process.exit(1);
}
