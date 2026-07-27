/**
 * Run from repo root or functions/:
 *   node scripts/run-dealer-staff-assignment.mjs --dry-run
 *   node scripts/run-dealer-staff-assignment.mjs --all
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const doWipe = args.has('--wipe') || args.has('--all');
const doBackfill = !args.has('--wipe') || args.has('--all');

const functionsDir = path.resolve('functions');
const requireFromFunctions = createRequire(path.join(functionsDir, 'package.json'));
const { initializeApp, applicationDefault, cert } = requireFromFunctions('firebase-admin/app');

function initFirebase() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    const parsed = JSON.parse(
      fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'),
    );
    if (parsed.private_key && parsed.client_email) {
      initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || 'yesweigh-service',
      });
      return;
    }
  }
  const firebaseAdc = path.join(
    process.env.APPDATA || '',
    'firebase',
    'mhdfazalvs_gmail_com_application_default_credentials.json',
  );
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(firebaseAdc)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = firebaseAdc;
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: 'yesweigh-service',
  });
}

initFirebase();

const mod = await import(
  pathToFileURL(path.join(functionsDir, 'lib', 'dealer-staff-assignment.js')).href
);

if (doBackfill) {
  console.log(dryRun ? 'Backfill dry-run…' : 'Backfill live…');
  const result = await mod.backfillDealerAssignedStaff({
    dryRun,
    onProgress: p => console.log('progress', JSON.stringify(p)),
  });
  console.log('backfill result:', JSON.stringify(result, null, 2));
}

if (doWipe) {
  if (dryRun) {
    console.log('Skipping wipe during --dry-run.');
  } else {
    console.log('Wiping legacy KAM data…');
    const result = await mod.wipeLegacyKamData({
      onProgress: p => console.log('wipe progress', JSON.stringify(p)),
    });
    console.log('wipe result:', JSON.stringify(result, null, 2));
  }
}
