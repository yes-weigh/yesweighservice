/**
 * Creates the first super admin (Firebase Auth + Firestore profile).
 *
 * Usage:
 *   npm run seed:admin -- <loginId> <password> [displayName]
 *
 * loginId: email, 10-digit phone, or 12-digit Aadhaar
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBiLI--JR640YlXb2uiuBrLJ83XtFMPncE',
  authDomain: 'yesweigh-service.firebaseapp.com',
  projectId: 'yesweigh-service',
  storageBucket: 'yesweigh-service.firebasestorage.app',
  messagingSenderId: '108990753929',
  appId: '1:108990753929:web:564393f84ecd0347c3aa58',
};

const AUTH_EMAIL_DOMAIN = 'yesweigh.auth';

function normalizeDigits(input) {
  return String(input ?? '').replace(/\D/g, '');
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function parseLoginId(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    const email = normalizeEmail(trimmed);
    if (!isValidEmail(email)) return null;
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
  if (type === 'email') return `e_${normalizeEmail(value)}`;
  if (type === 'phone') return `p_${value}`;
  return `a_${value}`;
}

const loginIdInput = process.argv[2] ?? '';
const password = process.argv[3] ?? '';
const displayName = process.argv[4] ?? 'YesWeigh Admin';

const parsed = parseLoginId(loginIdInput);
if (!parsed || !password) {
  console.error('Usage: npm run seed:admin -- <loginId> <password> [displayName]');
  console.error('  loginId: email, 10-digit phone, or 12-digit Aadhaar');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const authEmail = authEmailForLoginId(parsed.type, parsed.value);

console.log(`Creating super admin (${parsed.type}: ${parsed.value})...`);

let cred;
try {
  cred = await createUserWithEmailAndPassword(auth, authEmail, password);
  console.log('Auth user created.');
} catch (err) {
  const code = err?.code ?? '';
  if (code === 'auth/email-already-in-use') {
    console.log('Auth user exists — signing in to ensure Firestore profile...');
    cred = await signInWithEmailAndPassword(auth, authEmail, password);
  } else {
    throw err;
  }
}

const uid = cred.user.uid;
const existing = await getDoc(doc(db, 'users', uid));
if (existing.exists() && (existing.data()?.role === 'super_admin' || existing.data()?.role === 'admin')) {
  console.log('Super admin profile already exists.');
  process.exit(0);
}

const profile = {
  loginId: parsed.value,
  loginIdType: parsed.type,
  displayName,
  role: 'super_admin',
  active: true,
  createdAt: new Date().toISOString(),
  createdByUid: 'seed-script',
  clearTextPassword: password,
};

if (parsed.type === 'aadhar') profile.aadhar = parsed.value;
if (parsed.type === 'phone') profile.phone = parsed.value;
if (parsed.type === 'email') profile.email = parsed.value;

await setDoc(doc(db, 'users', uid), profile);

await setDoc(doc(db, 'loginIndex', loginIndexDocId(parsed.type, parsed.value)), {
  uid,
  role: 'super_admin',
  loginIdType: parsed.type,
  createdAt: new Date().toISOString(),
});

await setDoc(doc(db, 'appSettings', 'system'), {
  bootstrapComplete: true,
  bootstrappedAt: new Date().toISOString(),
  bootstrappedBy: uid,
}, { merge: true });

console.log(`Super admin ready. Sign in at /login with: ${parsed.value}`);
