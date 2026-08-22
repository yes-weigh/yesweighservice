import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { AlertCircle, LogOut } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import type { FirestoreUserDoc } from '../../types';
import { formatLoginIdDisplay, loginIdTypeLabel } from '../../lib/loginAuth';
import { resolveProfileLogin } from '../../lib/profileLogin';
import { DealerPortalProfile } from '../dealers/DealerPortalProfile';
import { FetchingLoader } from '../FetchingLoader';
import { dealerErrorMessage, fetchMyDealerProfile, updateMyDealerAddresses } from '../../lib/dealers';
import { canEditDealerProfileAddresses } from '../../lib/dealerAccess';
import type { ZohoDealer } from '../../types/dealers';

export const ProfilePanel: React.FC<{
  showSignOut?: boolean;
  className?: string;
}> = ({ showSignOut = true, className = '' }) => {
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
      <div className={`profile-page__panel panel glass ${className}`.trim()}>
        <div className="loader-ring mx-auto" />
      </div>
    );
  }

  const login = resolveProfileLogin(profile) ?? {
    type: user.loginIdType,
    value: user.loginId,
  };

  const panelClass = [
    'profile-page__panel',
    isDealerPortalUser ? 'profile-page__panel--dealer panel glass' : 'panel glass',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={panelClass}>
      {isDealerPortalUser ? (
        <>
          {dealerError && (
            <div className="products-inline-error profile-page__error">
              <AlertCircle size={18} />
              <span>{dealerError}</span>
            </div>
          )}
          {dealerLoading && !dealer ? (
            <FetchingLoader label="Loading profile…" />
          ) : dealer ? (
            <DealerPortalProfile
              dealer={dealer}
              personFallback={profile.displayName}
              canEditAddresses={canEditDealerProfileAddresses(user)}
              onSaveAddresses={async patch => {
                try {
                  const next = await updateMyDealerAddresses(patch);
                  setDealer(next);
                } catch (err) {
                  throw new Error(dealerErrorMessage(err));
                }
              }}
              onSignOut={showSignOut ? () => void handleLogout() : undefined}
            />
          ) : (
            <div className="config-box">
              <p><span className="text-muted">Name:</span> <span className="highlight">{profile.displayName}</span></p>
              <p>
                <span className="text-muted">Login ID ({loginIdTypeLabel(login.type)}):</span>{' '}
                {formatLoginIdDisplay(login.type, login.value)}
              </p>
              {!dealerError && (
                <p className="text-muted text-sm">Dealer details are not available for this account.</p>
              )}
              {showSignOut && (
                <div className="profile-page__signout">
                  <button type="button" className="logout-btn" onClick={() => void handleLogout()}>
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="config-box">
            <p><span className="text-muted">Name:</span> <span className="highlight">{profile.displayName}</span></p>
            <p>
              <span className="text-muted">Login ID ({loginIdTypeLabel(login.type)}):</span>{' '}
              {formatLoginIdDisplay(login.type, login.value)}
            </p>
            {profile.email && (
              <p><span className="text-muted">Email:</span> {profile.email}</p>
            )}
            <p><span className="text-muted">Phone:</span> {profile.phone || '—'}</p>
          </div>
          {showSignOut && (
            <div className="profile-page__signout">
              <button type="button" className="logout-btn" onClick={() => void handleLogout()}>
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
