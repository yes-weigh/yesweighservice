/**
 * Seed Trackon / Phoenix Cargo tariff into Firestore.
 *
 * AGENT — when ops share a new Trackon quotation:
 * 1. Update defaultTrackonConfig() BELOW and src/constants/trackonRates.ts (keep in sync).
 * 2. Run:
 *      set GOOGLE_APPLICATION_CREDENTIALS=secrets\<sa>.json
 *      npm run seed:trackon
 *    Flags:
 *      --overwrite  replace Firestore tariff (wipes admin UI overrides)
 * 3. Schema / quote rules: src/types/trackon-rates.ts + src/lib/trackonQuote.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const overwrite = args.has('--overwrite') || args.has('--overwrite-rates');

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

function slabs(upTo250, upTo500, upTo1000) {
  return {
    upTo250gInr: upTo250,
    upTo500gInr: upTo500,
    upTo1000gInr: upTo1000,
    additionalPer500gInr: Math.max(0, upTo1000 - upTo500),
  };
}

/** Mirrors src/constants/trackonRates.ts — Phoenix Cargo Cochin, 27 Feb 2026. */
function defaultTrackonConfig() {
  return {
    shared: {
      fuelSurchargePercent: 15,
      volumetricDivisor: 5000,
      oversizedSideCm: 100,
      minimumChargeableKg: 4,
    },
    air: {
      destinations: {
        mumbai: slabs(45, 50, 110),
        delhi: slabs(45, 50, 120),
        andhra_pradesh: slabs(45, 55, 120),
        kolkata: slabs(55, 60, 150),
        northern_sectors: slabs(55, 60, 150),
      },
    },
    surface: {
      northern: {
        mumbai: { perKgInr: 55 },
        delhi: { perKgInr: 60 },
        andhra_pradesh: { perKgInr: 60 },
        northern_sectors: { perKgInr: 70 },
      },
      southern: {
        chennai: { perKgInr: 35 },
        bangalore: { perKgInr: 35 },
        coimbatore: { perKgInr: 35 },
        salem: { perKgInr: 35 },
        tamil_nadu: { perKgInr: 35 },
        karnataka: { perKgInr: 35 },
        kerala: { perKgInr: 17 },
        kerala_hilly: { perKgInr: 20 },
      },
    },
    source: {
      label: 'Phoenix Cargo — Trackon franchise (Cochin)',
      dated: '2026-02-27',
      notes: 'Quotation to M/S Interweighing Pvt Ltd, Cochin. Fuel 15%. Vol = L×B×H/5000; side >100 cm doubles vol. Surface min 4 kg.',
    },
  };
}

function isLegacyOrEmptyTrackon(raw) {
  if (!raw || typeof raw !== 'object') return true;
  if (raw.zones != null || raw.cochin != null || raw.head_office != null) return true;
  if (raw.air == null && raw.surface == null) return true;
  return false;
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const ref = db.doc('appSettings/logisticsCourierRates');
  const snap = await ref.get();
  const existing = snap.exists ? snap.data()?.trackon : null;
  const config = defaultTrackonConfig();

  if (existing && !isLegacyOrEmptyTrackon(existing) && !overwrite) {
    console.log('Trackon multi-mode tariff already present. Pass --overwrite to replace.');
    console.log(`Existing source: ${existing.source?.label || '(none)'} ${existing.source?.dated || ''}`);
    return;
  }

  const updatedAt = new Date().toISOString();
  await ref.set({
    trackon: config,
    updatedAt,
    updatedBy: 'seed-trackon-rates',
  }, { merge: true });

  console.log(`Seeded Trackon tariff (${overwrite ? 'overwrite' : 'fresh/legacy replace'}).`);
  console.log(`Source: ${config.source.label} · ${config.source.dated}`);
  console.log(`Air stations: ${Object.keys(config.air.destinations).length}`);
  console.log(`Surface north: ${Object.keys(config.surface.northern).length}`);
  console.log(`Surface south: ${Object.keys(config.surface.southern).length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
