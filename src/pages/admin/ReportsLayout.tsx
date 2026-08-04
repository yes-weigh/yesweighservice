import React, { useEffect, useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BadgeCheck, BarChart3 } from 'lucide-react';

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
    {
      id: 'gatc-report',
      label: 'GATC Billwise',
      path: `${basePath}/reports/gatc-report`,
      icon: <BadgeCheck size={16} />,
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
    <div className="reports-hub page-content fade-in">
      <div className="reports-hub__shell panel glass">
        <nav className="reports-hub__tabs" aria-label="Report sections">
          {tabs.map(tab => (
            <Link
              key={tab.id}
              to={tab.path}
              className={`reports-hub__tab ${isTabActive(tab.path) ? 'is-active' : ''}`}
            >
              {tab.icon}
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="reports-hub__body">
          <Outlet />
        </div>
      </div>
    </div>
  );
};
