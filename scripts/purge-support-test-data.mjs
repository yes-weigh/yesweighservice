/**
 * Permanently deletes all dealer support tickets, chat messages, and attachments.
 *
 * Usage:
 *   npm run purge:support-test-data
 *   npm run purge:support-test-data -- <admin-password>
 *
 * Storage objects are removed with gcloud when available (client SDK cannot list support/).
 */

import { spawnSync } from 'node:child_process';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
} from 'firebase/firestore';
import { deleteObject, getStorage, listAll, ref } from 'firebase/storage';

function purgeSupportStorageWithGcloud() {
  const result = spawnSync(
    'gcloud',
    [
      'storage', 'rm', '-r',
      'gs://yesweigh-service.firebasestorage.app/support/**',
      '--project', 'yesweigh-service',
    ],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (result.status === 0) {
    return true;
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (output.includes('matched no objects')) {
    return true;
  }
  console.warn('gcloud storage cleanup skipped:', output.trim() || `exit ${result.status}`);
  return false;
}

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
const storage = getStorage(app);

async function deleteStorageFolder(folderRef) {
  const listing = await listAll(folderRef);
  await Promise.all(listing.items.map(item => deleteObject(item)));
  for (const prefix of listing.prefixes) {
    await deleteStorageFolder(prefix);
  }
}

async function purgeSupportStorageForRequest(requestId) {
  const requestRef = ref(storage, `support/${requestId}`);
  let listing;
  try {
    listing = await listAll(requestRef);
  } catch (err) {
    const code = err && typeof err === 'object' ? String(err.code ?? '') : '';
    if (code.includes('object-not-found') || code.includes('unauthorized')) {
      return 0;
    }
    throw err;
  }

  let deletedFiles = 0;
  for (const item of listing.items) {
    await deleteObject(item);
    deletedFiles += 1;
  }
  for (const prefix of listing.prefixes) {
    await deleteStorageFolder(prefix);
    deletedFiles += 1;
  }
  return deletedFiles;
}

console.log('Signing in as super admin…');
await signInWithEmailAndPassword(auth, 'admin@yesweigh.in', PASSWORD);

const snap = await getDocs(collection(db, 'dealerSupportRequests'));
const requestIds = snap.docs.map(docSnap => docSnap.id);
console.log(`Found ${requestIds.length} support ticket(s).`);

console.log('Deleting support attachments from Storage…');
purgeSupportStorageWithGcloud();
let storageDeleted = 0;
for (const requestId of requestIds) {
  const count = await purgeSupportStorageForRequest(requestId);
  if (count > 0) {
    console.log(`  Removed ${count} file(s) for ${requestId}`);
  }
  storageDeleted += count;
}
if (storageDeleted === 0) {
  console.log('Storage support/ prefix cleared via gcloud (or already empty).');
} else {
  console.log(`Removed ${storageDeleted} storage object(s) via client SDK.`);
}

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
  console.log(`Deleted ${data.requestNumber ?? docSnap.id} (${messagesSnap.size} message(s))`);
  deleted += 1;
}

await signOut(auth);
console.log(`\nDone. Removed ${deleted} ticket(s), their messages, and ${storageDeleted} attachment(s).`);
