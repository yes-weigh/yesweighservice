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

const swRes = await fetch(`${host}/static/swagger.json`, { headers });
const swaggerText = await swRes.text();
writeFileSync('scripts/_probe-openapi.json', swaggerText);
const swagger = JSON.parse(swaggerText);
const paths = Object.keys(swagger.paths || {});
console.log('paths', paths.length);

const interesting = [];
for (const p of paths) {
  const blob = JSON.stringify(swagger.paths[p]);
  if (/freight_mode|bill_to|payment_mode|\bfod\b|\bfop\b|to_pay/i.test(blob) || /freight_mode|lrn|manifest|job|freight/i.test(p)) {
    interesting.push(p);
  }
}
console.log('interesting', interesting.length);
for (const p of interesting) console.log(p);

// Dump schemas/properties mentioning freight_mode
const dump = JSON.stringify(swagger);
const idx = [];
let from = 0;
while (true) {
  const i = dump.toLowerCase().indexOf('freight_mode', from);
  if (i < 0) break;
  idx.push(i);
  from = i + 1;
  if (idx.length > 40) break;
}
console.log('freight_mode occurrences', idx.length);
for (const i of idx.slice(0, 20)) {
  console.log('---', dump.slice(Math.max(0, i - 120), i + 180).replace(/\s+/g, ' '));
}

// Compare freight-breakup for known FOD vs a BTC booking
const fodLrn = '298645842';
const btcLrn = '298645000'; // may be invalid; we'll pick from firestore below
const bookings = await db.collection('logisticsBookings')
  .where('courier', '==', 'delhivery')
  .limit(20)
  .get();
const rows = bookings.docs.map((d) => {
  const x = d.data();
  return {
    id: d.id,
    lrn: String(x.lrn || x.courierLrNumber || x.awb || '').replace(/\D/g, ''),
    mode: x.freightBillingMode || x.courierFreight?.billingMode || null,
    inv: x.invoiceNumber || x.invoiceNo || null,
  };
}).filter((r) => r.lrn.length >= 8);
console.log('bookings', rows);

async function freightBreakup(lrn) {
  const r = await fetch(`${host}/lrn/freight-breakup?lrns=${lrn}`, { headers });
  const j = await r.json();
  const row = j?.data?.[lrn] || null;
  const meta = row?.fwd_price_breakup?.meta_charges || row?.fwd_price_breakup?.other_charges || null;
  return {
    status: r.status,
    total: row?.total,
    preTax: row?.fwd_price_breakup?.pre_tax_freight,
    meta,
    keys: row ? Object.keys(row) : [],
    breakupKeys: row?.fwd_price_breakup ? Object.keys(row.fwd_price_breakup) : [],
    raw: row,
  };
}

const fod = await freightBreakup(fodLrn);
writeFileSync('scripts/_probe-fod-breakup.json', JSON.stringify(fod, null, 2));
console.log('FOD breakup meta', JSON.stringify(fod.meta), 'keys', fod.keys, fod.breakupKeys);

for (const r of rows.filter((x) => x.lrn !== fodLrn).slice(0, 5)) {
  const b = await freightBreakup(r.lrn);
  console.log('BTC?', r.lrn, 'mode', r.mode, 'meta', JSON.stringify(b.meta), 'total', b.total);
  writeFileSync(`scripts/_probe-breakup-${r.lrn}.json`, JSON.stringify(b, null, 2));
}

// Probe job/LR detail endpoints from swagger
const detailPaths = interesting.filter((p) => /\{.*\}/.test(p) || /lrn|job|manifest/i.test(p));
for (const p of detailPaths.slice(0, 40)) {
  const resolved = p
    .replace('{lrn}', fodLrn)
    .replace('{lrns}', fodLrn)
    .replace('{job_id}', 'x')
    .replace('{jobId}', 'x')
    .replace('{mwbno}', '20560010118775')
    .replace('{awb}', '20560010118775');
  if (resolved.includes('{')) continue;
  try {
    const r = await fetch(`${host}${resolved}`, { headers });
    const t = await r.text();
    const hasMode = /freight_mode|"fod"|"fop"|bill_to|payment_mode/i.test(t);
    if (r.status !== 404 || hasMode) {
      console.log('GET', resolved, r.status, hasMode ? 'HAS_MODE' : 'no-mode', t.slice(0, 180).replace(/\s+/g, ' '));
      if (hasMode) writeFileSync(`scripts/_probe-detail-${fodLrn}.json`, t);
    }
  } catch (e) {
    console.log('GET fail', resolved, e.message);
  }
}
