/**
 * Pull every Zoho vendor into Firestore (zohoVendors) and backfill PO addresses.
 *
 *   node functions/scripts/sync-zoho-vendors.mjs
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { enrichStoredVendorPlaces, syncZohoVendorsToFirestore } from '../lib/zoho-vendors.js';

const PROJECT_ID = 'yesweigh-service';
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  || 'secrets/yesweigh-service-firebase-adminsdk-fbsvc-65d526cda5.json';

function readEnvFile() {
  const path = 'functions/.env.yesweigh-service';
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function gcloudSecret(name) {
  try {
    return execSync(
      `gcloud secrets versions access latest --secret=${name} --project=${PROJECT_ID}`,
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}

function loadZohoSecrets() {
  const fromEnv = {
    clientId: process.env.ZOHO_CLIENT_ID?.trim() || '',
    clientSecret: process.env.ZOHO_CLIENT_SECRET?.trim() || '',
    refreshToken: process.env.ZOHO_REFRESH_TOKEN?.trim() || '',
  };
  if (fromEnv.clientId && fromEnv.clientSecret && fromEnv.refreshToken) return fromEnv;
  const viaGcloud = {
    clientId: gcloudSecret('ZOHO_CLIENT_ID'),
    clientSecret: gcloudSecret('ZOHO_CLIENT_SECRET'),
    refreshToken: gcloudSecret('ZOHO_REFRESH_TOKEN'),
  };
  if (!viaGcloud.clientId || !viaGcloud.clientSecret || !viaGcloud.refreshToken) {
    throw new Error('Could not load Zoho secrets (env or gcloud).');
  }
  return viaGcloud;
}

if (!getApps().length) {
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({
    credential: cert(sa),
    projectId: sa.project_id || PROJECT_ID,
    storageBucket: `${sa.project_id || PROJECT_ID}.firebasestorage.app`,
  });
}

const orgId = process.env.ZOHO_ORGANIZATION_ID?.trim() || readEnvFile().ZOHO_ORGANIZATION_ID || '';
const enrichOnly = process.argv.includes('--enrich-only');
if (enrichOnly) {
  console.log('Inferring vendor state/country from stored addresses…');
  console.log(JSON.stringify(await enrichStoredVendorPlaces(), null, 2));
} else {
  console.log('Syncing Zoho vendors into Firestore…');
  const result = await syncZohoVendorsToFirestore(loadZohoSecrets(), orgId, { source: 'manual-script' });
  console.log(JSON.stringify(result, null, 2));
}
