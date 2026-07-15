/**
 * One-time migration: open Initial HO + Cochin cycles (if missing) and stamp
 * existing audit snapshots so already-counted SKUs are not "Needs count".
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json
 *   node functions/scripts/migrate-audits-into-cycles.mjs --dry-run
 *   node functions/scripts/migrate-audits-into-cycles.mjs
 *   node functions/scripts/migrate-audits-into-cycles.mjs --force
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { migrateExistingAuditsIntoCycles } from '../lib/audit-cycles-migrate.js';

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

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

  const summary = await migrateExistingAuditsIntoCycles({ dryRun, force });
  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) {
    console.log('\nDry run only — re-run without --dry-run to write cycles + stamps.');
  } else {
    console.log(
      `\nMigration complete: HO stamped ${summary.stampedHeadOffice}, `
      + `Cochin stamped ${summary.stampedCochin}, `
      + `${summary.skippedAlreadyStamped} already stamped, `
      + `${summary.errors.length} error(s).`,
    );
  }

  if (summary.errors.length) process.exit(1);
} catch (err) {
  console.error('Audit cycle migration failed:', err?.message ?? err);
  process.exit(1);
}
