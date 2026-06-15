import React from 'react';
import { Building2 } from 'lucide-react';

export const StaffDashboard: React.FC = () => (
  <div className="page-content fade-in">
    <div className="stats-grid stats-grid--3 mb-6">
      <div className="stat-card glass">
        <div className="stat-icon"><Building2 size={28} /></div>
        <div>
          <h3>Dealers</h3>
          <p className="text-muted text-sm">Onboard and manage dealer accounts</p>
        </div>
      </div>
    </div>

    <div className="panel glass">
      <h2>YesWeigh Staff Portal</h2>
      <p className="text-muted mt-4">
        Authorised company staff can credential dealers and run day-to-day service
        operations — products, orders, spares, and customer workflows.
      </p>
    </div>
  </div>
);
