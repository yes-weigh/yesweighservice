/**
 * Seed Invoice access system role and assign it to warehouse invoice clerks.
 *
 * Usage:
 *   set GOOGLE_APPLICATION_CREDENTIALS=secrets\yesweigh-service-firebase-adminsdk-fbsvc-65d526cda5.json
 *   node scripts/assign-invoice-access-staff.mjs
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const ROLE_ID = 'role-invoice-access';
const PERMISSIONS = ['invoices.view'];

/** Known Vishnu E uid from HR URL; Sivaprasad resolved by name. */
const KNOWN_UIDS = [
  '2clC3UZaTBNsazVNKG7tXErPUWX2', // Vishnu E
];

const NAME_MATCHERS = [
  /sivaprasad/i,
  /shivaprasad/i,
  /vishnu\s*e/i,
];

function initAdmin() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    initializeApp({
      credential: cert(parsed),
      projectId: parsed.project_id || 'yesweigh-service',
    });
    return;
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: 'yesweigh-service',
  });
}

initAdmin();
const db = getFirestore();

async function ensureInvoiceRole() {
  const ref = db.collection('staffRoles').doc(ROLE_ID);
  const snap = await ref.get();
  const now = new Date().toISOString();
  const payload = {
    name: 'Invoice access',
    description: 'Dashboard, invoices, and profile only',
    department: 'admin',
    permissions: PERMISSIONS,
    isSystem: true,
    updatedAt: now,
  };
  if (!snap.exists) {
    await ref.set({ ...payload, createdAt: now });
    console.log(`Created staffRoles/${ROLE_ID}`);
  } else {
    await ref.set(payload, { merge: true });
    console.log(`Updated staffRoles/${ROLE_ID}`);
  }
}

function matchesTarget(data) {
  const name = String(data.displayName || data.name || '').trim();
  const job = String(data.jobTitle || data.designation || '').trim();
  if (NAME_MATCHERS.some(re => re.test(name))) return true;
  // Fallback: warehouse engineers named in the request if uid already known
  if (/warehouse engineer/i.test(job) && /vishnu|sivaprasad|shivaprasad/i.test(name)) {
    return true;
  }
  return false;
}

async function findTargetUsers() {
  const byId = new Map();

  for (const uid of KNOWN_UIDS) {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) {
      byId.set(snap.id, { id: snap.id, ...snap.data() });
    } else {
      console.warn(`Known uid not found: ${uid}`);
    }
  }

  const all = await db.collection('users').get();
  for (const doc of all.docs) {
    const data = doc.data();
    if (!matchesTarget(data)) continue;
    byId.set(doc.id, { id: doc.id, ...data });
  }

  return [...byId.values()];
}

async function assignRole(user) {
  const patch = {
    role: 'staff',
    staffAccessMode: 'role',
    staffRoleId: ROLE_ID,
    staffPermissions: PERMISSIONS,
    staffDepartment: 'admin',
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.collection('users').doc(user.id).set(patch, { merge: true });
  console.log(
    `Assigned Invoice access → ${user.id} (${user.displayName || user.name || 'unnamed'}) `
    + `[was role=${user.role ?? '?'} staffRoleId=${user.staffRoleId ?? 'none'}]`,
  );
}

const targets = await findTargetUsers();
if (!targets.length) {
  console.error('No matching users found (Sivaprasad / Vishnu E).');
  process.exit(1);
}

console.log(`Matched ${targets.length} user(s):`);
for (const u of targets) {
  console.log(`  - ${u.id} | ${u.displayName || u.name || '?'} | role=${u.role} | job=${u.jobTitle || u.designation || ''}`);
}

await ensureInvoiceRole();
for (const user of targets) {
  await assignRole(user);
}

console.log('Done.');
