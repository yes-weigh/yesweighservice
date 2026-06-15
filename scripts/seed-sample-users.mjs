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

const AUTH_EMAIL_DOMAIN = 'yesweigh.auth';
const DEFAULT_PASSWORD = process.argv[2] ?? 'YesWeigh@2026';

function authEmailForLoginId(type, value) {
  if (type === 'email') return value;
  if (type === 'phone') return `p${value}@${AUTH_EMAIL_DOMAIN}`;
  return `${value}@${AUTH_EMAIL_DOMAIN}`;
}

function loginIndexDocId(type, value) {
  if (type === 'email') return `e_${value}`;
  if (type === 'phone') return `p_${value}`;
  return `a_${value}`;
}

function buildProfile(sample) {
  const profile = {
    loginId: sample.loginId,
    loginIdType: sample.loginIdType,
    displayName: sample.displayName,
    role: sample.role,
    phone: sample.phone,
    email: sample.email,
  };
  if (sample.loginIdType === 'aadhar') profile.aadhar = sample.loginId;
  return profile;
}

const SAMPLES = [
  {
    loginId: '9000000001',
    loginIdType: 'phone',
    displayName: 'Sample Super Admin',
    role: 'super_admin',
    phone: '9000000001',
  },
  {
    loginId: '9000000002',
    loginIdType: 'phone',
    displayName: 'Sample Staff',
    role: 'staff',
    phone: '9000000002',
  },
  {
    loginId: '9000000003',
    loginIdType: 'phone',
    displayName: 'Sample Dealer',
    role: 'dealer',
    phone: '9000000003',
  },
  {
    loginId: '9000000004',
    loginIdType: 'phone',
    displayName: 'Sample Dealer Staff',
    role: 'dealer_staff',
    phone: '9000000004',
    dealerLoginId: '9000000003',
  },
];

const ADMIN_LOGIN_ID = '111111111111';
const ADMIN_LOGIN_TYPE = 'aadhar';

const primaryApp = initializeApp(firebaseConfig);
const secondaryApp = initializeApp(firebaseConfig, 'SeedSecondary');
const primaryAuth = getAuth(primaryApp);
const secondaryAuth = getAuth(secondaryApp);
const db = getFirestore(primaryApp);

async function ensureAuthUser(loginIdType, loginId, password) {
  const email = authEmailForLoginId(loginIdType, loginId);
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
      clearTextPassword: DEFAULT_PASSWORD,
    },
    { merge: true },
  );
}

async function reserveLoginIndex(loginIdType, loginId, uid, role) {
  await setDoc(doc(db, 'loginIndex', loginIndexDocId(loginIdType, loginId)), {
    uid,
    role,
    loginIdType,
    createdAt: new Date().toISOString(),
  }, { merge: true });
}

console.log(`Signing in as bootstrap super admin (${ADMIN_LOGIN_TYPE}: ${ADMIN_LOGIN_ID})...`);
try {
  await signInWithEmailAndPassword(
    primaryAuth,
    authEmailForLoginId(ADMIN_LOGIN_TYPE, ADMIN_LOGIN_ID),
    DEFAULT_PASSWORD,
  );
} catch {
  console.error(
    'Could not sign in as bootstrap admin. Run:',
    `npm run seed:admin -- ${ADMIN_LOGIN_ID} ${DEFAULT_PASSWORD} "YesWeigh Admin"`,
  );
  process.exit(1);
}

await upsertProfile(primaryAuth.currentUser.uid, {
  loginId: ADMIN_LOGIN_ID,
  loginIdType: ADMIN_LOGIN_TYPE,
  aadhar: ADMIN_LOGIN_ID,
  displayName: 'YesWeigh Admin',
  role: 'super_admin',
  phone: '9000000000',
});
await reserveLoginIndex(
  ADMIN_LOGIN_TYPE,
  ADMIN_LOGIN_ID,
  primaryAuth.currentUser.uid,
  'super_admin',
);

const uidByLoginId = new Map([[ADMIN_LOGIN_ID, primaryAuth.currentUser.uid]]);

for (const sample of SAMPLES) {
  console.log(`\n→ ${sample.role}: ${sample.loginIdType} ${sample.loginId}`);

  const uid = await ensureAuthUser(sample.loginIdType, sample.loginId, DEFAULT_PASSWORD);
  uidByLoginId.set(sample.loginId, uid);

  const profile = buildProfile(sample);

  if (sample.role === 'dealer_staff') {
    const dealerUid = uidByLoginId.get(sample.dealerLoginId);
    if (!dealerUid) {
      throw new Error(`Dealer uid missing for ${sample.loginId}`);
    }
    profile.dealerId = dealerUid;
  }

  await upsertProfile(uid, profile);
  await reserveLoginIndex(sample.loginIdType, sample.loginId, uid, sample.role);
  console.log(`  ✓ ${sample.displayName} (${uid})`);
}

await signOut(primaryAuth);

console.log('\nSample users ready. Shared password:', DEFAULT_PASSWORD);
console.log('\n| Role           | Login ID       | Type   |');
console.log('|----------------|----------------|--------|');
for (const s of SAMPLES) {
  console.log(`| ${s.role.padEnd(14)} | ${s.loginId.padEnd(14)} | ${s.loginIdType.padEnd(6)} |`);
}
console.log(`| super_admin    | ${ADMIN_LOGIN_ID} | aadhar | (bootstrap)`);
