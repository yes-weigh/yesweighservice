/**
 * Post-deploy catalog sync for GitHub Actions.
 * Reads Zoho credentials from Secret Manager via the service account JSON.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { syncCatalogToFirestore } from '../lib/catalog-sync.js';

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const orgId = process.env.ZOHO_ORGANIZATION_ID?.trim();

if (!credentialsPath) {
  console.log('Skipping catalog sync: GOOGLE_APPLICATION_CREDENTIALS not set.');
  console.log('Token-only deploys can sync manually from Products → Sync from Zoho.');
  process.exit(0);
}

if (!orgId) {
  console.error('ZOHO_ORGANIZATION_ID is required for catalog sync.');
  process.exit(1);
}

try {
  const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  initializeApp({ credential: cert(parsed) });

  const client = new SecretManagerServiceClient();
  const projectId = parsed.project_id || 'yesweigh-service';

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

  const result = await syncCatalogToFirestore(
    { clientId, clientSecret, refreshToken },
    orgId,
    { skipNewImages: false },
  );

  console.log(
    `Catalog sync complete: ${result.syncedCount} products, ${result.categoryCount} categories.`,
  );
} catch (err) {
  console.error('Catalog sync failed:', err instanceof Error ? err.message : err);
  console.error('Deploy succeeded; sync manually from Products → Sync from Zoho.');
  process.exit(0);
}
