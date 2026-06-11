/**
 * Creates the first super admin (Firebase Auth + Firestore profile).
 *
 * Usage:
 *   npm run seed:admin -- admin@yesweigh.in YourPassword "Display Name"
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

const email = (process.argv[2] ?? '').trim().toLowerCase();
const password = process.argv[3] ?? '';
const displayName = process.argv[4] ?? 'YesWeigh Admin';

if (!email || !password) {
  console.error('Usage: npm run seed:admin -- <email> <password> [displayName]');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

console.log(`Creating super admin ${email}...`);

let cred;
try {
  cred = await createUserWithEmailAndPassword(auth, email, password);
  console.log('Auth user created.');
} catch (err) {
  const code = err?.code ?? '';
  if (code === 'auth/email-already-in-use') {
    console.log('Auth user exists — signing in to ensure Firestore profile...');
    cred = await signInWithEmailAndPassword(auth, email, password);
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

await setDoc(doc(db, 'users', uid), {
  email,
  displayName,
  role: 'super_admin',
  active: true,
  createdAt: new Date().toISOString(),
  createdByUid: 'seed-script',
});

await setDoc(doc(db, 'appSettings', 'system'), {
  bootstrapComplete: true,
  bootstrappedAt: new Date().toISOString(),
  bootstrappedBy: uid,
}, { merge: true });

console.log(`Super admin ready. Sign in at /login with ${email}`);
