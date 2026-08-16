/**
 * Live probe one origin pin: Finder + waybill RegisterPickup, then cancel AWB.
 *
 *   node functions/scripts/probe-bluedart-pin.mjs 683103
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  lookupBlueDartPincodes,
  bookBlueDartShipment,
  cancelBlueDartWaybill,
} from '../lib/blue-dart-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const pin = String(process.argv[2] || '').replace(/\D/g, '').slice(0, 6);
if (pin.length !== 6) {
  console.error('Usage: node functions/scripts/probe-bluedart-pin.mjs <6-digit-pin>');
  process.exit(1);
}

function resolveCredentialsPath() {
  const fromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const adc = path.join(ROOT, 'functions', '.firebase-adc.json');
  if (fs.existsSync(adc)) return adc;
  const secretsDir = path.join(ROOT, 'secrets');
  if (!fs.existsSync(secretsDir)) return null;
  const sa = fs.readdirSync(secretsDir)
    .filter(name => name.endsWith('.json') && name.includes('firebase-adminsdk'))
    .sort()[0];
  return sa ? path.join(secretsDir, sa) : null;
}

const credentialsPath = resolveCredentialsPath();
if (credentialsPath) {
  const sa = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || 'yesweigh-service' });
} else {
  initializeApp({ credential: applicationDefault(), projectId: 'yesweigh-service' });
}

const db = getFirestore();
const settings = (await db.doc('appSettings/logisticsSettings').get()).data() || {};
const address = String(settings.fromAddresses?.cochin || '').trim()
  || `INTERWEIGHING PVT LTD Kalamassery Cochin ${pin}`;

console.log('\n=== finder ===');
const finder = await lookupBlueDartPincodes(db, [pin]);
const row = finder.results[0];
console.log({
  pin: row?.pin,
  ok: row?.ok,
  area: row?.areaCode || null,
  hub: row?.serviceCenterCode || null,
  place: row?.description || null,
  error: row?.error || null,
  accountOrigin: finder.account,
});

console.log(`\n=== waybill + pickup from ${pin} ===`);
try {
  const booked = await bookBlueDartShipment(db, {
    partnerId: 'bluedart_surface',
    shipFromSite: 'cochin',
    orderId: `YWPROBE${pin}${Date.now()}`.slice(0, 20),
    registerPickup: true,
    pdfOutputNotRequired: true,
    invoiceValueInr: 1000,
    freightBillingMode: 'btc',
    consignee: {
      name: 'YESWEIGH PROBE',
      phone: '8803333444',
      address: 'MG Road Bangalore Karnataka 560001',
      pincode: '560001',
    },
    originArea: process.argv[3] || undefined,
    returnAddress: {
      name: 'Kalamassery',
      phone: '8803333444',
      address,
      pincode: pin,
    },
    boxes: [{ lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 1, quantity: 1 }],
  });
  console.log({
    ok: booked.ok,
    awb: booked.awb,
    pickupRegistered: booked.pickupRegistered,
    pickupPin: booked.pickupPin,
    originArea: booked.originArea,
    pickupMessage: booked.pickupMessage || null,
  });
  if (booked.awb) {
    await cancelBlueDartWaybill(db, booked.awb);
    console.log(`cancelled AWB ${booked.awb}`);
  }
} catch (err) {
  console.log({ ok: false, error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
}
