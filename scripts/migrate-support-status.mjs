/**
 * Migrates dealerSupportRequests from legacy `status` to lifecycle + openStage.
 *
 * Usage: node scripts/migrate-support-status.mjs
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  updateDoc,
  deleteField,
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

function mapLegacyStatus(status, assignedToUid) {
  switch (status) {
    case 'draft':
      return { lifecycle: 'draft', openStage: null };
    case 'pending':
      return {
        lifecycle: 'open',
        openStage: assignedToUid ? 'under_review' : 'submitted',
      };
    case 'awaiting_product':
      return { lifecycle: 'open', openStage: 'awaiting_product' };
    case 'in_progress':
      return { lifecycle: 'open', openStage: 'in_workshop' };
    case 'completed':
      return { lifecycle: 'resolved', openStage: null };
    case 'cancelled':
      return { lifecycle: 'cancelled', openStage: null };
    default:
      return { lifecycle: 'open', openStage: 'submitted' };
  }
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

await signInWithEmailAndPassword(auth, 'admin@yesweigh.in', PASSWORD);

const snap = await getDocs(collection(db, 'dealerSupportRequests'));
let updated = 0;
let skipped = 0;

for (const docSnap of snap.docs) {
  const data = docSnap.data();
  if (data.lifecycle) {
    skipped += 1;
    continue;
  }

  const legacyStatus = String(data.status ?? 'pending');
  const mapped = mapLegacyStatus(legacyStatus, data.assignedToUid);
  const patch = {
    lifecycle: mapped.lifecycle,
    openStage: mapped.openStage,
    status: deleteField(),
  };

  if (mapped.lifecycle === 'resolved' && !data.resolvedAt) {
    patch.resolvedAt = data.updatedAt ?? data.createdAt ?? new Date().toISOString();
  }

  if (!('courierTracking' in data)) patch.courierTracking = null;
  if (!('shippedAt' in data)) patch.shippedAt = null;
  if (!('receivedAt' in data)) patch.receivedAt = null;
  if (!('resolutionSummary' in data)) patch.resolutionSummary = null;

  await updateDoc(doc(db, 'dealerSupportRequests', docSnap.id), patch);
  console.log(`Migrated ${data.requestNumber ?? docSnap.id}: ${legacyStatus} → ${mapped.lifecycle}/${mapped.openStage ?? '—'}`);
  updated += 1;
}

await signOut(auth);
console.log(`\nDone. ${updated} migrated, ${skipped} already on new model.`);
