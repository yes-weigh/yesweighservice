/**
 * One-time: set partnerId = trackon_surface for logistics bookings whose
 * consignment/tracking AWB starts with "5".
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=secrets\yesweigh-service-firebase-adminsdk-....json
 *   node scripts/fix-trackon-awb-starts-with-5.mjs [--dry-run]
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const TARGET_PARTNER = 'trackon_surface';
const DRY_RUN = process.argv.includes('--dry-run');

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

function awbCandidates(data) {
  return [
    data.consignmentNo,
    data.trackingNo,
  ]
    .map(value => String(value ?? '').replace(/\s+/g, '').trim())
    .filter(Boolean);
}

function startsWithFive(data) {
  return awbCandidates(data).some(awb => awb.startsWith('5'));
}

function primaryAwb(data) {
  return awbCandidates(data)[0] || '';
}

initAdmin();
const db = getFirestore();

const snap = await db.collection('logisticsBookings').get();
const matches = [];
for (const docSnap of snap.docs) {
  const data = docSnap.data() || {};
  if (!startsWithFive(data)) continue;
  matches.push({
    id: docSnap.id,
    awb: primaryAwb(data),
    partnerId: String(data.partnerId ?? ''),
    serviceType: String(data.serviceType ?? ''),
    dealer: String(data.dealerSnapshot?.name ?? data.zohoCustomerId ?? ''),
    status: String(data.status ?? ''),
  });
}

console.log(`Scanned ${snap.size} logistics bookings`);
console.log(`Matched AWB starting with 5: ${matches.length}`);
for (const row of matches) {
  console.log(
    `- ${row.id}  AWB=${row.awb}  partner=${row.partnerId || '—'}  service=${row.serviceType || '—'}  ${row.dealer}  [${row.status}]`,
  );
}

const toUpdate = matches.filter(row => row.partnerId !== TARGET_PARTNER);
console.log(`Already ${TARGET_PARTNER}: ${matches.length - toUpdate.length}`);
console.log(`Need update: ${toUpdate.length}`);

if (DRY_RUN) {
  console.log('Dry run — no writes.');
  process.exit(0);
}

if (!toUpdate.length) {
  console.log('Nothing to update.');
  process.exit(0);
}

let updated = 0;
const batchSize = 400;
for (let i = 0; i < toUpdate.length; i += batchSize) {
  const chunk = toUpdate.slice(i, i + batchSize);
  const batch = db.batch();
  for (const row of chunk) {
    // Do not bump updatedAt — list sort is updatedAt desc.
    batch.update(db.collection('logisticsBookings').doc(row.id), {
      partnerId: TARGET_PARTNER,
    });
  }
  await batch.commit();
  updated += chunk.length;
  console.log(`Updated ${updated}/${toUpdate.length}`);
}

console.log(`Done. Set partnerId=${TARGET_PARTNER} on ${updated} booking(s).`);
