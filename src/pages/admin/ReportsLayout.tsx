import React, { useEffect, useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';

type ReportsLayoutProps = {
  basePath: '/super-admin' | '/staff';
};

export const ReportsLayout: React.FC<ReportsLayoutProps> = ({ basePath }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = useMemo(() => [
    {
      id: 'audit-report',
      label: 'Audit report',
      path: `${basePath}/reports/audit-report`,
      icon: <BarChart3 size={16} />,
    },
  ], [basePath]);

  useEffect(() => {
    if (
      location.pathname === `${basePath}/reports`
      || location.pathname === `${basePath}/reports/`
    ) {
      navigate(`${basePath}/reports/audit-report`, { replace: true });
    }
  }, [basePath, location.pathname, navigate]);

  const isTabActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <div className="settings-hub page-content fade-in">
      <header className="settings-hub__header panel glass">
        <div>
          <h2>Reports</h2>
          <p className="text-muted text-sm">
            Operational reports across warehouse, store room, and audit cycles.
          </p>
        </div>
      </header>

      <nav className="settings-hub__tabs panel glass" aria-label="Report sections">
        {tabs.map(tab => (
          <Link
            key={tab.id}
            to={tab.path}
            className={`settings-hub__tab ${isTabActive(tab.path) ? 'is-active' : ''}`}
          >
            {tab.icon}
            {tab.label}
          </Link>
        ))}
      </nav>

      <Outlet />
    </div>
  );
};
