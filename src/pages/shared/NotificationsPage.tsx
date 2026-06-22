import React, { useEffect, useState } from 'react';
import { Bell, BellOff, CheckCheck, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  isPushSupported,
  pushPermissionState,
  registerPushNotifications,
  subscribeForegroundPush,
} from '../../lib/pushNotifications';
import {
  countUnreadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeUserNotifications,
  type UserNotification,
} from '../../lib/userNotifications';
import { formatInvoiceDate } from '../../lib/invoices';

export const NotificationsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushState, setPushState] = useState<'unknown' | 'enabled' | 'disabled' | 'unsupported'>('unknown');
  const [pushMessage, setPushMessage] = useState('');
  const [enabling, setEnabling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return undefined;

    void (async () => {
      const supported = await isPushSupported();
      if (!supported) {
        setPushState('unsupported');
        return;
      }
      setPushState(pushPermissionState() === 'granted' ? 'enabled' : 'disabled');
    })();

    const unsubNotifications = subscribeUserNotifications(
      user.uid,
      next => {
        setItems(next);
        setLoading(false);
      },
      () => setLoading(false),
    );

    const unsubForeground = subscribeForegroundPush(payload => {
      setToast(`${payload.title}: ${payload.body}`);
      window.setTimeout(() => setToast(null), 5000);
    });

    return () => {
      unsubNotifications();
      unsubForeground();
    };
  }, [user]);

  const handleEnablePush = async () => {
    if (!user) return;
    setEnabling(true);
    setPushMessage('');
    const result = await registerPushNotifications(user.uid);
    setEnabling(false);
    if (result.enabled) {
      setPushState('enabled');
      setPushMessage('Push notifications enabled on this device.');
    } else {
      setPushState('disabled');
      setPushMessage(result.reason ?? 'Could not enable push notifications.');
    }
  };

  const openNotification = async (item: UserNotification) => {
    if (!user) return;
    if (!item.read) {
      await markNotificationRead(user.uid, item.id);
    }
    navigate(item.url);
  };

  const unreadCount = countUnreadNotifications(items);

  return (
    <div className="page-content fade-in notifications-page">
      <header className="notifications-page__header">
        <div>
          <h2>Notifications</h2>
          <p className="text-muted text-sm">
            Support updates and ticket replies on this device.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => user && void markAllNotificationsRead(
              user.uid,
              items.filter(item => !item.read).map(item => item.id),
            )}
          >
            <CheckCheck size={16} />
            Mark all read
          </button>
        )}
      </header>

      {toast && (
        <div className="notifications-page__toast panel glass" role="status">
          {toast}
        </div>
      )}

      <section className="notifications-page__push panel glass">
        <div className="notifications-page__push-copy">
          <h3>Push on this device</h3>
          <p className="text-muted text-sm">
            Get alerts when support tickets are created, assigned, or replied to.
          </p>
          {pushMessage && <p className="text-sm mt-2">{pushMessage}</p>}
        </div>
        {pushState === 'unsupported' ? (
          <span className="text-muted text-sm notifications-page__push-status">
            <BellOff size={16} aria-hidden />
            Not supported
          </span>
        ) : pushState === 'enabled' ? (
          <span className="notifications-page__push-status notifications-page__push-status--on">
            <Bell size={16} aria-hidden />
            Enabled
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={enabling}
            onClick={() => void handleEnablePush()}
          >
            <Bell size={16} />
            {enabling ? 'Enabling…' : 'Enable push'}
          </button>
        )}
      </section>

      <section className="notifications-page__list panel glass">
        <h3>Recent</h3>
        {loading ? (
          <p className="text-muted text-sm">Loading notifications…</p>
        ) : items.length === 0 ? (
          <p className="text-muted text-sm">No notifications yet.</p>
        ) : (
          <ul className="notifications-page__items">
            {items.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`notifications-page__item ${item.read ? '' : 'is-unread'}`}
                  onClick={() => void openNotification(item)}
                >
                  <div className="notifications-page__item-main">
                    <strong>{item.title}</strong>
                    <p className="text-sm">{item.body}</p>
                    <span className="text-muted text-sm">
                      {formatInvoiceDate(item.createdAt)}
                    </span>
                  </div>
                  <ExternalLink size={16} className="notifications-page__item-icon" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
