/**
 * Seed Blue Dart APIGEE credentials into Firestore (Admin SDK only).
 * Reads secrets/BlueDartAPI.json — never commit that file.
 *
 *   node scripts/seed-bluedart-secrets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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

const cfg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'secrets', 'BlueDartAPI.json'), 'utf8'),
);
const prod = cfg.production || {};
const profile = cfg.profile || {};
const apigee = cfg.apigee || {};

const loginId = String(prod.Login_id || profile.Login_id || '').trim();
const customerCode = String(prod.CustomerCode || profile.CustomerCode || '').trim();
const originArea = String(prod.OriginArea || profile.OriginArea || '').trim();
const customerPincode = String(prod.CustomerPincode || profile.CustomerPincode || '').replace(/\D/g, '').slice(0, 6);
const customerName = String(cfg.Customer_Name || '').trim();
const now = new Date().toISOString();

initAdmin();
const db = getFirestore();

await db.doc('appSettings/blueDartSecrets').set({
  loginId,
  customerCode,
  originArea,
  customerPincode,
  customerName,
  clientId: String(apigee.ClientID || '').trim(),
  clientSecret: String(apigee.ClientSecret || '').trim(),
  shippingLicenseKey: String(prod.Shipping_License_key || '').trim(),
  trackingLicenseKey: String(prod.Tracking_License_key || '').trim(),
  sandboxLicenseKey: String(profile.License_key || '').trim(),
  updatedAt: now,
  updatedBy: 'seed-bluedart-secrets',
}, { merge: true });

await db.doc('appSettings/logisticsSettings').set({
  blueDart: {
    env: 'production',
    loginId,
    customerCode,
    originArea,
    customerPincode,
    customerName,
    clientSecretSet: Boolean(String(apigee.ClientSecret || '').trim()),
    shippingLicenseSet: Boolean(String(prod.Shipping_License_key || '').trim()),
    trackingLicenseSet: Boolean(String(prod.Tracking_License_key || '').trim()),
    sandboxLicenseSet: Boolean(String(profile.License_key || '').trim()),
    lastTestAt: '',
    lastTestOk: false,
    lastTestMessage: '',
    updatedAt: now,
    updatedBy: 'seed-bluedart-secrets',
  },
  updatedAt: now,
  updatedBy: 'seed-bluedart-secrets',
}, { merge: true });

await db.doc('appSettings/blueDartAuth').set({
  env: 'production',
  loginId,
  clearedAt: now,
}, { merge: true });

console.log('Saved Blue Dart secrets (Admin SDK) + public logisticsSettings.blueDart:', {
  env: 'production',
  loginId,
  customerCode,
  originArea,
  customerPincode,
  clientSecretSet: true,
  shippingLicenseSet: true,
  trackingLicenseSet: true,
  sandboxLicenseSet: true,
});
