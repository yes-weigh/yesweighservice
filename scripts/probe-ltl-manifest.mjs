import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getValidDelhiveryJwt } from '../functions/lib/delhivery-b2b.js';
import { delhiveryLtlBaseUrl } from '../functions/lib/delhivery-freight.js';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || 'secrets/yesweigh-service-firebase-adminsdk-fbsvc-65d526cda5.json';
const parsed = JSON.parse(readFileSync(credPath, 'utf8'));
initializeApp({ credential: cert(parsed), projectId: parsed.project_id });
const db = getFirestore();
const auth = await getValidDelhiveryJwt(db, { force: true });
const url = `${delhiveryLtlBaseUrl(auth.env)}/manifest`;

const dropoff = {
  consignee_name: 'MEEZAN ELECTRONIC SCALES PRIVATE LIMITED',
  address: '8/308A Meezan Tower, Calicut Road, Manjeri, Kerala 676121',
  city: 'Manjeri',
  state: 'Kerala',
  zip: '676121',
  phone: '9446157730',
  email: 'test@example.com',
};
const billing = {
  name: 'INTERWEIGHING B2B',
  company: 'INTERWEIGHING SYSTEMS',
  consignor: 'INTERWEIGHING SYSTEMS',
  address: 'Cochin warehouse Vyttila',
  city: 'Ernakulam',
  state: 'Kerala',
  pin: '682019',
  phone: '9446157730',
  gst_number: '32AAFCI1950F1ZZ',
};
const returnAddr = {
  name: 'INTERWEIGHING B2B',
  phone: '9446157730',
  address: 'Cochin warehouse Vyttila',
  city: 'Ernakulam',
  state: 'Kerala',
  zip: '682019',
};

async function post(label, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.jwt}`, Accept: 'application/json' },
    body: form,
  });
  const text = await res.text();
  console.log(`\n== ${label} -> ${res.status}`);
  console.log(text.slice(0, 800));
  return { label, status: res.status, text };
}

const oid = Date.now();
const fields = {
  pickup_location_name: 'INTERWEIGHING B2B',
  payment_mode: 'prepaid',
  weight: '5000',
  freight_mode: process.argv.includes('--btc') ? 'fop' : 'fod',
  fm_pickup: 'True',
  rov_insurance: 'False',
  dropoff_location: JSON.stringify(dropoff),
  shipment_details: JSON.stringify([{
    order_id: `YW-OK-${oid}`,
    box_count: 1,
    description: 'Weighing equipment',
    weight: 5000,
  }]),
  invoices: JSON.stringify([{
    inv_num: `YES/LTL/${String(oid).slice(-6)}`,
    inv_amt: 1950,
    ewaybill: '',
  }]),
  dimensions: JSON.stringify([{ length: 40, width: 30, height: 20, box_count: 1 }]),
  billing_address: JSON.stringify(billing),
  return_address: JSON.stringify(returnAddr),
};

const r1 = await post('BTC with GST', fields);
let jobId = null;
try {
  const j = JSON.parse(r1.text);
  jobId = j?.data?.job_id || j?.job_id || j?.data?.jobId || null;
  console.log('parsed', { success: j?.success, jobId, message: j?.error?.message || j?.message });
} catch {
  // ignore
}

if (jobId) {
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${url}?job_id=${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${auth.jwt}`, Accept: 'application/json' },
    });
    const text = await res.text();
    console.log(`poll ${i} ${res.status}`, text.slice(0, 500));
    if (/(lrn|lr_number|fail|error|complete|success)/i.test(text) && !/processing|pending|queued/i.test(text)) {
      writeFileSync('scripts/_probe-ltl-manifest-success.json', text);
      break;
    }
  }
} else {
  writeFileSync('scripts/_probe-ltl-manifest-err.json', r1.text);
}
