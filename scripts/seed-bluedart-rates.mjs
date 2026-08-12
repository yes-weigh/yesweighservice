/**
 * Seed Blue Dart tariff + pin index into Firestore.
 *
 * AGENT — when ops share new Blue Dart Excels / rate cards:
 * 1. Put BdService workbook at repo root (or update extract script SRC path).
 * 2. Update defaultBlueDartConfig() BELOW to match new Air/Surface/DP/FS/CAF/EDL
 *    numbers (also update src/constants/blueDartRates.ts — same defaults).
 * 3. Run:
 *      set GOOGLE_APPLICATION_CREDENTIALS=secrets\<sa>.json
 *      npm run seed:bluedart
 *    Flags:
 *      --overwrite-rates  replace Firestore tariff (wipes admin UI overrides)
 *      --rates-only       skip pin batch
 *      --pins-only        skip tariff (after extract JSONL exists)
 * 4. Spot-check: npm run validate:bluedart
 * 5. Schema / quote rules: src/types/blue-dart-rates.ts + src/lib/blueDartQuote.ts
 *
 * Does not commit Excels or scripts/data/bluedart-pincodes.jsonl (gitignored).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PIN_JSONL = path.join(__dirname, 'data', 'bluedart-pincodes.jsonl');

const args = new Set(process.argv.slice(2));
const pinsOnly = args.has('--pins-only');
const ratesOnly = args.has('--rates-only');
const overwriteRates = args.has('--overwrite-rates');

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
    console.log(`Using credentials: ${path.relative(ROOT, credentialsPath)}`);
    return;
  }
  initializeApp({ credential: applicationDefault(), projectId: 'yesweigh-service' });
}

/** Mirrors src/constants/blueDartRates.ts defaults. */
function defaultBlueDartConfig() {
  const regionsByState = {};
  const add = (region, names) => {
    for (const name of names) regionsByState[name] = region;
  };
  add('NORTH', [
    'himachal pradesh', 'hp', 'punjab', 'haryana', 'uttarakhand', 'uttaranchal',
    'uttar pradesh', 'up', 'rajasthan', 'delhi', 'nct of delhi', 'chandigarh',
  ]);
  add('EAST', ['bihar', 'orissa', 'odisha', 'west bengal', 'jharkhand']);
  add('WEST', [
    'maharashtra', 'madhya pradesh', 'mp', 'gujarat', 'gujrat',
    'chhattisgarh', 'chattisgarh', 'goa', 'diu daman', 'daman diu',
  ]);
  add('SOUTH', [
    'karnataka', 'tamil nadu', 'tamilnadu', 'tn', 'kerala', 'kl',
    'andhra pradesh', 'telangana', 'pondicherry', 'puducherry', 'pondy', 'py',
  ]);
  add('NE', [
    'nagaland', 'mizoram', 'manipur', 'meghalaya', 'arunachal pradesh',
    'tripura', 'sikkim', 'assam',
  ]);
  add('JK', [
    'jammu', 'kashmir', 'ladakh', 'jammu and kashmir', 'jammu kashmir', 'jk',
  ]);

  const row = (n, e, w, s, ne, jk) => ({
    NORTH: n, EAST: e, WEST: w, SOUTH: s, NE: ne, JK: jk,
  });

  return {
    shared: {
      fuelSurchargePercent: 92,
      fuelB2bDiscountPercent: 10,
      cafPercent: 22,
      cafB2bDiscountPercent: 5,
      gstPercent: 0,
      originRegion: 'SOUTH',
      edlMode: 'flat_fallback',
      edlFlatFallbackInr: 0,
      edlNeJkPerKgInr: 15,
      edlNeJkFloorInr: 3000,
      edlBeyond500KmPerKmInr: 14,
      edlBeyond1500KgPerKgInr: 5,
      hideTemPer: true,
      rasPerKgInr: 3,
      rasStates: [
        'bihar', 'jharkhand', 'kerala', 'jammu', 'kashmir', 'ladakh', 'jammu and kashmir',
      ],
      fov: { minInr: 90, percentOfInvoice: 0.05 },
      regionsByState,
      zoneMatrix: {
        NORTH: row(1, 3, 2, 3, 5, 2),
        EAST: row(3, 1, 3, 4, 2, 5),
        WEST: row(2, 3, 1, 2, 5, 5),
        SOUTH: row(3, 4, 2, 1, 5, 5),
        NE: row(5, 2, 5, 5, 1, 5),
        JK: row(2, 5, 5, 5, 5, 1),
      },
      edlMatrix: [
        { distanceKmMin: 20, distanceKmMax: 50, amountsInr: [550, 990, 1100, 1375, 1650] },
        { distanceKmMin: 51, distanceKmMax: 100, amountsInr: [825, 1210, 1375, 1650, 1925] },
        { distanceKmMin: 101, distanceKmMax: 150, amountsInr: [1100, 1650, 1925, 2200, 2750] },
        { distanceKmMin: 151, distanceKmMax: 200, amountsInr: [1375, 1925, 2200, 2475, 3300] },
        { distanceKmMin: 201, distanceKmMax: 250, amountsInr: [1650, 2200, 2750, 3300, 3960] },
        { distanceKmMin: 250, distanceKmMax: 300, amountsInr: [1925, 2500, 3150, 3800, 4560] },
        { distanceKmMin: 300, distanceKmMax: 350, amountsInr: [2200, 2800, 3550, 4300, 5160] },
        { distanceKmMin: 350, distanceKmMax: 400, amountsInr: [2475, 3100, 3950, 4800, 5760] },
        { distanceKmMin: 400, distanceKmMax: 450, amountsInr: [2750, 3400, 4350, 5300, 6360] },
        { distanceKmMin: 450, distanceKmMax: 500, amountsInr: [3025, 3700, 4750, 5800, 6960] },
      ],
      productIds: {
        air: '99381000031970648',
        surface: '99381000031970559',
        domestic_priority: '99381000031970625',
      },
    },
    air: {
      perKgInr: { 1: 32, 2: 45, 3: 50, 4: 65, 5: 70 },
      minimumChargeableWeightKg: 5,
      minimumFreightInr: 260,
      docketFeeInr: 100,
      volumetricDivisor: 5000,
      fuelSurchargePercent: null,
      cafPercent: null,
      idcPercent: 5,
      efssPercent: 10,
      pssPercent: 5,
      rasPerKgInr: null,
      fov: null,
    },
    surface: {
      perKgInr: { 1: 8, 2: 9, 3: 11, 4: 12, 5: 19 },
      minimumChargeableWeightKg: 10,
      minimumFreightInr: 160,
      docketFeeInr: 100,
      volumetricDivisor: 4500,
      fuelSurchargePercent: 37,
      cafPercent: null,
      idcPercent: 0,
      efssPercent: 7,
      pssPercent: 0,
      rasPerKgInr: null,
      fov: null,
      festivalSurchargePercent: 3,
      festivalSeasonStartMonth: 9,
      festivalSeasonEndMonth: 12,
      oversizeSlabs: [
        { upToKg: 33, amountInr: 0 },
        { upToKg: 71, amountInr: 100 },
        { upToKg: 201, amountInr: 300 },
        { upToKg: 701, amountInr: 3500 },
      ],
      dieselB2bDiscountPercent: 10,
      eccPerShipmentInr: 125,
    },
    domestic_priority: {
      first500gInr: { A1: 28, A: 36, B: 41, C: 46 },
      addl500gInr: { A1: 28, A: 36, B: 41, C: 46 },
      volumetricDivisor: 5000,
      fuelSurchargePercent: null,
      cafPercent: null,
      idcPercent: 5,
      efssPercent: 10,
      pssPercent: 5,
    },
    source: {
      importedAt: new Date().toISOString(),
      bandLabel: 'Surface Band 13 (Apr 2026 FS / Surface rates.xlsx)',
      files: [
        'bddata/BdService (32).xlsx',
        'bddata/Surface rates.xlsx',
      ],
    },
  };
}

function isLegacyBlueDart(raw) {
  if (!raw || typeof raw !== 'object') return true;
  if (raw.shared && typeof raw.shared === 'object') return false;
  if (raw.air?.perKgInr || raw.surface?.perKgInr || raw.domestic_priority?.first500gInr) {
    return false;
  }
  return true;
}

async function seedRates(db) {
  const ref = db.doc('appSettings/logisticsCourierRates');
  const snap = await ref.get();
  const existing = snap.exists ? snap.data()?.bluedart : null;
  if (!overwriteRates && existing && !isLegacyBlueDart(existing)) {
    console.log('Blue Dart tariff already present — keeping overrides (use --overwrite-rates to replace).');
    // Still stamp source if missing
    if (!existing.source) {
      await ref.set({
        bluedart: { ...existing, source: defaultBlueDartConfig().source },
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
    return;
  }
  const config = defaultBlueDartConfig();
  await ref.set({
    bluedart: config,
    updatedAt: new Date().toISOString(),
    updatedBy: 'seed-bluedart-rates',
  }, { merge: true });
  console.log('Seeded logisticsCourierRates.bluedart (Air / Surface Band 13 / DP).');
}

async function seedPins(db) {
  if (!fs.existsSync(PIN_JSONL)) {
    console.error(`Missing ${PIN_JSONL}`);
    console.error('Run: python scripts/extract-bluedart-pincodes.py');
    process.exit(1);
  }
  const lines = fs.readFileSync(PIN_JSONL, 'utf8').split(/\r?\n/).filter(Boolean);
  console.log(`Importing ${lines.length} pincodes…`);
  let batch = db.batch();
  let ops = 0;
  let written = 0;
  for (const line of lines) {
    const doc = JSON.parse(line);
    const id = String(doc.pincode || '').replace(/\D/g, '');
    if (id.length !== 6) continue;
    batch.set(db.doc(`blueDartPincodes/${id}`), {
      ...doc,
      pincode: id,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    ops += 1;
    written += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
      process.stdout.write(`  ${written}/${lines.length}\r`);
    }
  }
  if (ops) await batch.commit();
  console.log(`\nWrote ${written} blueDartPincodes docs.`);
}

async function main() {
  initAdmin();
  const db = getFirestore();
  if (!pinsOnly) await seedRates(db);
  if (!ratesOnly) await seedPins(db);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
