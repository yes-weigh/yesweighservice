/**
 * Deletes all legacy portal dealerOrders via the purgeDealerOrders callable
 * (Admin SDK on the server — clients cannot delete this collection).
 *
 * Deploy functions first, then:
 *   node scripts/purge-dealer-orders.mjs <admin-email-or-login> <password>
 *
 * Or with env:
 *   PURGE_ADMIN_LOGIN=... PURGE_ADMIN_PASSWORD=... node scripts/purge-dealer-orders.mjs
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyBiLI--JR640YlXb2uiuBrLJ83XtFMPncE',
  authDomain: 'yesweigh-service.firebaseapp.com',
  projectId: 'yesweigh-service',
  storageBucket: 'yesweigh-service.firebasestorage.app',
  messagingSenderId: '108990753929',
  appId: '1:108990753929:web:564393f84ecd0347c3aa58',
};

const AUTH_EMAIL_DOMAIN = 'yesweigh.auth';

function toAuthEmail(loginId) {
  const raw = String(loginId ?? '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw.toLowerCase();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 12) {
    return `${digits}@${AUTH_EMAIL_DOMAIN}`;
  }
  return raw;
}

const login = process.argv[2] ?? process.env.PURGE_ADMIN_LOGIN ?? '';
const password = process.argv[3] ?? process.env.PURGE_ADMIN_PASSWORD ?? '';

if (!login || !password) {
  console.error(
    'Usage: node scripts/purge-dealer-orders.mjs <admin-login> <password>',
  );
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app, 'asia-south1');

async function main() {
  const email = toAuthEmail(login);
  console.log(`Signing in as ${email}…`);
  await signInWithEmailAndPassword(auth, email, password);
  console.log('Calling purgeDealerOrders…');
  const purge = httpsCallable(functions, 'purgeDealerOrders', { timeout: 540_000 });
  const result = await purge();
  const data = result.data ?? {};
  await signOut(auth);
  console.log(`Done. Deleted ${data.deleted ?? 0} document(s) from ${data.collection ?? 'dealerOrders'}.`);
}

main().catch(err => {
  console.error(err?.message || err);
  process.exit(1);
});
