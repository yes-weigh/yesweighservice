/**
 * Seed one sample user per role (Auth + Firestore).
 *
 * Usage:
 *   npm run seed:sample-users
 *   npm run seed:sample-users -- YourSharedPassword
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBiLI--JR640YlXb2uiuBrLJ83XtFMPncE',
  authDomain: 'yesweigh-service.firebaseapp.com',
  projectId: 'yesweigh-service',
  storageBucket: 'yesweigh-service.firebasestorage.app',
  messagingSenderId: '108990753929',
  appId: '1:108990753929:web:564393f84ecd0347c3aa58',
};

const DEFAULT_PASSWORD = process.argv[2] ?? 'YesWeigh@2026';

const SAMPLES = [
  {
    email: 'superadmin@yesweigh.in',
    displayName: 'Sample Super Admin',
    role: 'super_admin',
    phone: '9000000001',
  },
  {
    email: 'staff@yesweigh.in',
    displayName: 'Sample Staff',
    role: 'staff',
    phone: '9000000002',
  },
  {
    email: 'dealer@yesweigh.in',
    displayName: 'Sample Dealer',
    role: 'dealer',
    phone: '9000000003',
  },
  {
    email: 'dealerstaff@yesweigh.in',
    displayName: 'Sample Dealer Staff',
    role: 'dealer_staff',
    phone: '9000000004',
    dealerEmail: 'dealer@yesweigh.in',
  },
];

const primaryApp = initializeApp(firebaseConfig);
const secondaryApp = initializeApp(firebaseConfig, 'SeedSecondary');
const primaryAuth = getAuth(primaryApp);
const secondaryAuth = getAuth(secondaryApp);
const db = getFirestore(primaryApp);

async function ensureAuthUser(email, password) {
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await signOut(secondaryAuth);
    return cred.user.uid;
  } catch (err) {
    const code = err?.code ?? '';
    if (code === 'auth/email-already-in-use') {
      const cred = await signInWithEmailAndPassword(secondaryAuth, email, password);
      const uid = cred.user.uid;
      await signOut(secondaryAuth);
      return uid;
    }
    throw err;
  }
}

async function upsertProfile(uid, profile) {
  await setDoc(
    doc(db, 'users', uid),
    {
      ...profile,
      active: true,
      createdAt: new Date().toISOString(),
      createdByUid: 'seed-script',
    },
    { merge: true },
  );
}

console.log('Signing in as bootstrap super admin (admin@yesweigh.in)...');
try {
  await signInWithEmailAndPassword(primaryAuth, 'admin@yesweigh.in', DEFAULT_PASSWORD);
} catch {
  console.error(
    'Could not sign in as admin@yesweigh.in. Run: npm run seed:admin -- admin@yesweigh.in',
    DEFAULT_PASSWORD,
    '"YesWeigh Admin"',
  );
  process.exit(1);
}

await upsertProfile(primaryAuth.currentUser.uid, {
  email: 'admin@yesweigh.in',
  displayName: 'YesWeigh Admin',
  role: 'super_admin',
  phone: '9000000000',
});

const uidByEmail = new Map([['admin@yesweigh.in', primaryAuth.currentUser.uid]]);

for (const sample of SAMPLES) {
  const email = sample.email.toLowerCase();
  console.log(`\n→ ${sample.role}: ${email}`);

  const uid = await ensureAuthUser(email, DEFAULT_PASSWORD);
  uidByEmail.set(email, uid);

  const profile = {
    email,
    displayName: sample.displayName,
    role: sample.role,
    phone: sample.phone,
  };

  if (sample.role === 'dealer_staff') {
    const dealerUid = uidByEmail.get(sample.dealerEmail);
    if (!dealerUid) {
      throw new Error(`Dealer uid missing for ${email}`);
    }
    profile.dealerId = dealerUid;
  }

  await upsertProfile(uid, profile);
  console.log(`  ✓ ${sample.displayName} (${uid})`);
}

await signOut(primaryAuth);

console.log('\nSample users ready. Shared password:', DEFAULT_PASSWORD);
console.log('\n| Role           | Email                      |');
console.log('|----------------|----------------------------|');
for (const s of SAMPLES) {
  console.log(`| ${s.role.padEnd(14)} | ${s.email.padEnd(26)} |`);
}
console.log('| super_admin    | admin@yesweigh.in          | (bootstrap)');
