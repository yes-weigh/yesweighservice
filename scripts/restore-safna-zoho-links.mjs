/**
 * Restore Safna's Zoho salesperson links after promotion cleared them.
 * Usage: node scripts/restore-safna-zoho-links.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const functionsDir = path.resolve('functions');
const requireFromFunctions = createRequire(path.join(functionsDir, 'package.json'));
const { initializeApp, applicationDefault, cert } = requireFromFunctions('firebase-admin/app');
const { getFirestore } = requireFromFunctions('firebase-admin/firestore');

function initFirebase() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    const parsed = JSON.parse(
      fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'),
    );
    if (parsed.private_key && parsed.client_email) {
      initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || 'yesweigh-service',
      });
      return;
    }
  }
  const firebaseAdc = path.join(
    process.env.APPDATA || '',
    'firebase',
    'mhdfazalvs_gmail_com_application_default_credentials.json',
  );
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(firebaseAdc)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = firebaseAdc;
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: 'yesweigh-service',
  });
}

initFirebase();
const db = getFirestore();

const SAFNA_UID = 'oNytLWDWi9Y7f0CCTcrmlbyY7kh2';
const LINKS = [
  { id: '99381000031557364', name: 'Safna' },
  { id: '99381000031055900', name: 'Safna(Directors)' },
];

const ref = db.collection('users').doc(SAFNA_UID);
const snap = await ref.get();
if (!snap.exists) {
  console.error('Safna user doc not found.');
  process.exit(1);
}

const data = snap.data() || {};
if (String(data.displayName ?? '').toUpperCase() !== 'SAFNA N A') {
  console.error('UID does not match SAFNA N A — aborting.');
  process.exit(1);
}

const ids = LINKS.map(link => link.id);
await ref.set({
  zohoSalespersonIds: ids,
  zohoSalespersonLinks: LINKS,
  zohoSalespersonId: ids[0],
  zohoSalespersonName: LINKS[0].name,
  updatedAt: new Date().toISOString(),
}, { merge: true });

console.log('Restored Zoho links for SAFNA N A:', LINKS.map(l => l.name).join(', '));
