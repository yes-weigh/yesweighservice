import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Building2, UserCog, Users } from 'lucide-react';
import { db } from '../../firebase';
import type { FirestoreUserDoc } from '../../types';
import { normalizeRole } from '../../types';

export const SuperAdminDashboard: React.FC = () => {
  const [counts, setCounts] = useState({ staff: 0, dealers: 0, dealerStaff: 0 });

  useEffect(() => {
    void (async () => {
      const snap = await getDocs(collection(db, 'users'));
      const users = snap.docs
        .map(d => normalizeRole(String((d.data() as FirestoreUserDoc).role ?? '')))
        .filter(Boolean);
      setCounts({
        staff: users.filter(r => r === 'staff').length,
        dealers: users.filter(r => r === 'dealer').length,
        dealerStaff: users.filter(r => r === 'dealer_staff').length,
      });
    })();
  }, []);

  return (
    <div className="page-content fade-in">
      <div className="stats-grid stats-grid--3 mb-6">
        <div className="stat-card glass">
          <div className="stat-icon"><Users size={28} /></div>
          <div>
            <h3>Staff</h3>
            <div className="stat-value">{counts.staff}</div>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon"><Building2 size={28} /></div>
          <div>
            <h3>Dealers</h3>
            <div className="stat-value">{counts.dealers}</div>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon"><UserCog size={28} /></div>
          <div>
            <h3>Dealer Staff</h3>
            <div className="stat-value">{counts.dealerStaff}</div>
          </div>
        </div>
      </div>

      <div className="panel glass">
        <h2>Super Admin</h2>
        <p className="text-muted mt-4">
          Full control over YesWeigh Service — manage company staff, dealers, and dealer
          staff across the organisation.
        </p>
      </div>
    </div>
  );
};
