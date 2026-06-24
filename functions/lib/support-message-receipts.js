import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertSupportRequestAccess } from './support-attachments.js';

const MAX_BATCH = 80;

export async function markSupportMessageReceipts(uid, input) {
  const requestId = String(input?.requestId ?? '').trim();
  const receipt = input?.receipt === 'read' ? 'read' : 'delivered';
  const messageIds = Array.isArray(input?.messageIds)
    ? [...new Set(input.messageIds.map(id => String(id ?? '').trim()).filter(Boolean))].slice(0, MAX_BATCH)
    : [];

  if (!requestId) {
    throw new HttpsError('invalid-argument', 'requestId is required.');
  }
  if (messageIds.length === 0) {
    return { updated: 0 };
  }

  await assertSupportRequestAccess(uid, requestId);

  const db = getFirestore();
  const messages = db.collection('dealerSupportRequests').doc(requestId).collection('messages');
  const now = new Date().toISOString();
  const batch = db.batch();
  let updated = 0;

  const snaps = await Promise.all(messageIds.map(id => messages.doc(id).get()));

  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data();
    if (data.authorUid === uid) continue;

    const updates = {};
    if (!data.deliveredAt) {
      updates.deliveredAt = now;
    }
    if (receipt === 'read' && !data.readAt) {
      updates.readAt = now;
    }
    if (Object.keys(updates).length === 0) continue;

    batch.update(snap.ref, updates);
    updated += 1;
  }

  if (updated > 0) {
    await batch.commit();
  }

  return { updated };
}
