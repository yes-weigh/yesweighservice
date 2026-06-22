import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  pushPermissionState,
  registerPushNotifications,
} from '../lib/pushNotifications';

/** Silently refresh the FCM token when the user is signed in and already granted permission. */
export function PushNotificationManager() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user || import.meta.env.DEV) return;
    if (pushPermissionState() !== 'granted') return;
    void registerPushNotifications(user.uid);
  }, [user]);

  return null;
}
