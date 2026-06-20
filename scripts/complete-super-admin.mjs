/**
 * Complete a super-admin Firestore profile (bypasses client rules via Admin SDK).
 *
 * Usage:
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json
 *   node scripts/complete-super-admin.mjs <loginId> [displayName] [uid]
 *
 * If uid is omitted, looks up Auth user by internal email (aadhar/phone login).
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const AUTH_EMAIL_DOMAIN = 'yesweigh.auth';

function normalizeDigits(input) {
  return String(input ?? '').replace(/\D/g, '');
}

function parseLoginId(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return { type: 'email', value: email };
  }
  const digits = normalizeDigits(trimmed);
  if (digits.length === 12) return { type: 'aadhar', value: digits };
  if (digits.length === 10) return { type: 'phone', value: digits };
  return null;
}

function authEmailForLoginId(type, value) {
  if (type === 'email') return value;
  if (type === 'phone') return `p${value}@${AUTH_EMAIL_DOMAIN}`;
  return `${value}@${AUTH_EMAIL_DOMAIN}`;
}

function loginIndexDocId(type, value) {
  if (type === 'email') return `e_${value.toLowerCase()}`;
  if (type === 'phone') return `p_${value}`;
  return `a_${value}`;
}

function initAdmin() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    initializeApp({
      credential: cert(parsed),
      projectId: parsed.project_id || 'yesweigh-service',
      storageBucket: `${parsed.project_id || 'yesweigh-service'}.firebasestorage.app`,
    });
    return;
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: 'yesweigh-service',
    storageBucket: 'yesweigh-service.firebasestorage.app',
  });
}

const loginIdInput = process.argv[2] ?? '';
const displayName = process.argv[3] ?? 'YesWeigh Admin';
const uidArg = process.argv[4] ?? '';

const parsed = parseLoginId(loginIdInput);
if (!parsed) {
  console.error('Usage: node scripts/complete-super-admin.mjs <loginId> [displayName] [uid]');
  process.exit(1);
}

initAdmin();
const auth = getAuth();
const db = getFirestore();

const authEmail = authEmailForLoginId(parsed.type, parsed.value);
let uid = uidArg.trim();

if (!uid) {
  try {
    const user = await auth.getUserByEmail(authEmail);
    uid = user.uid;
  } catch {
    console.error(`Auth user not found for ${authEmail}. Run seed:admin first.`);
    process.exit(1);
  }
}

const profile = {
  loginId: parsed.value,
  loginIdType: parsed.type,
  displayName,
  role: 'super_admin',
  active: true,
  createdAt: new Date().toISOString(),
  createdByUid: 'admin-script',
};

if (parsed.type === 'aadhar') profile.aadhar = parsed.value;
if (parsed.type === 'phone') profile.phone = parsed.value;
if (parsed.type === 'email') profile.email = parsed.value;

await db.doc(`users/${uid}`).set(profile, { merge: true });
await db.doc(`loginIndex/${loginIndexDocId(parsed.type, parsed.value)}`).set({
  uid,
  role: 'super_admin',
  loginIdType: parsed.type,
  createdAt: new Date().toISOString(),
}, { merge: true });

console.log(`Super admin profile ready.`);
console.log(`  Login ID: ${parsed.value}`);
console.log(`  UID: ${uid}`);
