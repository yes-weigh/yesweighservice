/**
 * Can we infer FOD vs BTC by comparing freight-breakup actuals
 * to /freight/estimate with freight_mode=fod vs default?
 */
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
  'Content-Type': 'application/json',
};

function pinFromAddress(addr) {
  const m = String(addr || '').match(/\b(\d{6})\b/);
  return m?.[1] || '';
}

async function freightBreakup(lrn) {
  const r = await fetch(`${host}/lrn/freight-breakup?lrns=${lrn}`, {
    headers: { Authorization: headers.Authorization, Accept: 'application/json' },
  });
  const j = await r.json();
  return j?.data?.[lrn] || null;
}

async function estimate({ sourcePin, destPin, invAmount, weightG, dims, freightMode }) {
  const body = {
    source_pin: sourcePin,
    consignee_pin: destPin,
    inv_amount: invAmount,
    weight_g: weightG,
    dimensions: dims,
    payment_mode: 'prepaid',
    ...(freightMode ? { freight_mode: freightMode } : {}),
  };
  const r = await fetch(`${host}/freight/estimate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return {
    ok: Boolean(j.success),
    error: j.error?.message || null,
    total: j.data?.total ?? null,
    preTax: j.data?.price_breakup?.pre_tax_freight_charges ?? null,
    toPay: j.data?.price_breakup?.meta_charges?.to_pay ?? null,
    chargedWt: j.data?.charged_wt ?? null,
  };
}

const snap = await db.collection('logisticsBookings').where('partnerId', '==', 'delhivery').get();
const rows = [];

for (const doc of snap.docs) {
  const d = doc.data();
  const lrn = String(d.consignmentNo || '').trim();
  if (!lrn) continue;
  const sourcePin = pinFromAddress(d.shipFromAddress) || '682024';
  const destPin = pinFromAddress(d.deliveryAddress?.full || d.deliveryAddress?.address || d.dealerSnapshot?.shippingAddress) || '';
  const invAmount = Number(d.invoiceValueInr || d.invoiceAmount || d.amount || 0) || 1000;
  const boxes = Array.isArray(d.boxes) ? d.boxes : [];
  const dims = boxes.length
    ? boxes.map((b) => ({
      box_count: Math.max(1, Number(b.quantity) || 1),
      length_cm: Number(b.lengthCm) || 30,
      width_cm: Number(b.widthCm) || 30,
      height_cm: Number(b.heightCm) || 30,
    }))
    : [{ box_count: Number(d.numberOfBoxes) || 1, length_cm: 30, width_cm: 30, height_cm: 30 }];
  const chargedKg = Number(d.courierFreight?.chargedWeightKg || d.chargeableWeightKg || d.actualWeightKg || 0);
  const weightG = Math.max(1000, Math.round((chargedKg || 10) * 1000));

  const actual = await freightBreakup(lrn);
  if (!destPin) {
    rows.push({ id: doc.id, lrn, skip: 'no dest pin', mode: d.freightBillingMode });
    continue;
  }
  const btcEst = await estimate({
    sourcePin, destPin, invAmount, weightG, dims, freightMode: null,
  });
  const fodEst = await estimate({
    sourcePin, destPin, invAmount, weightG, dims, freightMode: 'fod',
  });

  const actualTotal = actual?.total ?? null;
  const actualPre = actual?.fwd_price_breakup?.pre_tax_freight ?? null;
  const dBtc = actualTotal != null && btcEst.total != null ? Math.abs(actualTotal - btcEst.total) : null;
  const dFod = actualTotal != null && fodEst.total != null ? Math.abs(actualTotal - fodEst.total) : null;
  let inferred = null;
  if (dBtc != null && dFod != null) {
    if (dFod + 25 < dBtc) inferred = 'fod';
    else if (dBtc + 25 < dFod) inferred = 'btc';
    else inferred = 'ambiguous';
  }

  rows.push({
    id: doc.id,
    lrn,
    stored: d.freightBillingMode || null,
    inv: d.invoiceNumber,
    sourcePin,
    destPin,
    weightG,
    invAmount,
    actualTotal,
    actualPre,
    actualMeta: actual?.fwd_price_breakup?.meta_charges || null,
    btcEst,
    fodEst,
    dBtc,
    dFod,
    inferred,
  });
}

writeFileSync('scripts/_probe-infer-fod.json', JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 2));
