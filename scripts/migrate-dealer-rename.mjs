/**
 * Migrates Firestore user docs: director → dealer, director_staff → dealer_staff,
 * directorId → dealerId. Also updates sample emails if present.
 *
 * Usage: npm run migrate:dealer-rename
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, setDoc, deleteField } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBiLI--JR640YlXb2uiuBrLJ83XtFMPncE',
  authDomain: 'yesweigh-service.firebaseapp.com',
  projectId: 'yesweigh-service',
  storageBucket: 'yesweigh-service.firebasestorage.app',
  messagingSenderId: '108990753929',
  appId: '1:108990753929:web:564393f84ecd0347c3aa58',
};

const PASSWORD = process.argv[2] ?? 'YesWeigh@2026';

const ROLE_MAP = {
  director: 'dealer',
  director_staff: 'dealer_staff',
  admin: 'super_admin',
};

const EMAIL_MAP = {};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

await signInWithEmailAndPassword(auth, 'admin@yesweigh.in', PASSWORD);

const snap = await getDocs(collection(db, 'users'));
let updated = 0;

for (const d of snap.docs) {
  const data = d.data();
  const patch = {};
  let changed = false;

  if (ROLE_MAP[data.role]) {
    patch.role = ROLE_MAP[data.role];
    changed = true;
  }

  if (data.directorId && !data.dealerId) {
    patch.dealerId = data.directorId;
    patch.directorId = deleteField();
    changed = true;
  }

  if (EMAIL_MAP[data.email]) {
    patch.email = EMAIL_MAP[data.email];
    changed = true;
  }

  if (data.displayName?.includes('Director')) {
    patch.displayName = data.displayName.replace(/Director/g, 'Dealer');
    changed = true;
  }

  if (changed) {
    await setDoc(doc(db, 'users', d.id), patch, { merge: true });
    console.log(`Updated ${data.email ?? d.id}`);
    updated += 1;
  }
}

await signOut(auth);
console.log(`\nDone. ${updated} user document(s) migrated.`);
