/**
 * Live probe: Blue Dart Finder + pickup-at-site-address (no waybill).
 * Cancels any pickup token it creates.
 *
 *   node functions/scripts/probe-bluedart-site-pickup.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  lookupBlueDartPincodes,
  registerBlueDartPickupAtAddress,
  cancelBlueDartPickup,
  bookBlueDartShipment,
  cancelBlueDartWaybill,
} from '../lib/blue-dart-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function resolveCredentialsPath() {
  const fromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const adc = path.join(ROOT, 'functions', '.firebase-adc.json');
  if (fs.existsSync(adc)) return adc;
  const secretsDir = path.join(ROOT, 'secrets');
  if (fs.existsSync(secretsDir)) {
    const sa = fs.readdirSync(secretsDir)
      .filter(name => name.endsWith('.json') && name.includes('firebase-adminsdk'))
      .sort()[0];
    if (sa) return path.join(secretsDir, sa);
  }
  return null;
}

function initAdmin() {
  const credentialsPath = resolveCredentialsPath();
  if (credentialsPath) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
    const sa = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    initializeApp({ credential: cert(sa), projectId: sa.project_id || 'yesweigh-service' });
    return path.relative(ROOT, credentialsPath);
  }
  initializeApp({ credential: applicationDefault(), projectId: 'yesweigh-service' });
  return 'applicationDefault';
}

function pinFromText(raw) {
  const match = /\b(\d{6})\b/.exec(String(raw || ''));
  return match?.[1] || '';
}

function summarizeFinder(row) {
  if (!row) return { ok: false, error: 'no result' };
  return {
    pin: row.pin,
    ok: row.ok,
    area: row.areaCode || null,
    hub: row.serviceCenterCode || null,
    place: row.description || null,
    air: row.airOutbound === true,
    surface: row.surfaceOutbound === true,
    dp: row.dpOutbound === true,
    error: row.error || null,
  };
}

const creds = initAdmin();
const db = getFirestore();
console.log(`project yesweigh-service · creds ${creds}`);

const settings = (await db.doc('appSettings/logisticsSettings').get()).data() || {};
const secrets = (await db.doc('appSettings/blueDartSecrets').get()).data() || {};
const account = {
  originArea: String(secrets.originArea || settings.blueDart?.originArea || '').trim(),
  customerPincode: String(secrets.customerPincode || settings.blueDart?.customerPincode || '').replace(/\D/g, '').slice(0, 6),
  customerCodeSet: Boolean(String(secrets.customerCode || '').trim()),
  loginIdSet: Boolean(String(secrets.loginId || settings.blueDart?.loginId || '').trim()),
};
console.log('\n=== account (no secrets) ===');
console.log(account);

const sites = ['cochin', 'head_office'].map(id => {
  const address = String(settings.fromAddresses?.[id] || '').trim();
  const phone = String(settings.fromSiteContacts?.[id]?.phone || '').trim();
  return {
    id,
    address,
    phone,
    pin: pinFromText(address),
  };
});
console.log('\n=== sites ===');
for (const site of sites) {
  console.log({
    id: site.id,
    pin: site.pin,
    phoneSet: Boolean(site.phone),
    addressLines: site.address ? site.address.split(/\n/).length : 0,
  });
}

const pins = [...new Set([
  ...sites.map(site => site.pin).filter(Boolean),
  account.customerPincode,
].filter(Boolean))];

console.log('\n=== finder ===');
const finder = await lookupBlueDartPincodes(db, pins);
console.log('account from finder:', finder.account);
for (const row of finder.results) {
  console.log(summarizeFinder(row));
}

const pickupMs = Date.now() + (24 * 60 * 60 * 1000);
const pickupResults = [];
for (const site of sites) {
  if (!site.pin || !site.address) {
    pickupResults.push({ id: site.id, ok: false, error: 'missing site address/pin' });
    continue;
  }
  const area = finder.results.find(row => row.pin === site.pin)?.areaCode || account.originArea;
  console.log(`\n=== register pickup ${site.id} ${site.pin} ${area} ===`);
  try {
    const created = await registerBlueDartPickupAtAddress(db, {
      address: site.address,
      pincode: site.pin,
      area,
      phone: site.phone || '8803333444',
      contactName: 'YESWEIGH',
      productCode: 'E',
      pieceCount: 1,
      weightKg: 0.5,
      pickupMs,
      referenceNo: `YWPROBE${site.pin}`.slice(0, 20),
      remarks: `Probe ${site.id}`.slice(0, 30),
    });
    const row = {
      id: site.id,
      ok: created.ok,
      token: created.tokenNumber,
      status: created.raw?.Status || created.raw?.status || null,
    };
    console.log(row);
    if (created.tokenNumber) {
      try {
        await cancelBlueDartPickup(db, {
          tokenNumber: created.tokenNumber,
          pickupMs,
          remarks: 'YesWeigh probe cancel',
        });
        row.cancelled = true;
        console.log(`cancelled token ${created.tokenNumber}`);
      } catch (err) {
        row.cancelled = false;
        row.cancelError = err instanceof Error ? err.message : String(err);
        console.log('cancel failed:', row.cancelError);
      }
    }
    pickupResults.push(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log({ id: site.id, ok: false, error: message });
    pickupResults.push({ id: site.id, ok: false, error: message.slice(0, 240) });
  }
}

const destProbe = {
  name: 'YESWEIGH PROBE',
  phone: '8803333444',
  address: 'MG Road Bangalore Karnataka 560001',
  pincode: '560001',
};
const origins = [
  { id: 'cochin-683503', site: 'cochin', pin: '683503', address: sites.find(s => s.id === 'cochin')?.address },
  { id: 'head-office-682019', site: 'head_office', pin: '682019', address: sites.find(s => s.id === 'head_office')?.address },
  { id: 'account-682001', site: 'cochin', pin: '682001', address: sites.find(s => s.id === 'cochin')?.address },
];
const waybills = [];
for (const origin of origins) {
  if (!origin.address) continue;
  console.log(`\n=== waybill + pickup from ${origin.id} ===`);
  try {
    const booked = await bookBlueDartShipment(db, {
      partnerId: 'bluedart_surface',
      shipFromSite: origin.site,
      orderId: `YWPROBE${Date.now()}`.slice(0, 20),
      registerPickup: true,
      pdfOutputNotRequired: true,
      invoiceValueInr: 1000,
      freightBillingMode: 'btc',
      consignee: destProbe,
      returnAddress: {
        name: origin.id,
        phone: '8803333444',
        address: origin.address,
        pincode: origin.pin,
      },
      boxes: [{ lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 1, quantity: 1 }],
    });
    const row = {
      id: origin.id,
      ok: booked.ok,
      awb: booked.awb,
      pickupRegistered: booked.pickupRegistered,
      pickupPin: booked.pickupPin,
      originArea: booked.originArea,
      pickupToken: booked.pickupToken || null,
      pickupMessage: booked.pickupMessage || null,
    };
    console.log(row);
    if (booked.awb) {
      try {
        await cancelBlueDartWaybill(db, booked.awb);
        row.cancelled = true;
        console.log(`cancelled AWB ${booked.awb}`);
      } catch (err) {
        row.cancelled = false;
        row.cancelError = err instanceof Error ? err.message : String(err);
        console.log('cancel failed:', row.cancelError);
      }
    }
    waybills.push(row);
    if (row.ok) break;
  } catch (err) {
    const row = { id: origin.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    console.log(row);
    waybills.push(row);
  }
}

const workable = waybills.some(row => row.ok && row.pickupRegistered);
console.log('\n=== summary ===');
console.log({
  finderOk: finder.results.filter(row => row.ok).map(row => `${row.pin}:${row.areaCode}`),
  standalonePickupApi: pickupResults,
  waybillPickup: waybills,
  workable,
});
if (!workable) process.exitCode = 1;
