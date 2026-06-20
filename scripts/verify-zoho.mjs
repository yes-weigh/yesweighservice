/**
 * Verify Zoho credentials locally (values stay on your machine).
 *
 * PowerShell:
 *   $env:ZOHO_CLIENT_ID="..."
 *   $env:ZOHO_CLIENT_SECRET="..."
 *   $env:ZOHO_REFRESH_TOKEN="..."
 *   $env:ZOHO_ORGANIZATION_ID="60001225303"   # optional
 *   node scripts/verify-zoho.mjs
 */

const clientId = process.env.ZOHO_CLIENT_ID?.trim();
const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
const refreshToken = process.env.ZOHO_REFRESH_TOKEN?.trim();
const organizationId = process.env.ZOHO_ORGANIZATION_ID?.trim() || '';
const accountsUrl = process.env.ZOHO_ACCOUNTS_URL?.trim() || 'https://accounts.zoho.in';
const apiBase = process.env.ZOHO_API_BASE?.trim() || 'https://www.zohoapis.in/inventory/v1';

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✓ ${message}`);
}

if (!clientId || !clientSecret || !refreshToken) {
  fail('Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN environment variables.');
}

console.log('Checking Zoho Inventory credentials…\n');
console.log(`  Accounts URL : ${accountsUrl}`);
console.log(`  API base     : ${apiBase}`);
console.log(`  Client ID    : ${clientId.slice(0, 6)}…${clientId.slice(-4)}`);
console.log(`  Org ID       : ${organizationId || '(auto-detect)'}\n`);

const tokenBody = new URLSearchParams({
  refresh_token: refreshToken,
  client_id: clientId,
  client_secret: clientSecret,
  grant_type: 'refresh_token',
});

const tokenRes = await fetch(`${accountsUrl}/oauth/v2/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: tokenBody,
});

const tokenPayload = await tokenRes.json();
if (!tokenRes.ok || tokenPayload.error) {
  fail(
    `Token refresh failed: ${tokenPayload.error || tokenPayload.message || tokenRes.statusText}\n` +
      '  → Check client ID, client secret, refresh token, and data center (.in vs .com).',
  );
}

ok(`Access token received (expires in ${tokenPayload.expires_in_sec || tokenPayload.expires_in || '?'}s)`);

const accessToken = tokenPayload.access_token;
let orgId = organizationId;

if (!orgId) {
  const orgRes = await fetch(`${apiBase}/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const orgPayload = await orgRes.json();
  if (!orgRes.ok || (orgPayload.code !== undefined && orgPayload.code !== 0)) {
    fail(`Could not list organizations: ${orgPayload.message || orgRes.statusText}`);
  }
  const orgs = orgPayload.organizations ?? [];
  if (!orgs.length) fail('No Zoho Inventory organizations found on this account.');
  orgId = String(orgs[0].organization_id);
  ok(`Auto-detected organization: ${orgs[0].name} (${orgId})`);
} else {
  ok(`Using organization ID: ${orgId}`);
}

async function probe(path, label) {
  const url = new URL(`${apiBase}${path}`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('per_page', '1');

  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const payload = await res.json();
  if (!res.ok || (payload.code !== undefined && payload.code !== 0)) {
    fail(`${label} failed: ${payload.message || res.statusText}\n  → Refresh token may lack ZohoInventory.items.READ scope.`);
  }
  return payload;
}

const itemsPayload = await probe('/items', 'Items API');
const groupsPayload = await probe('/itemgroups', 'Item groups API');
const invoicesPayload = await probe('/invoices', 'Invoices API');

const itemCount = itemsPayload.page_context?.total ?? itemsPayload.items?.length ?? 0;
const groupCount = groupsPayload.page_context?.total ?? groupsPayload.itemgroups?.length ?? 0;
const invoiceCount = invoicesPayload.page_context?.total ?? invoicesPayload.invoices?.length ?? 0;

ok(`Items API reachable (${itemCount} item(s) reported)`);
ok(`Item groups API reachable (${groupCount} group(s) reported)`);
ok(`Invoices API reachable (${invoiceCount} invoice(s) reported)`);

const firstInvoiceId = invoicesPayload.invoices?.[0]?.invoice_id;
if (firstInvoiceId) {
  const detailUrl = new URL(`${apiBase}/invoices/${firstInvoiceId}`);
  detailUrl.searchParams.set('organization_id', orgId);
  const detailRes = await fetch(detailUrl, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const detailPayload = await detailRes.json();
  if (!detailRes.ok || (detailPayload.code !== undefined && detailPayload.code !== 0)) {
    fail(
      `Invoice detail API failed: ${detailPayload.message || detailRes.statusText}\n` +
        '  → Refresh token may lack ZohoInventory.invoices.READ scope (code 57 = missing scope or wrong data center).',
    );
  }
  ok(`Invoice detail API reachable (invoice ${firstInvoiceId})`);
}

console.log('\nAll checks passed. Your Zoho credentials and org ID look correct.');
console.log('\nNext: deploy functions so the Products page can use these credentials:');
console.log('  firebase deploy --only functions --project yesweigh-service');
