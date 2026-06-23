import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertSupportRequestAccess } from './support-attachments.js';

const OPS_ROLES = new Set(['staff', 'super_admin', 'admin']);

function isSupportClosedData(req) {
  return req.lifecycle === 'resolved'
    || req.lifecycle === 'cancelled'
    || req.status === 'completed'
    || req.status === 'cancelled';
}

function isSupportDraftData(req) {
  return req.lifecycle === 'draft' || req.status === 'draft';
}

function isSupportOpenData(req) {
  return req.lifecycle === 'open';
}

function previewText(text, attachmentCount) {
  const trimmed = String(text ?? '').trim();
  if (trimmed) return trimmed.slice(0, 140);
  if (attachmentCount > 0) {
    return `${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}`;
  }
  return 'New message';
}

function messageStageUpdates(role, req, isInitial) {
  if (!isSupportOpenData(req) || !req.openStage || isInitial) return {};
  const isOps = OPS_ROLES.has(role);
  if (isOps) {
    if (req.openStage === 'submitted' || req.openStage === 'under_review' || req.openStage === 'in_workshop') {
      return { openStage: 'awaiting_dealer' };
    }
    return {};
  }
  if (req.openStage === 'awaiting_dealer') {
    return { openStage: 'under_review' };
  }
  return {};
}

export async function appendSupportMessage(uid, input) {
  const requestId = String(input?.requestId ?? '').trim();
  const messageId = String(input?.messageId ?? '').trim();
  const text = String(input?.text ?? '');
  const attachments = Array.isArray(input?.attachments) ? input.attachments : [];
  const isInitial = input?.isInitial === true;

  if (!requestId) {
    throw new HttpsError('invalid-argument', 'requestId is required.');
  }
  if (!text.trim() && attachments.length === 0) {
    throw new HttpsError('invalid-argument', 'Message text or attachments required.');
  }

  const { role, req } = await assertSupportRequestAccess(uid, requestId, { isInitial });

  const isOps = OPS_ROLES.has(role);

  if (!isOps && isSupportClosedData(req)) {
    throw new HttpsError('failed-precondition', 'This request is closed.');
  }
  if (!isOps && isSupportDraftData(req) && !isInitial) {
    throw new HttpsError('failed-precondition', 'Submit the draft before messaging.');
  }

  const db = getFirestore();
  const messages = db.collection('dealerSupportRequests').doc(requestId).collection('messages');
  const ref = messageId ? messages.doc(messageId) : messages.doc();

  const now = new Date().toISOString();
  const authorName = String(input?.authorName ?? '').trim() || 'User';
  const authorRole = String(input?.authorRole ?? role ?? 'user');

  const payload = {
    text: text.trim(),
    attachments,
    authorUid: uid,
    authorName,
    authorRole,
    createdAt: now,
  };
  if (isInitial) {
    payload.isInitial = true;
  }

  await ref.set(payload);

  const updates = {
    updatedAt: now,
    lastMessageAt: now,
    lastMessagePreview: previewText(text, attachments.length),
    ...messageStageUpdates(role, req, isInitial),
  };

  if (isOps && isSupportOpenData(req) && req.openStage === 'submitted' && req.type === 'complaint') {
    updates.openStage = 'under_review';
  }

  await db.doc(`dealerSupportRequests/${requestId}`).update(updates);

  return { id: ref.id, ...payload };
}
