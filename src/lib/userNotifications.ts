import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';

export interface UserNotification {
  id: string;
  title: string;
  body: string;
  url: string;
  type: string;
  requestId: string | null;
  requestNumber: string | null;
  read: boolean;
  createdAt: string;
}

export function mapUserNotification(id: string, data: Record<string, unknown>): UserNotification {
  return {
    id,
    title: String(data.title ?? 'Notification'),
    body: String(data.body ?? ''),
    url: String(data.url ?? '/'),
    type: String(data.type ?? 'general'),
    requestId: data.requestId ? String(data.requestId) : null,
    requestNumber: data.requestNumber ? String(data.requestNumber) : null,
    read: data.read === true,
    createdAt: String(data.createdAt ?? ''),
  };
}

export function subscribeUserNotifications(
  uid: string,
  onData: (items: UserNotification[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'users', uid, 'notifications'),
    orderBy('createdAt', 'desc'),
    limit(50),
  );
  return onSnapshot(
    q,
    snap => {
      onData(snap.docs.map(docSnap => mapUserNotification(docSnap.id, docSnap.data())));
    },
    err => onError?.(err instanceof Error ? err : new Error('Could not load notifications.')),
  );
}

export async function markNotificationRead(uid: string, notificationId: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'notifications', notificationId), {
    read: true,
    readAt: new Date().toISOString(),
  });
}

export async function markAllNotificationsRead(uid: string, notificationIds: string[]): Promise<void> {
  if (!notificationIds.length) return;
  const batch = writeBatch(db);
  const readAt = new Date().toISOString();
  for (const id of notificationIds) {
    batch.update(doc(db, 'users', uid, 'notifications', id), { read: true, readAt });
  }
  await batch.commit();
}

export function countUnreadNotifications(items: UserNotification[]): number {
  return items.filter(item => !item.read).length;
}
