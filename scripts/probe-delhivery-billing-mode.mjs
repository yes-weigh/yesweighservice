/**
 * Probe Delhivery APIs for FOD vs BTC billing fields on known LRs.
 */
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

function deepFind(obj, path = '', hits = [], depth = 0) {
  if (obj == null || depth > 8) return hits;
  if (typeof obj !== 'object') {
    const text = `${path} ${obj}`;
    if (/fod|fop|btc|bill.?to|freight.?mode|shipment.?type|billing|payee|payer|collect.?freight/i.test(text)) {
      hits.push([path, obj]);
    }
    return hits;
  }
  if (Array.isArray(obj)) {
    obj.slice(0, 30).forEach((v, i) => deepFind(v, `${path}[${i}]`, hits, depth + 1));
    return hits;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (/freight_mode|billing|bill_to|fod|fop|payment_mode|shipment_type|charge_type|payee|payer/i.test(k)) {
      hits.push([p, typeof v === 'object' ? JSON.stringify(v)?.slice(0, 240) : v]);
    }
    deepFind(v, p, hits, depth + 1);
  }
  return hits;
}

const samples = [
  { label: 'fod-claimed', lrn: '298645842', mwb: '20560010118775' },
  { label: 'btc-control', lrn: '298833418', mwb: '20560010118230' },
];

const report = [];

for (const sample of samples) {
  const entry = { ...sample, probes: [] };

  // 1) LTL freight
  {
    const r = await fetch(
      `https://ltl-clients-api.delhivery.com/lrn/freight-breakup?lrns=${sample.lrn}`,
      { headers: { Authorization: `Bearer ${auth.jwt}`, Accept: 'application/json' } },
    );
    const json = await r.json();
    entry.probes.push({
      name: 'ltl-freight-breakup',
      status: r.status,
      hits: deepFind(json).slice(0, 40),
      topKeys: Object.keys(json?.data?.[sample.lrn] || {}),
    });
    writeFileSync(`scripts/_probe-freight-${sample.lrn}.json`, JSON.stringify(json, null, 2));
  }

  // 2) Express packages
  {
    const r = await fetch(
      `https://track.delhivery.com/api/v1/packages/json/?waybill=${sample.mwb}`,
      { headers: { Authorization: `Bearer ${auth.jwt}`, Accept: 'application/json' } },
    );
    const json = await r.json();
    entry.probes.push({
      name: 'express-packages',
      status: r.status,
      hits: deepFind(json).slice(0, 40),
      orderType: json?.ShipmentData?.[0]?.Shipment?.OrderType,
      statusInstr: json?.ShipmentData?.[0]?.Shipment?.Status?.Instructions,
    });
    writeFileSync(`scripts/_probe-express-${sample.lrn}.json`, JSON.stringify(json, null, 2));
  }

  // 3) B2B track/lr
  {
    const r = await delhiveryB2bFetch(db, '/v2/track/lr', {
      method: 'GET',
      query: { lrn: sample.lrn },
    });
    entry.probes.push({
      name: 'btob-track-lr',
      status: r.status,
      hits: deepFind(r.json).slice(0, 40),
      body: JSON.stringify(r.json)?.slice(0, 300),
    });
  }

  // 4) Candidate LTL detail endpoints (may 401)
  for (const path of [
    `/lrn/details?lrns=${sample.lrn}`,
    `/lrn/info?lrns=${sample.lrn}`,
    `/v1/lrn/${sample.lrn}`,
    `/document/lrn?lrns=${sample.lrn}`,
  ]) {
    const r = await fetch(`https://ltl-clients-api.delhivery.com${path}`, {
      headers: { Authorization: `Bearer ${auth.jwt}`, Accept: 'application/json' },
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    if (r.status === 200 || /fod|freight_mode|bill_to|shipment_type/i.test(text)) {
      entry.probes.push({
        name: `ltl${path}`,
        status: r.status,
        hits: deepFind(json).slice(0, 40),
        body: text.slice(0, 300),
      });
    }
  }

  report.push(entry);
  console.log(JSON.stringify(entry, null, 2));
}

writeFileSync('scripts/_probe-billing-report.json', JSON.stringify(report, null, 2));
console.log('Wrote scripts/_probe-billing-report.json');
