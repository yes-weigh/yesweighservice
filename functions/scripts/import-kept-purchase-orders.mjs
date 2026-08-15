/**
 * Pull allowlisted older POs from Zoho into Firestore.
 *
 *   node functions/scripts/import-kept-purchase-orders.mjs
 *   node functions/scripts/import-kept-purchase-orders.mjs PO-00279 PO-00283
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import {
  importPurchaseOrdersByNumber,
  PURCHASE_ORDER_KEEP_NUMBERS,
} from '../lib/purchase-order-sync.js';

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

const numbers = process.argv.slice(2).filter(Boolean);
const wanted = numbers.length ? numbers : [...PURCHASE_ORDER_KEEP_NUMBERS];
const orgId = process.env.ZOHO_ORGANIZATION_ID?.trim() || readEnvFile().ZOHO_ORGANIZATION_ID || '';
const secrets = loadZohoSecrets();

console.log(`Importing ${wanted.join(', ')} from Zoho…`);
const results = await importPurchaseOrdersByNumber(secrets, orgId, wanted);
console.log(JSON.stringify(results, null, 2));
if (results.some(row => !row.ok)) process.exit(1);
