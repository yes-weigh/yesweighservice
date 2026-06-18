import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { AlertCircle, LogOut } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import type { FirestoreUserDoc } from '../../types';
import { ROLE_LABELS, normalizeRole } from '../../types';
import { formatLoginIdDisplay, loginIdTypeLabel } from '../../lib/loginAuth';
import { resolveProfileLogin } from '../../lib/profileLogin';
import { DealerDetailReadView } from '../../components/dealers/DealerDetailReadView';
import { FetchingLoader } from '../../components/FetchingLoader';
import { dealerErrorMessage, fetchMyDealerProfile } from '../../lib/dealers';
import type { ZohoDealer } from '../../types/dealers';

export const ProfilePage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<FirestoreUserDoc | null>(null);
  const [dealer, setDealer] = useState<ZohoDealer | null>(null);
  const [dealerLoading, setDealerLoading] = useState(false);
  const [dealerError, setDealerError] = useState('');

  const isDealerPortalUser = user?.role === 'dealer' || user?.role === 'dealer_staff';

  useEffect(() => {
    if (!user) return;
    void getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (snap.exists()) setProfile(snap.data() as FirestoreUserDoc);
    });
  }, [user]);

  useEffect(() => {
    if (!isDealerPortalUser) return;
    let cancelled = false;
    setDealerLoading(true);
    setDealerError('');

    void fetchMyDealerProfile()
      .then(data => {
        if (!cancelled) setDealer(data);
      })
      .catch(err => {
        if (!cancelled) {
          setDealer(null);
          setDealerError(dealerErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setDealerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDealerPortalUser]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (!user || !profile) {
    return (
      <div className="page-content">
        <div className="loader-ring mx-auto" />
      </div>
    );
  }

  const login = resolveProfileLogin(profile) ?? {
    type: user.loginIdType,
    value: user.loginId,
  };

  return (
    <div className="page-content fade-in profile-page">
      <div className="panel glass profile-page__account">
        <h2 className="profile-page__title">Account</h2>
        <div className="config-box">
          <p><span className="text-muted">Name:</span> <span className="highlight">{profile.displayName}</span></p>
          <p>
            <span className="text-muted">Login ID ({loginIdTypeLabel(login.type)}):</span>{' '}
            {formatLoginIdDisplay(login.type, login.value)}
          </p>
          {profile.email && (
            <p><span className="text-muted">Email:</span> {profile.email}</p>
          )}
          <p><span className="text-muted">Role:</span> {ROLE_LABELS[normalizeRole(String(profile.role)) ?? 'staff']}</p>
          <p><span className="text-muted">Phone:</span> {profile.phone || '—'}</p>
        </div>

        <div className="profile-actions">
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </div>

      {isDealerPortalUser && (
        <div className="panel glass profile-page__dealer">
          <h2 className="profile-page__title">Dealer details</h2>
          {dealerError && (
            <div className="products-inline-error profile-page__error">
              <AlertCircle size={18} />
              <span>{dealerError}</span>
            </div>
          )}
          {dealerLoading && !dealer ? (
            <FetchingLoader label="Loading dealer details…" />
          ) : dealer ? (
            <DealerDetailReadView dealer={dealer} />
          ) : !dealerError ? (
            <p className="text-muted text-sm">Dealer details are not available for this account.</p>
          ) : null}
        </div>
      )}
    </div>
  );
};
