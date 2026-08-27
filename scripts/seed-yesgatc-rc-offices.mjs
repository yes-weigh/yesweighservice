/**
 * Seed official dealer RCs into Firestore `yesgatcRcOffices`.
 *
 *   node scripts/seed-yesgatc-rc-offices.mjs
 *
 * Uses a service account when present; otherwise the logged-in Firebase CLI user.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { YESGATC_DEALER_RC_OFFICES, YESGATC_RC_OFFICES } from '../functions/lib/yesgatc-rc-offices.js';
import { clientId as firebaseCliClientId, clientSecret as firebaseCliClientSecret } from 'firebase-tools/lib/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROJECT = 'yesweigh-service';
const FIRESTORE_BASE =
  `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

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

function str(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeCode(value) {
  return str(value).toUpperCase();
}

function rcCodesFromDoc(id, data) {
  const raw = data.raw && typeof data.raw === 'object' && !Array.isArray(data.raw) ? data.raw : {};
  const nested = [raw.rc, raw.rcOffice, raw.regionalCenter, raw.rcDetail, raw.office]
    .find(item => item && typeof item === 'object' && !Array.isArray(item)) || {};
  return [...new Set([
    id,
    data.code,
    data.rcCode,
    raw.code,
    raw.rcCode,
    raw.rc_code,
    nested.code,
    nested.rcCode,
  ].map(normalizeCode).filter(Boolean))];
}

function tryInitAdmin() {
  const credentialsPath = resolveCredentialsPath();
  if (credentialsPath) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
    const sa = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT });
    console.log(`Using credentials: ${path.relative(ROOT, credentialsPath)}`);
    return true;
  }
  try {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT });
    return true;
  } catch {
    return false;
  }
}

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (value && typeof value === 'object' && value._serverTimestamp) {
    return { timestampValue: new Date().toISOString() };
  }
  return { stringValue: String(value) };
}

function encodeFields(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, encodeValue(value)]),
  );
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {});
  return null;
}

function decodeFields(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => [key, decodeValue(value)]),
  );
}

function readFirebaseCliTokens() {
  const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
  if (!fs.existsSync(configPath)) return null;
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return cfg.tokens || null;
}

async function firebaseCliAccessToken() {
  const tokens = readFirebaseCliTokens();
  if (tokens?.access_token && Number(tokens.expires_at) > Date.now() + 60_000) {
    return tokens.access_token;
  }
  if (!tokens?.refresh_token) {
    throw new Error('Firebase CLI is not logged in. Run firebase login, then retry.');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: firebaseCliClientId(),
      client_secret: firebaseCliClientSecret(),
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const payload = await res.json();
  if (!res.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || 'Could not refresh Firebase CLI access token.');
  }
  return payload.access_token;
}

async function firestoreRest(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message || `${method} ${url} failed (${res.status})`);
  }
  return payload;
}

async function listCollectionRest(token, collectionId) {
  const rows = [];
  let pageToken = '';
  do {
    const url = new URL(`${FIRESTORE_BASE}/${collectionId}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await firestoreRest(token, 'GET', url);
    for (const doc of payload.documents || []) {
      const id = String(doc.name || '').split('/').pop() || '';
      rows.push({ id, data: decodeFields(doc.fields) });
    }
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return rows;
}

function indexExisting(rcRows, linkRows) {
  const rcsByCode = new Map();
  for (const row of rcRows) {
    for (const code of rcCodesFromDoc(row.id, row.data || {})) {
      if (!rcsByCode.has(code)) rcsByCode.set(code, row);
    }
  }
  const linksByRcId = new Map();
  const linksByCode = new Map();
  for (const row of linkRows) {
    const data = row.data || {};
    const link = {
      dealerId: str(data.dealerId) || null,
      dealerName: str(data.dealerName) || null,
    };
    linksByRcId.set(row.id, link);
    const code = normalizeCode(data.rcCode);
    if (code) linksByCode.set(code, link);
  }
  return { rcsByCode, linksByRcId, linksByCode };
}

function officePayload(office, source, link) {
  return {
    ...office,
    sourceRcId: source?.id || null,
    dealerId: link?.dealerId || null,
    dealerName: link?.dealerName || null,
    updatedBy: 'seed-yesgatc-rc-offices',
  };
}

function logOffice(office, source, link) {
  console.log(
    `${office.code}  ${office.name}`
    + (office.place ? `  · ${office.place}` : '')
    + (source ? `  · rc ${source.id}` : '')
    + (link?.dealerName ? `  · ${link.dealerName}` : ''),
  );
}

async function seedWithAdmin() {
  const db = getFirestore();
  const [rcSnap, linkSnap] = await Promise.all([
    db.collection('yesgatcRcDetails').get(),
    db.collection('yesgatcRcDealerLinks').get(),
  ]);
  const { rcsByCode, linksByRcId, linksByCode } = indexExisting(
    rcSnap.docs.map(row => ({ id: row.id, data: row.data() || {} })),
    linkSnap.docs.map(row => ({ id: row.id, data: row.data() || {} })),
  );
  for (const office of YESGATC_DEALER_RC_OFFICES) {
    const source = rcsByCode.get(office.code) || null;
    const link = (source && linksByRcId.get(source.id)) || linksByCode.get(office.code) || null;
    await db.collection(YESGATC_RC_OFFICES).doc(office.code).set({
      ...officePayload(office, source, link),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    logOffice(office, source, link);
  }
}

async function seedWithCliRest() {
  const token = await firebaseCliAccessToken();
  console.log('Using Firebase CLI login');
  const [rcRows, linkRows] = await Promise.all([
    listCollectionRest(token, 'yesgatcRcDetails'),
    listCollectionRest(token, 'yesgatcRcDealerLinks'),
  ]);
  const { rcsByCode, linksByRcId, linksByCode } = indexExisting(rcRows, linkRows);
  for (const office of YESGATC_DEALER_RC_OFFICES) {
    const source = rcsByCode.get(office.code) || null;
    const link = (source && linksByRcId.get(source.id)) || linksByCode.get(office.code) || null;
    const data = {
      ...officePayload(office, source, link),
      updatedAt: { _serverTimestamp: true },
    };
    const mask = Object.keys(data).map(field => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&');
    await firestoreRest(
      token,
      'PATCH',
      `${FIRESTORE_BASE}/${YESGATC_RC_OFFICES}/${office.code}?${mask}`,
      { fields: encodeFields(data) },
    );
    logOffice(office, source, link);
  }
}

async function main() {
  if (tryInitAdmin()) {
    try {
      await seedWithAdmin();
      console.log(`Wrote ${YESGATC_DEALER_RC_OFFICES.length} dealer RC offices to ${YESGATC_RC_OFFICES}`);
      return;
    } catch (err) {
      const message = String(err?.message || err);
      if (!/Could not load the default credentials|UNAUTHENTICATED/i.test(message)) {
        throw err;
      }
      console.log('Admin credentials unavailable; falling back to Firebase CLI login.');
    }
  }
  await seedWithCliRest();
  console.log(`Wrote ${YESGATC_DEALER_RC_OFFICES.length} dealer RC offices to ${YESGATC_RC_OFFICES}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
