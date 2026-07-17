/**
 * Repair audits that have location counts / snapshots but empty auditLogs:
 *   1) backfill missing snapshots+logs from HO bins / Cochin inventory
 *   2) recreate logs for orphan snapshots (e.g. cleared 15 Jul)
 *   3) stamp open Initial cycles so counted SKUs are not "Needs count"
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json
 *   node functions/scripts/repair-missing-audit-logs.mjs --dry-run
 *   node functions/scripts/repair-missing-audit-logs.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import {
  backfillLegacyCatalogProductAudits,
  repairSnapshotsMissingAuditLogs,
} from '../lib/catalog-product-audit.js';
import { migrateExistingAuditsIntoCycles } from '../lib/audit-cycles-migrate.js';

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const dryRun = process.argv.includes('--dry-run');

function initFirebase() {
  const projectId = 'yesweigh-service';
  const bucket = `${projectId}.firebasestorage.app`;

  if (credentialsPath && existsSync(credentialsPath)) {
    const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    if (parsed.type === 'service_account' && parsed.project_id) {
      initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || projectId,
        storageBucket: bucket,
      });
      return;
    }
  }

  // Application Default Credentials (gcloud / firebase login:ci refresh token JSON).
  initializeApp({
    credential: applicationDefault(),
    projectId,
    storageBucket: bucket,
  });
}

try {
  initFirebase();

  console.log(dryRun ? '=== DRY RUN ===' : '=== WRITING ===');

  const backfill = await backfillLegacyCatalogProductAudits({
    dryRun,
    onlyMissing: true,
  });
  console.log('\n[1/3] Location backfill (missing snapshots)');
  console.log(JSON.stringify({
    created: backfill.created,
    skippedHasSnapshot: backfill.skippedHasSnapshot,
    skippedNoProduct: backfill.skippedNoProduct,
    skippedNoData: backfill.skippedNoData,
    errors: backfill.errors.length,
    samples: backfill.samples,
  }, null, 2));

  const orphans = await repairSnapshotsMissingAuditLogs({ dryRun });
  console.log('\n[2/3] Orphan snapshots missing logs');
  console.log(JSON.stringify({
    scanned: orphans.scanned,
    repaired: orphans.repaired,
    skippedHasLogs: orphans.skippedHasLogs,
    errors: orphans.errors.length,
    samples: orphans.samples,
  }, null, 2));

  const cycles = await migrateExistingAuditsIntoCycles({ dryRun, force: false });
  console.log('\n[3/3] Stamp open Initial cycles');
  console.log(JSON.stringify({
    backfillCreated: cycles.backfill?.created,
    stampedHeadOffice: cycles.stampedHeadOffice,
    stampedCochin: cycles.stampedCochin,
    skippedAlreadyStamped: cycles.skippedAlreadyStamped,
    errors: cycles.errors.length,
    samples: cycles.samples,
  }, null, 2));

  const errorCount = backfill.errors.length + orphans.errors.length + cycles.errors.length;
  if (errorCount) {
    console.error('\nErrors:', JSON.stringify({
      backfill: backfill.errors,
      orphans: orphans.errors,
      cycles: cycles.errors,
    }, null, 2));
    process.exit(1);
  }

  if (dryRun) {
    console.log('\nDry run only — re-run without --dry-run to write.');
  } else {
    console.log(
      `\nDone: backfilled ${backfill.created}, repaired ${orphans.repaired} orphan(s), `
      + `stamped HO ${cycles.stampedHeadOffice} / Cochin ${cycles.stampedCochin}.`,
    );
  }
} catch (err) {
  console.error('Repair failed:', err?.message ?? err);
  process.exit(1);
}
