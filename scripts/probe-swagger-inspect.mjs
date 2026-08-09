import { readFileSync, writeFileSync } from 'node:fs';
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
const headers = {
  Authorization: `Bearer ${auth.jwt}`,
  Accept: 'application/json',
};

const t = readFileSync('scripts/_probe-openapi.json', 'utf8');
console.log('len', t.length);
console.log(t.slice(0, 400));
console.log('freight_mode count', (t.match(/freight_mode/gi) || []).length);
console.log('paths key', t.includes('"paths"'));
console.log('swagger', t.includes('swagger'));

// Re-fetch and also get docs HTML for script src
const docs = await (await fetch(`${host}/v1/docs`, { headers })).text();
writeFileSync('scripts/_probe-ltl-docs.html', docs);
const scriptSrcs = [...docs.matchAll(/src=["']([^"']+)["']/g)].map((m) => m[1]);
console.log('script srcs', scriptSrcs.slice(0, 20));

for (const src of scriptSrcs) {
  const url = src.startsWith('http') ? src : new URL(src, host + '/v1/docs').href;
  if (!/swagger|openapi|spec|bundle|redoc/i.test(url) && !url.endsWith('.json')) continue;
  try {
    const r = await fetch(url, { headers });
    const body = await r.text();
    console.log('asset', r.status, url.slice(0, 120), body.slice(0, 80).replace(/\s+/g, ' '));
    if (r.status === 200 && body.length > 1000) {
      writeFileSync('scripts/_probe-docs-asset.json', body.slice(0, 5_000_000));
      console.log('freight_mode in asset', (body.match(/freight_mode/gi) || []).length);
      const pathHits = body.match(/\/[a-zA-Z0-9_\-/{}.]*(?:lrn|freight|manifest|job)[a-zA-Z0-9_\-/{}.]*/g) || [];
      console.log('path-like', [...new Set(pathHits)].slice(0, 60));
    }
  } catch (e) {
    console.log('asset fail', url, e.message);
  }
}

// Common LTL paths from Delhivery docs / community
const fodLrn = '298645842';
const candidates = [
  `/lrn/${fodLrn}`,
  `/lrn/info?lrn=${fodLrn}`,
  `/lrn/details?lrn=${fodLrn}`,
  `/v1/lrn/${fodLrn}`,
  `/v2/lrn/${fodLrn}`,
  `/v2/track/lr?lrn=${fodLrn}`,
  `/track/lr?lrn=${fodLrn}`,
  `/shipment/details?lrn=${fodLrn}`,
  `/shipments/info?lrn=${fodLrn}`,
  `/fm/shipment/${fodLrn}`,
  `/lm/shipment/${fodLrn}`,
  `/packing/slip?lrn=${fodLrn}`,
  `/label?lrn=${fodLrn}`,
  `/lrn/label?lrn=${fodLrn}`,
  `/lrn/print?lrn=${fodLrn}`,
  `/lrn/status?lrn=${fodLrn}`,
  `/lrn/charges?lrn=${fodLrn}`,
  `/charges?lrn=${fodLrn}`,
  `/billing/lrn?lrn=${fodLrn}`,
  `/billing/details?lrn=${fodLrn}`,
  `/invoice/lrn?lrn=${fodLrn}`,
  `/nsl?lrn=${fodLrn}`,
  `/hq/lrn/${fodLrn}`,
  `/cm/lrn/${fodLrn}`,
  `/api/lrn/${fodLrn}`,
  `/lr/${fodLrn}`,
  `/lr/details?lrn=${fodLrn}`,
  `/lrn/fetch?lrns=${fodLrn}`,
  `/lrn/get?lrn=${fodLrn}`,
  `/lrn/list?lrns=${fodLrn}`,
  `/lrns?lrn=${fodLrn}`,
  `/lrns/${fodLrn}`,
  `/manifest/details?lrn=${fodLrn}`,
  `/job/details?lrn=${fodLrn}`,
  `/cargo/lrn/${fodLrn}`,
  `/b2b/lrn/${fodLrn}`,
  `/client/lrn/${fodLrn}`,
  `/client/shipments?lrn=${fodLrn}`,
];

for (const path of candidates) {
  const r = await fetch(host + path, { headers });
  const body = await r.text();
  const modeHit = /freight_mode|"fod"|"fop"|bill_to_client|bill_to_consignee/i.test(body);
  if (r.status !== 404 || modeHit) {
    console.log(r.status, modeHit ? 'MODE' : '----', path, body.slice(0, 160).replace(/\s+/g, ' '));
    if (modeHit) writeFileSync(`scripts/_probe-mode-hit.json`, body);
  }
}

// Also try POST detail-style endpoints
const posts = [
  ['/lrn/details', { lrn: fodLrn }],
  ['/lrn/info', { lrns: [fodLrn] }],
  ['/lrn/fetch', { lrns: [fodLrn] }],
  ['/shipment/get', { lrn: fodLrn }],
  ['/shipments/details', { lrns: [fodLrn] }],
  ['/freight/details', { lrn: fodLrn }],
  ['/billing/details', { lrn: fodLrn }],
];
for (const [path, body] of posts) {
  const r = await fetch(host + path, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  const modeHit = /freight_mode|"fod"|"fop"|bill_to/i.test(text);
  if (r.status !== 404 || modeHit) {
    console.log('POST', r.status, modeHit ? 'MODE' : '----', path, text.slice(0, 180).replace(/\s+/g, ' '));
    if (modeHit) writeFileSync('scripts/_probe-mode-hit-post.json', text);
  }
}

// Firestore bookings via partnerId
const snap = await db.collection('logisticsBookings').where('partnerId', '==', 'delhivery').get();
console.log('delhivery bookings', snap.size);
for (const d of snap.docs) {
  const x = d.data();
  console.log(d.id, x.consignmentNo, x.freightBillingMode, x.invoiceNumber || x.invoiceNo);
}
