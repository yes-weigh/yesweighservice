/**
 * Post-deploy invoice backfill for GitHub Actions.
 * Reads Zoho credentials from Secret Manager via the service account JSON.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { syncInvoicesToFirestore } from '../lib/invoice-sync.js';

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const orgId = process.env.ZOHO_ORGANIZATION_ID?.trim();

if (!credentialsPath) {
  console.log('Skipping invoice sync: GOOGLE_APPLICATION_CREDENTIALS not set.');
  process.exit(0);
}

if (!orgId) {
  console.error('ZOHO_ORGANIZATION_ID is required for invoice sync.');
  process.exit(1);
}

try {
  const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  const projectId = parsed.project_id || 'yesweigh-service';
  initializeApp({
    credential: cert(parsed),
    storageBucket: `${projectId}.firebasestorage.app`,
  });

  const client = new SecretManagerServiceClient();

  async function readSecret(name) {
    const [version] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/${name}/versions/latest`,
    });
    return version.payload?.data?.toString('utf8')?.trim() ?? '';
  }

  const [clientId, clientSecret, refreshToken] = await Promise.all([
    readSecret('ZOHO_CLIENT_ID'),
    readSecret('ZOHO_CLIENT_SECRET'),
    readSecret('ZOHO_REFRESH_TOKEN'),
  ]);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('One or more Zoho secrets are empty in Secret Manager.');
  }

  const result = await syncInvoicesToFirestore(
    { clientId, clientSecret, refreshToken },
    orgId,
    { skipPdfs: false, concurrency: 3, delayMs: 400 },
  );

  console.log(
    `Invoice sync complete: ${result.syncedCount} synced, ${result.failedCount} failed, ${result.totalListed} listed.`,
  );
} catch (err) {
  console.error('Invoice sync failed:', err instanceof Error ? err.message : err);
  console.error('Deploy succeeded; run syncZohoInvoices manually from Firebase or re-run this script.');
  process.exit(0);
}
