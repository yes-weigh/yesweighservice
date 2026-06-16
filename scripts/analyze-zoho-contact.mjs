/**
 * Compare Zoho contact list vs detail payloads against what we store in Firestore.
 *
 * PowerShell:
 *   $env:ZOHO_CLIENT_ID="..."
 *   $env:ZOHO_CLIENT_SECRET="..."
 *   $env:ZOHO_REFRESH_TOKEN="..."
 *   $env:ZOHO_ORGANIZATION_ID="60001225303"   # optional
 *   node scripts/analyze-zoho-contact.mjs
 *   node scripts/analyze-zoho-contact.mjs 460000000026049   # specific contact id
 */

const clientId = process.env.ZOHO_CLIENT_ID?.trim();
const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
const refreshToken = process.env.ZOHO_REFRESH_TOKEN?.trim();
let organizationId = process.env.ZOHO_ORGANIZATION_ID?.trim() || '';
const accountsUrl = process.env.ZOHO_ACCOUNTS_URL?.trim() || 'https://accounts.zoho.in';
const apiBase = process.env.ZOHO_API_BASE?.trim() || 'https://www.zohoapis.in/inventory/v1';
const contactIdArg = process.argv[2]?.trim();

/** Fields we currently persist from Zoho on bulk sync (functions/lib/zoho-customers.js) */
const STORED_FROM_ZOHO = [
  'id',
  'contactName',
  'companyName',
  'email',
  'phone',
  'mobile',
  'firstName',
  'status',
  'outstandingReceivable',
  'unusedCredits',
  'syncedAt',
];

/** Detail-only fields we partially use in location backfill */
const PARTIALLY_USED_DETAIL = [
  'billing_address.state / state_code',
  'billing_address.city / shipping_address.city → district',
  'billing_address.zip / shipping_address.zip → zipCode',
];

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function formatAddress(addr) {
  if (!addr || typeof addr !== 'object') return null;
  const parts = [
    addr.attention,
    addr.address,
    addr.street2,
    addr.city,
    addr.state || addr.state_code,
    addr.zip,
    addr.country,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

if (!clientId || !clientSecret || !refreshToken) {
  fail('Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN.');
}

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
  fail(`Token refresh failed: ${tokenPayload.error || tokenPayload.message || tokenRes.statusText}`);
}
const accessToken = tokenPayload.access_token;

if (!organizationId) {
  const orgRes = await fetch(`${apiBase}/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const orgPayload = await orgRes.json();
  organizationId = String(orgPayload.organizations?.[0]?.organization_id || '');
  if (!organizationId) fail('No organization found.');
}

const headers = {
  Authorization: `Zoho-oauthtoken ${accessToken}`,
  'X-com-zoho-inventory-organizationid': organizationId,
};

let contactId = contactIdArg;
let listSample = null;

if (!contactId) {
  const listUrl = new URL(`${apiBase}/contacts`);
  listUrl.searchParams.set('organization_id', organizationId);
  listUrl.searchParams.set('contact_type', 'customer');
  listUrl.searchParams.set('per_page', '1');
  const listRes = await fetch(listUrl, { headers });
  const listPayload = await listRes.json();
  if (listPayload.code !== 0) fail(listPayload.message || 'List contacts failed');
  listSample = listPayload.contacts?.[0] ?? null;
  contactId = listSample ? String(listSample.contact_id) : null;
}

if (!contactId) fail('No customer contacts returned from Zoho.');

const detailUrl = `${apiBase}/contacts/${contactId}?organization_id=${organizationId}`;
const detailRes = await fetch(detailUrl, { headers });
const detailPayload = await detailRes.json();
if (detailPayload.code !== 0) fail(detailPayload.message || 'Contact detail failed');
const contact = detailPayload.contact;

const listKeys = listSample ? Object.keys(listSample).sort() : [];
const detailKeys = Object.keys(contact).sort();
const detailOnlyKeys = listSample
  ? detailKeys.filter(k => !listKeys.includes(k))
  : detailKeys;

console.log('\n=== Zoho customer field analysis ===\n');
console.log(`Organization : ${organizationId}`);
console.log(`Contact ID   : ${contactId}`);
console.log(`Name         : ${contact.contact_name || contact.company_name}\n`);

console.log('--- LIST /contacts (what bulk sync uses today) ---');
console.log(`Fields returned (${listKeys.length}): ${listKeys.join(', ') || '(not fetched — pass contact id only)'}\n`);

console.log('--- DETAIL /contacts/{id} (full record) ---');
console.log(`Fields returned (${detailKeys.length}):\n${detailKeys.join(', ')}\n`);

console.log('--- Detail-only fields (NOT in list API) ---');
console.log(detailOnlyKeys.length ? detailOnlyKeys.join(', ') : '(none)\n');

console.log('--- India-relevant fields on detail ---');
const indiaFields = {
  gst_no: contact.gst_no ?? null,
  gst_treatment: contact.gst_treatment ?? null,
  place_of_contact: contact.place_of_contact ?? null,
  pan: contact.pan_no ?? contact.pan ?? null,
  legal_name: contact.legal_name ?? null,
  billing_address: contact.billing_address ?? null,
  shipping_address: contact.shipping_address ?? null,
};
console.log(JSON.stringify(indiaFields, null, 2));

console.log('\n--- Formatted addresses ---');
console.log('Billing :', formatAddress(contact.billing_address) ?? '—');
console.log('Shipping:', formatAddress(contact.shipping_address) ?? '—');

console.log('\n--- What we STORE from Zoho today ---');
console.log(STORED_FROM_ZOHO.join(', '));

console.log('\n--- What we DROP (available on detail, not stored) ---');
const dropped = [
  'gst_no',
  'gst_treatment',
  'place_of_contact',
  'legal_name',
  'billing_address (full)',
  'shipping_address (full)',
  'contact_persons[]',
  'custom_fields[]',
  'payment_terms / currency_code',
  'website',
  'notes',
  'created_time / last_modified_time',
  'tax_id / tax_name / tax_percentage',
  'facebook / twitter',
  'primary_contact_id',
  'is_linked_with_zohocrm',
  'documents (if any)',
];
console.log(dropped.join('\n'));

console.log('\n--- Partially used (backfill only) ---');
console.log(PARTIALLY_USED_DETAIL.join('\n'));

if (contact.contact_persons?.length) {
  console.log('\n--- contact_persons[0] keys ---');
  console.log(Object.keys(contact.contact_persons[0]).join(', '));
}

if (contact.custom_fields?.length) {
  console.log('\n--- custom_fields ---');
  for (const cf of contact.custom_fields) {
    console.log(`  ${cf.label ?? cf.api_name ?? 'field'}: ${cf.value ?? ''}`);
  }
}

console.log('\nDone. Full detail JSON written to analyze-zoho-contact-output.json');
await import('node:fs/promises').then(fs =>
  fs.writeFile(
    'analyze-zoho-contact-output.json',
    JSON.stringify({ listSample, contact }, null, 2),
    'utf8',
  ),
);
