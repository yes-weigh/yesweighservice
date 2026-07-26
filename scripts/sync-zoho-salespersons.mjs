/**
 * Pull Zoho salespersons into Firestore (Admin SDK).
 *
 * Requires:
 *   GOOGLE_APPLICATION_CREDENTIALS (or Firebase CLI ADC)
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
 *   ZOHO_ORGANIZATION_ID (optional)
 *
 *   node scripts/sync-zoho-salespersons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(path.join(ROOT, 'functions', 'package.json'));
const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');

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

const secrets = {
  clientId: process.env.ZOHO_CLIENT_ID?.trim(),
  clientSecret: process.env.ZOHO_CLIENT_SECRET?.trim(),
  refreshToken: process.env.ZOHO_REFRESH_TOKEN?.trim(),
};

if (!secrets.clientId || !secrets.clientSecret || !secrets.refreshToken) {
  console.error('Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN');
  process.exit(1);
}

initFirebase();
const { syncZohoSalespersonsToFirestore } = await import('../functions/lib/zoho-salespersons.js');
const result = await syncZohoSalespersonsToFirestore(
  secrets,
  process.env.ZOHO_ORGANIZATION_ID?.trim() || '60001225303',
);
console.log(JSON.stringify({
  count: result.count,
  removed: result.removed,
  organizationId: result.organizationId,
  sample: result.salespersons.slice(0, 5).map(s => ({ id: s.id, name: s.name })),
}, null, 2));
