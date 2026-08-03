import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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

function reopenUpdates(req, role, authorUid, authorName, now) {
  if (!isSupportClosedData(req)) return null;

  const previousLifecycle = req.lifecycle === 'cancelled' || req.status === 'cancelled'
    ? 'cancelled'
    : 'resolved';
  const previousResolvedAt = req.resolvedAt
    ? String(req.resolvedAt)
    : (req.updatedAt ? String(req.updatedAt) : now);

  const event = {
    at: now,
    byUid: authorUid,
    byName: authorName,
    byRole: role,
    previousLifecycle,
    previousResolvedAt,
  };

  const priorCount = Number(req.reopenCount ?? 0);
  const reopenCount = Number.isFinite(priorCount) ? priorCount + 1 : 1;

  return {
    lifecycle: 'open',
    openStage: 'under_review',
    status: 'in_progress',
    reopenedAt: now,
    reopenCount,
    reopenHistory: FieldValue.arrayUnion(event),
    updatedAt: now,
  };
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

  const reopen = !isInitial ? reopenUpdates(req, role, uid, authorName, now) : null;

  const updates = {
    updatedAt: now,
    lastMessageAt: now,
    lastMessagePreview: previewText(text, attachments.length),
    ...(reopen || messageStageUpdates(role, req, isInitial)),
  };

  if (
    !reopen
    && isOps
    && isSupportOpenData(req)
    && req.openStage === 'submitted'
    && (req.type === 'complaint' || req.type === 'chat')
  ) {
    updates.openStage = 'under_review';
  }

  await db.doc(`dealerSupportRequests/${requestId}`).update(updates);

  return { id: ref.id, ...payload, reopened: Boolean(reopen) };
}
