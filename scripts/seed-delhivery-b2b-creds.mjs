/**
 * Seed Delhivery B2B staging credentials from secrets/delhiverycreds.json
 * into Firestore (Admin SDK). Password lands in appSettings/delhiveryB2bSecrets.
 *
 *   node scripts/seed-delhivery-b2b-creds.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(path.join(ROOT, 'functions', 'package.json'));
const { initializeApp, cert, applicationDefault, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

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
  if (getApps().length) return;
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

const credsPath = path.join(ROOT, 'secrets', 'delhiverycreds.json');
const raw = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
const username = String(raw.B2B_API_uid || raw.username || '').trim();
const password = String(raw.B2B_API_password || raw.password || '');
if (!username || !password) {
  throw new Error('secrets/delhiverycreds.json needs B2B_API_uid and B2B_API_password');
}

initAdmin();
const db = getFirestore();
const now = new Date().toISOString();

await db.doc('appSettings/delhiveryB2bSecrets').set({
  username,
  password,
  updatedAt: now,
  updatedBy: 'seed-delhivery-b2b-creds',
}, { merge: true });

await db.doc('appSettings/logisticsSettings').set({
  delhiveryB2b: {
    env: 'staging',
    username,
    passwordSet: true,
    pickupLocationBySite: {
      cochin: '',
      head_office: '',
    },
    lastTestAt: '',
    lastTestOk: false,
    lastTestMessage: '',
    clientName: '',
    updatedAt: now,
    updatedBy: 'seed-delhivery-b2b-creds',
  },
  updatedAt: now,
}, { merge: true });

const loginRes = await fetch('https://btob-api-dev.delhivery.com/ums/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ username, password }),
});
const loginJson = await loginRes.json();
const jwt = loginJson?.jwt || loginJson?.data?.jwt;
if (!loginRes.ok || !jwt) {
  console.error('Seeded Firestore but staging login failed:', loginJson);
  process.exitCode = 1;
} else {
  await db.doc('appSettings/logisticsSettings').set({
    delhiveryB2b: {
      lastTestAt: now,
      lastTestOk: true,
      lastTestMessage: `Seeded + login ok as ${username}`,
      passwordSet: true,
      username,
      env: 'staging',
      updatedAt: now,
    },
  }, { merge: true });
  console.log('Seeded Delhivery B2B staging credentials for', username);
}
