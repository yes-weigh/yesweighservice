import { getMessaging, getToken, isSupported, onMessage, type Messaging } from 'firebase/messaging';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { app, db } from '../firebase';

const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY as string | undefined;

let messagingInstance: Messaging | null = null;

function tokenDocId(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  }
  return `t_${Math.abs(hash)}`;
}

export async function isPushSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

async function getMessagingInstance(): Promise<Messaging | null> {
  if (messagingInstance) return messagingInstance;
  if (!(await isPushSupported())) return null;
  messagingInstance = getMessaging(app);
  return messagingInstance;
}

async function ensureMessagingServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
  if (existing) return existing;
  try {
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

export function pushPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function savePushToken(uid: string, token: string): Promise<void> {
  const id = tokenDocId(token);
  await setDoc(
    doc(db, 'users', uid, 'pushTokens', id),
    {
      token,
      platform: 'web',
      userAgent: navigator.userAgent.slice(0, 200),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function registerPushNotifications(uid: string): Promise<{
  enabled: boolean;
  reason?: string;
}> {
  if (import.meta.env.DEV) {
    return { enabled: false, reason: 'Push is disabled in local development.' };
  }

  if (!(await isPushSupported())) {
    return { enabled: false, reason: 'Push notifications are not supported on this browser.' };
  }

  if (!VAPID_KEY) {
    return { enabled: false, reason: 'Push is not configured yet. Add VITE_FCM_VAPID_KEY.' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { enabled: false, reason: 'Notification permission was not granted.' };
  }

  const messaging = await getMessagingInstance();
  if (!messaging) {
    return { enabled: false, reason: 'Could not initialize messaging.' };
  }

  const registration = await ensureMessagingServiceWorker();
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration ?? undefined,
  });

  if (!token) {
    return { enabled: false, reason: 'Could not get a push token from the browser.' };
  }

  await savePushToken(uid, token);
  return { enabled: true };
}

export function subscribeForegroundPush(
  onPayload: (payload: { title: string; body: string; url?: string }) => void,
): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;

  void (async () => {
    const messaging = await getMessagingInstance();
    if (!messaging || cancelled) return;
    unsubscribe = onMessage(messaging, payload => {
      const title = payload.notification?.title ?? 'YesOne';
      const body = payload.notification?.body ?? '';
      const url = payload.data?.url;
      onPayload({ title, body, url });
    });
  })();

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
