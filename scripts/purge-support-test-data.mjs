/**
 * Permanently deletes all dealerSupportRequests and their messages (test cleanup).
 *
 * Usage: node scripts/purge-support-test-data.mjs
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBiLI--JR640YlXb2uiuBrLJ83XtFMPncE',
  authDomain: 'yesweigh-service.firebaseapp.com',
  projectId: 'yesweigh-service',
  storageBucket: 'yesweigh-service.firebasestorage.app',
  messagingSenderId: '108990753929',
  appId: '1:108990753929:web:564393f84ecd0347c3aa58',
};

const PASSWORD = process.argv[2] ?? 'YesWeigh@2026';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

await signInWithEmailAndPassword(auth, 'admin@yesweigh.in', PASSWORD);

const snap = await getDocs(collection(db, 'dealerSupportRequests'));
let deleted = 0;

for (const docSnap of snap.docs) {
  const data = docSnap.data();
  const messagesSnap = await getDocs(
    collection(db, 'dealerSupportRequests', docSnap.id, 'messages'),
  );
  for (const msgDoc of messagesSnap.docs) {
    await deleteDoc(msgDoc.ref);
  }
  await deleteDoc(doc(db, 'dealerSupportRequests', docSnap.id));
  console.log(`Deleted ${data.requestNumber ?? docSnap.id}`);
  deleted += 1;
}

await signOut(auth);
console.log(`\nDone. Removed ${deleted} support ticket(s) and their messages.`);
