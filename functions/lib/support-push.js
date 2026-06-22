import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import {
  canReceiveSupportTicketNotification,
  isDealerSideRole,
  isOpsRole,
} from './staff-support-access.js';

function supportDetailPath(role, requestId) {
  const base = role === 'dealer_staff'
    ? '/dealer-staff'
    : role === 'staff'
      ? '/staff'
      : role === 'super_admin'
        ? '/super-admin'
        : '/dealer';
  return `${base}/warranty-support/${requestId}`;
}

function tokenDocId(token) {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  }
  return `t_${Math.abs(hash)}`;
}

async function readPushTokensForUser(uid) {
  const db = getFirestore();
  const snap = await db.collection(`users/${uid}/pushTokens`).get();
  return snap.docs.map(docSnap => ({
    id: docSnap.id,
    token: String(docSnap.data().token ?? ''),
  })).filter(entry => entry.token);
}

async function writeUserNotification(uid, payload) {
  const db = getFirestore();
  await db.collection(`users/${uid}/notifications`).add({
    ...payload,
    read: false,
    createdAt: new Date().toISOString(),
  });
}

async function removeInvalidTokens(uid, tokensToRemove) {
  if (!tokensToRemove.length) return;
  const db = getFirestore();
  const batch = db.batch();
  for (const tokenId of tokensToRemove) {
    batch.delete(db.doc(`users/${uid}/pushTokens/${tokenId}`));
  }
  await batch.commit();
}

async function sendPushToUser(uid, userRole, notification) {
  const tokens = await readPushTokensForUser(uid);
  if (!tokens.length) return { sent: 0 };

  const messaging = getMessaging();
  const url = notification.url ?? supportDetailPath(userRole, notification.requestId);
  const invalid = [];

  await writeUserNotification(uid, {
    title: notification.title,
    body: notification.body,
    url,
    type: notification.type,
    requestId: notification.requestId,
    requestNumber: notification.requestNumber ?? null,
  });

  let sent = 0;
  for (const entry of tokens) {
    try {
      await messaging.send({
        token: entry.token,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: {
          url,
          requestId: notification.requestId,
          type: notification.type,
        },
        webpush: {
          fcmOptions: { link: url },
        },
      });
      sent += 1;
    } catch (err) {
      const code = err?.code ?? err?.errorInfo?.code ?? '';
      if (code === 'messaging/registration-token-not-registered'
        || code === 'messaging/invalid-registration-token') {
        invalid.push(entry.id);
      }
    }
  }

  await removeInvalidTokens(uid, invalid);
  return { sent };
}

async function listActiveUsers() {
  const db = getFirestore();
  const snap = await db.collection('users').where('active', '==', true).get();
  return snap.docs.map(docSnap => ({ uid: docSnap.id, ...docSnap.data() }));
}

async function dealerPortalUserIds(dealerId) {
  const users = await listActiveUsers();
  const ids = new Set();
  for (const user of users) {
    if (user.role === 'dealer' && user.uid === dealerId) {
      ids.add(user.uid);
    }
    if (user.role === 'dealer_staff') {
      const linked = user.dealerId ?? user.directorId;
      if (linked === dealerId) ids.add(user.uid);
    }
  }
  return [...ids];
}

async function notifyOpsUsers(request, options = {}) {
  const users = await listActiveUsers();
  const recipients = users.filter(user => {
    if (!isOpsRole(user.role)) return false;
    if (options.assigneeOnly) return user.uid === request.assignedToUid;
    if (options.assigneeUid && user.uid === options.assigneeUid) return true;
    if (request.assignedToUid && !options.includeAllOps) {
      return user.uid === request.assignedToUid;
    }
    return canReceiveSupportTicketNotification(user, request.type);
  });

  const unique = [...new Map(recipients.map(user => [user.uid, user])).values()];
  const title = options.title ?? 'New support request';
  const body = options.body ?? `${request.requestNumber} · ${request.dealerName ?? 'Dealer'}`;

  await Promise.all(unique.map(user => sendPushToUser(user.uid, user.role, {
    title,
    body,
    requestId: request.id,
    requestNumber: request.requestNumber,
    type: options.type ?? 'support_new',
  })));
}

async function notifyDealerUsers(request, options = {}) {
  const dealerIds = await dealerPortalUserIds(request.dealerId);
  const title = options.title ?? 'Support update';
  const body = options.body ?? `${request.requestNumber}: ${request.lastMessagePreview ?? 'New reply'}`;

  await Promise.all(dealerIds.map(uid => sendPushToUser(uid, 'dealer', {
    title,
    body,
    requestId: request.id,
    requestNumber: request.requestNumber,
    type: options.type ?? 'support_reply',
  })));
}

export async function notifyOnSupportRequestCreated(requestId, data) {
  const request = {
    id: requestId,
    type: String(data.type ?? 'service'),
    requestNumber: String(data.requestNumber ?? ''),
    dealerId: String(data.dealerId ?? ''),
    dealerName: data.dealerName ? String(data.dealerName) : null,
    assignedToUid: data.assignedToUid ? String(data.assignedToUid) : null,
    lastMessagePreview: data.lastMessagePreview ? String(data.lastMessagePreview) : null,
  };

  await notifyOpsUsers(request, {
    title: 'New support request',
    body: `${request.requestNumber} · ${request.dealerName ?? 'Dealer'}`,
    type: 'support_new',
    includeAllOps: true,
  });
}

export async function notifyOnSupportMessageCreated(requestId, messageData) {
  if (messageData.isInitial === true) return;

  const db = getFirestore();
  const reqSnap = await db.doc(`dealerSupportRequests/${requestId}`).get();
  if (!reqSnap.exists) return;

  const data = reqSnap.data();
  const request = {
    id: requestId,
    type: String(data.type ?? 'service'),
    requestNumber: String(data.requestNumber ?? ''),
    dealerId: String(data.dealerId ?? ''),
    dealerName: data.dealerName ? String(data.dealerName) : null,
    assignedToUid: data.assignedToUid ? String(data.assignedToUid) : null,
    lastMessagePreview: String(messageData.text ?? '').slice(0, 140) || 'New attachment',
  };

  const authorRole = String(messageData.authorRole ?? '');
  const authorName = String(messageData.authorName ?? 'Someone');
  const preview = request.lastMessagePreview;

  if (isOpsRole(authorRole)) {
    await notifyDealerUsers(request, {
      title: `${request.requestNumber} — YesOne replied`,
      body: `${authorName}: ${preview}`,
      type: 'support_reply',
    });
    return;
  }

  if (isDealerSideRole(authorRole)) {
    await notifyOpsUsers(request, {
      title: `${request.requestNumber} — dealer replied`,
      body: `${authorName}: ${preview}`,
      type: 'support_message',
      includeAllOps: !request.assignedToUid,
      assigneeUid: request.assignedToUid ?? undefined,
    });
  }
}

export async function notifyOnSupportRequestAssigned(requestId, before, after) {
  const prevAssignee = before?.assignedToUid ? String(before.assignedToUid) : null;
  const nextAssignee = after?.assignedToUid ? String(after.assignedToUid) : null;
  if (!nextAssignee || nextAssignee === prevAssignee) return;

  const db = getFirestore();
  const userSnap = await db.doc(`users/${nextAssignee}`).get();
  if (!userSnap.exists) return;

  const user = userSnap.data();
  const request = {
    id: requestId,
    type: String(after.type ?? 'service'),
    requestNumber: String(after.requestNumber ?? ''),
    dealerId: String(after.dealerId ?? ''),
    dealerName: after.dealerName ? String(after.dealerName) : null,
    assignedToUid: nextAssignee,
  };

  await sendPushToUser(nextAssignee, String(user.role ?? 'staff'), {
    title: 'Support ticket assigned to you',
    body: `${request.requestNumber} · ${request.dealerName ?? 'Dealer'}`,
    requestId,
    requestNumber: request.requestNumber,
    type: 'support_assigned',
  });
}

export { tokenDocId };
