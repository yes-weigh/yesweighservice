import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getValidDelhiveryJwt } from '../functions/lib/delhivery-b2b.js';
import {
  inferDelhiveryFreightBillingMode,
  fetchDelhiveryFreightCharges,
} from '../functions/lib/delhivery-freight.js';

const parsed = JSON.parse(readFileSync(
  process.env.GOOGLE_APPLICATION_CREDENTIALS
  || 'secrets/yesweigh-service-firebase-adminsdk-fbsvc-65d526cda5.json',
  'utf8',
));
initializeApp({ credential: cert(parsed), projectId: parsed.project_id });
const db = getFirestore();
const auth = await getValidDelhiveryJwt(db);

const mwb = '20560010118856';
const snap = await db.collection('logisticsBookings')
  .where('partnerId', '==', 'delhivery')
  .get();
const booking = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  .find(d => String(d.consignmentNo) === mwb
    || String(d.trackingNo) === mwb
    || String(d.masterAwb) === mwb
    || String(d.courierTrack?.masterAwb) === mwb
    || String(d.courierTrack?.awb) === mwb);

if (!booking) {
  console.log('booking not found for', mwb);
  process.exit(1);
}

const lrn = String(booking.consignmentNo || '').replace(/\D/g, '');
console.log('booking', booking.id, 'lrn', lrn, 'storedMode', booking.freightBillingMode, booking.freightBillingModeSource);

const freight = await fetchDelhiveryFreightCharges(db, [lrn]);
const entry = freight.byLrn[lrn];
console.log('freight', JSON.stringify({
  ok: entry?.ok,
  total: entry?.totalInr,
  preTax: entry?.breakup?.preTaxFreight,
  billingMode: entry?.billingMode,
}, null, 2));

const inferred = await inferDelhiveryFreightBillingMode(db, booking, entry?.totalInr);
console.log('inferred', inferred);

// Express packages for MWB
const ex = await fetch(`https://track.delhivery.com/api/v1/packages/json/?waybill=${mwb}`, {
  headers: { Authorization: `Token unused`, Accept: 'application/json' },
});
// try LTL track variants
const host = 'https://ltl-clients-api.delhivery.com';
for (const path of [
  `/lrn/${lrn}`,
  `/v2/track/lr?lrn=${lrn}`,
  `/lrn/freight-breakup?lrns=${lrn}`,
]) {
  const r = await fetch(host + path, {
    headers: { Authorization: `Bearer ${auth.jwt}`, Accept: 'application/json' },
  });
  const t = await r.text();
  const hit = /freight_mode|"fod"|"fop"|bill_to|payment_mode|OrderType/i.test(t);
  console.log(path, r.status, hit ? 'HIT' : 'no', t.slice(0, 220).replace(/\s+/g, ' '));
  if (hit) writeFileSync(`scripts/_probe-mode-${lrn}.json`, t);
}

writeFileSync('scripts/_probe-infer-refresh.json', JSON.stringify({ bookingId: booking.id, lrn, entry, inferred }, null, 2));
