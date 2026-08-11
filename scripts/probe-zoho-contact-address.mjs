/**
 * Probe Zoho contact detail + address APIs for a specific customer.
 * Uses gcloud secrets (yesweigh-service).
 *
 *   node scripts/probe-zoho-contact-address.mjs [contactId]
 */
import { execSync } from 'node:child_process';

const contactId = process.argv[2]?.trim() || '99381000006671202';
const orgId = process.env.ZOHO_ORGANIZATION_ID?.trim() || '60001225303';

function secret(name) {
  return execSync(
    `gcloud secrets versions access latest --secret=${name} --project=yesweigh-service`,
    { encoding: 'utf8' },
  ).trim();
}

const tokenBody = new URLSearchParams({
  refresh_token: secret('ZOHO_REFRESH_TOKEN'),
  client_id: secret('ZOHO_CLIENT_ID'),
  client_secret: secret('ZOHO_CLIENT_SECRET'),
  grant_type: 'refresh_token',
});

const tokenRes = await fetch('https://accounts.zoho.in/oauth/v2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: tokenBody,
});
const tokenPayload = await tokenRes.json();
if (!tokenRes.ok || tokenPayload.error) {
  console.error('Token failed:', tokenPayload);
  process.exit(1);
}

console.log('Scopes granted:', tokenPayload.scope || '(none in response)');

const token = tokenPayload.access_token;
const headers = {
  Authorization: `Zoho-oauthtoken ${token}`,
  'X-com-zoho-inventory-organizationid': orgId,
};

for (const path of [`/contacts/${contactId}`, `/contacts/${contactId}/address`]) {
  const url = `https://www.zohoapis.in/inventory/v1${path}?organization_id=${orgId}`;
  const res = await fetch(url, { headers });
  const payload = await res.json();
  console.log(`\n=== ${path} — HTTP ${res.status} ===`);
  console.log('code:', payload.code);
  console.log('message:', payload.message ?? '(none)');
  if (payload.contact) {
    console.log('contact:', payload.contact.contact_name);
    console.log('billing city:', payload.contact.billing_address?.city ?? '—');
    console.log('shipping city:', payload.contact.shipping_address?.city ?? '—');
  }
  if (Array.isArray(payload.addresses)) {
    console.log('additional addresses:', payload.addresses.length);
  }
}
