import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getValidDelhiveryJwt, delhiveryB2bFetch } from '../functions/lib/delhivery-b2b.js';

const parsed = JSON.parse(readFileSync(
  process.env.GOOGLE_APPLICATION_CREDENTIALS
  || 'secrets/yesweigh-service-firebase-adminsdk-fbsvc-65d526cda5.json',
  'utf8',
));
initializeApp({ credential: cert(parsed), projectId: parsed.project_id });
const db = getFirestore();
const auth = await getValidDelhiveryJwt(db);

const estimateBody = {
  source_pin: '682024',
  consignee_pin: '799144',
  inv_amount: 33040,
  weight_g: 100000,
  dimensions: [{ box_count: 1, length_cm: 50, width_cm: 40, height_cm: 40 }],
  payment_mode: 'prepaid',
  freight_mode: 'fod',
};

for (const mode of ['fod', 'fop']) {
  const r = await fetch('https://ltl-clients-api.delhivery.com/freight/estimate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.jwt}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...estimateBody, freight_mode: mode }),
  });
  const text = await r.text();
  console.log('estimate', mode, r.status, text.slice(0, 600));
  writeFileSync(`scripts/_probe-estimate-${mode}.json`, text);
}

const docsHtml = await (await fetch('https://ltl-clients-api.delhivery.com/v1/docs', {
  headers: { Authorization: `Bearer ${auth.jwt}` },
})).text();
writeFileSync('scripts/_probe-ltl-docs.html', docsHtml);

for (const path of [
  '/v1/docs/swagger.json',
  '/v1/openapi.json',
  '/v1/swagger.json',
  '/openapi.json',
  '/openapi.yaml',
  '/v1/docs/openapi.json',
  '/static/swagger.json',
  '/v1/docs/swagger.yaml',
]) {
  const r = await fetch(`https://ltl-clients-api.delhivery.com${path}`, {
    headers: { Authorization: `Bearer ${auth.jwt}`, Accept: 'application/json' },
  });
  const text = await r.text();
  console.log(path, r.status, text.slice(0, 80).replace(/\s+/g, ' '));
  if (r.status === 200 && /freight_mode|paths/i.test(text)) {
    writeFileSync('scripts/_probe-openapi.json', text);
    console.log('saved openapi, size', text.length);
    const pathMatches = text.match(/\/[a-zA-Z0-9_\-/{}.]*lrn[a-zA-Z0-9_\-/{}.]*/g) || [];
    console.log('lrn-related paths', [...new Set(pathMatches)].slice(0, 50));
    const freightMatches = text.match(/\/[a-zA-Z0-9_\-/{}.]*freight[a-zA-Z0-9_\-/{}.]*/g) || [];
    console.log('freight paths', [...new Set(freightMatches)].slice(0, 50));
  }
}

// Candidate GET endpoints that might return freight_mode for an LR
const lrn = '298645842';
const mwb = '20560010118775';
const getCandidates = [
  `/lrn/${lrn}`,
  `/lrn/${lrn}/details`,
  `/v1/lrn/${lrn}`,
  `/v2/lrn/${lrn}`,
  `/shipment/${lrn}`,
  `/shipments/${lrn}`,
  `/lrn/details?lrn=${lrn}`,
  `/lrn/details?lrns=${lrn}`,
  `/lrn/info?lrn=${lrn}`,
  `/lrn/info?lrns=${lrn}`,
  `/lrn/get_details?lrn=${lrn}`,
  `/lrn/get_details?lrns=${lrn}`,
  `/lrn/summary?lrns=${lrn}`,
  `/document/lrn?lrns=${lrn}`,
  `/lrn/freight-breakup?lrns=${lrn}&include_freight_mode=true`,
  `/lrn/freight-breakup?lrns=${lrn}&detailed=1`,
  `/track/lrn?lrns=${lrn}`,
  `/track?lrn=${lrn}`,
  `/mwb/${mwb}`,
  `/master_waybill/${mwb}`,
];

for (const path of getCandidates) {
  const r = await fetch(`https://ltl-clients-api.delhivery.com${path}`, {
    headers: { Authorization: `Bearer ${auth.jwt}`, Accept: 'application/json' },
  });
  const text = await r.text();
  if (r.status === 200 || /freight_mode|"fod"|"fop"/i.test(text)) {
    console.log('CANDIDATE', r.status, path, text.slice(0, 350).replace(/\s+/g, ' '));
  }
}

// Manifest schema probe with freight_mode
const manifest = await delhiveryB2bFetch(db, '/v2/manifest', {
  method: 'POST',
  body: {
    pickup_location: 'INVALID_TEST_ONLY',
    drop_location: {
      name: 'x', phone: '9999999999', address: 'x', city: 'x', state: 'x', country: 'India', pin: 110001,
    },
    d_mode: 'Surface',
    amount: 100,
    weight: 1,
    box_count: 1,
    dimensions: [{ box_count: 1, length: 10, width: 10, height: 10, weight: 1, ident: 'BOX1' }],
    products_desc: 'test',
    cod_amount: 0,
    tax_value: 0,
    payment_mode: 'Prepaid',
    freight_mode: 'fod',
    invoice_number: 'TEST',
    invoice_date: '09/08/2026',
    order: `TEST-FOD-PROBE-${Date.now()}`,
  },
});
console.log('manifest freight_mode fod', manifest.status, JSON.stringify(manifest.json)?.slice(0, 500));
