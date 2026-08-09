import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  getValidDelhiveryJwt,
  delhiveryB2bFetch,
  loadDelhiveryB2bPublicConfig,
  delhiveryB2bBaseUrl,
} from '../functions/lib/delhivery-b2b.js';

const parsed = JSON.parse(readFileSync(
  process.env.GOOGLE_APPLICATION_CREDENTIALS
  || 'secrets/yesweigh-service-firebase-adminsdk-fbsvc-65d526cda5.json',
  'utf8',
));
initializeApp({ credential: cert(parsed), projectId: parsed.project_id });
const db = getFirestore();
const auth = await getValidDelhiveryJwt(db);
const cfg = await loadDelhiveryB2bPublicConfig(db);
const ltl = 'https://ltl-clients-api.delhivery.com';
const b2b = delhiveryB2bBaseUrl(cfg.env);
console.log('b2b base', b2b, 'env', cfg.env);

const estimateBase = {
  source_pin: '682024',
  consignee_pin: '799144',
  inv_amount: 33040,
  weight_g: 100000,
  dimensions: [{ box_count: 1, length_cm: 50, width_cm: 40, height_cm: 40 }],
  payment_mode: 'prepaid',
};

async function postLtl(path, body) {
  const r = await fetch(ltl + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.jwt}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, text };
}

// Estimate variants
for (const variant of [
  { label: 'no freight_mode', body: { ...estimateBase } },
  { label: 'freight_mode null omitted', body: { ...estimateBase } },
  { label: 'fod', body: { ...estimateBase, freight_mode: 'fod' } },
  { label: 'fop', body: { ...estimateBase, freight_mode: 'fop' } },
  { label: 'btc', body: { ...estimateBase, freight_mode: 'btc' } },
  { label: 'prepaid freight', body: { ...estimateBase, freight_mode: 'prepaid' } },
  { label: 'bill_to client', body: { ...estimateBase, bill_to: 'client' } },
  { label: 'bill_to consignee', body: { ...estimateBase, bill_to: 'consignee' } },
]) {
  const r = await postLtl('/freight/estimate', variant.body);
  let summary = r.text.slice(0, 220);
  try {
    const j = JSON.parse(r.text);
    const meta = j?.data?.price_breakup?.meta_charges;
    summary = JSON.stringify({
      success: j.success,
      err: j.error?.message,
      total: j.data?.total,
      to_pay: meta?.to_pay,
      pre_tax: j.data?.price_breakup?.pre_tax_freight_charges,
    });
  } catch { /* keep */ }
  console.log('estimate', variant.label, r.status, summary);
}

// Probe manifest schema: intentionally incomplete to see permitted fields mentioning freight_mode
const hosts = [
  { name: 'ltl', base: ltl },
  { name: 'b2b', base: b2b },
];
for (const h of hosts) {
  for (const path of ['/v2/manifest', '/manifest', '/v1/manifest', '/cargo/manifest']) {
    const r = await fetch(h.base + path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.jwt}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ freight_mode: 'fod' }),
    });
    const text = await r.text();
    console.log(h.name, path, r.status, text.slice(0, 280).replace(/\s+/g, ' '));
  }
}

// Try update endpoints that might set freight mode on existing LR
const fodLrn = '298645842';
for (const [path, body] of [
  ['/lrn/update', { lrn: fodLrn, freight_mode: 'fod' }],
  ['/lrn/edit', { lrn: fodLrn, freight_mode: 'fod' }],
  ['/shipment/update', { lrn: fodLrn, freight_mode: 'fod' }],
  ['/v2/shipment/update', { lrn: fodLrn, freight_mode: 'fod' }],
  ['/manifest/update', { lrn: fodLrn, freight_mode: 'fod' }],
]) {
  for (const h of hosts) {
    const r = await fetch(h.base + path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.jwt}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (r.status !== 404) {
      console.log('update', h.name, path, r.status, text.slice(0, 220).replace(/\s+/g, ' '));
    }
  }
}

writeFileSync('scripts/_probe-estimate-fod.json', (await postLtl('/freight/estimate', { ...estimateBase, freight_mode: 'fod' })).text);
writeFileSync('scripts/_probe-estimate-default.json', (await postLtl('/freight/estimate', estimateBase)).text);
