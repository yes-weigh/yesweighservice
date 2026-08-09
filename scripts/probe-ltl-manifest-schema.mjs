import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getValidDelhiveryJwt } from '../functions/lib/delhivery-b2b.js';

const parsed = JSON.parse(readFileSync(
  process.env.GOOGLE_APPLICATION_CREDENTIALS
  || 'secrets/yesweigh-service-firebase-adminsdk-fbsvc-65d526cda5.json',
  'utf8',
));
initializeApp({ credential: cert(parsed), projectId: parsed.project_id });
const db = getFirestore();
const auth = await getValidDelhiveryJwt(db);
const host = 'https://ltl-clients-api.delhivery.com';

async function post(body) {
  const r = await fetch(`${host}/manifest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.jwt}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
}

const trials = [
  { freight_mode: 'fod' },
  { weight: 10, freight_mode: 'fod' },
  {
    weight: 10,
    shipment_details: {},
    freight_mode: 'fod',
  },
  {
    weight: 10,
    freight_mode: 'fod',
    shipment_details: [{}, {}],
  },
  {
    weight: 100,
    freight_mode: 'fod',
    payment_mode: 'Prepaid',
    shipment_details: {
      consignee: { name: 'Test' },
    },
  },
  {
    weight: 100,
    freight_mode: 'xxx',
    shipment_details: { x: 1 },
  },
];

for (const body of trials) {
  const r = await post(body);
  console.log('---', JSON.stringify(body).slice(0, 120));
  console.log(r.status, r.text.slice(0, 500));
}

// Also try GET endpoints that list manifests / jobs with freight mode
for (const path of [
  '/manifest?limit=5',
  '/manifests?limit=5',
  '/shipments?limit=5',
  '/lrn?limit=5',
  '/lrns?limit=5',
  '/jobs?limit=5',
  '/v2/manifest?job_id=1',
]) {
  const r = await fetch(host + path, {
    headers: { Authorization: `Bearer ${auth.jwt}`, Accept: 'application/json' },
  });
  const t = await r.text();
  if (r.status !== 404) console.log('GET', path, r.status, t.slice(0, 220).replace(/\s+/g, ' '));
}

// B2B manifest with freight_mode + required pickup to see if freight_mode is accepted
const b2bBody = {
  pickup_location: 'COCHIN',
  freight_mode: 'fod',
};
const b2b = await fetch('https://btob.api.delhivery.com/v2/manifest', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${auth.jwt}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(b2bBody),
});
console.log('b2b freight_mode', b2b.status, (await b2b.text()).slice(0, 400));
