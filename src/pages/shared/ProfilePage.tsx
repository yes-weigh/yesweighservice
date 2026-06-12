import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { LogOut } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import type { FirestoreUserDoc } from '../../types';
import { ROLE_LABELS, normalizeRole, readDealerId } from '../../types';

export const ProfilePage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<FirestoreUserDoc | null>(null);

  useEffect(() => {
    if (!user) return;
    void getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (snap.exists()) setProfile(snap.data() as FirestoreUserDoc);
    });
  }, [user]);

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

  return (
    <div className="page-content fade-in">
      <div className="panel glass max-w-4xl">
        <h2>Profile</h2>
        <div className="config-box mt-4">
          <p><span className="text-muted">Name:</span> <span className="highlight">{profile.displayName}</span></p>
          <p><span className="text-muted">Email:</span> {profile.email}</p>
          <p><span className="text-muted">Role:</span> {ROLE_LABELS[normalizeRole(String(profile.role)) ?? 'staff']}</p>
          <p><span className="text-muted">Phone:</span> {profile.phone || '—'}</p>
          {readDealerId(profile) && (
            <p><span className="text-muted">Dealer ID:</span> {readDealerId(profile)}</p>
          )}
        </div>

        <div className="profile-actions mt-4">
          <button type="button" className="logout-btn" onClick={handleLogout}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
