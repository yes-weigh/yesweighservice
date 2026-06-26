import React, { useEffect, useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, ClipboardList, KeyRound, Shield, Users, Warehouse } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  canManageHr,
  canManageStaffRolesInHr,
  canManageSuperAdminsInHr,
  canManageWarehouseUsers,
  canViewHr,
} from '../../lib/staffAccess';

type HrLayoutProps = {
  basePath: string;
};

export const HrLayout: React.FC<HrLayoutProps> = ({ basePath }) => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const showSuperAdmins = canManageSuperAdminsInHr(user);
  const showRoles = canManageStaffRolesInHr(user);
  const showWarehouse = canManageWarehouseUsers(user);

  const tabs = useMemo(() => {
    const items = [
      { id: 'staff', label: 'Staff', path: `${basePath}/hr/staff`, icon: <Users size={16} /> },
      {
        id: 'report',
        label: 'Report',
        path: `${basePath}/hr/report`,
        icon: <ClipboardList size={16} />,
      },
      {
        id: 'holidays',
        label: 'Holiday calendar',
        path: `${basePath}/hr/holidays`,
        icon: <CalendarDays size={16} />,
      },
    ];
    if (showRoles) {
      items.push({
        id: 'roles',
        label: 'Roles',
        path: `${basePath}/hr/roles`,
        icon: <KeyRound size={16} />,
      });
    }
    if (showWarehouse) {
      items.push({
        id: 'warehouse',
        label: 'Warehouse',
        path: `${basePath}/hr/warehouse`,
        icon: <Warehouse size={16} />,
      });
    }
    if (showSuperAdmins) {
      items.push({
        id: 'super-admins',
        label: 'Super Admins',
        path: `${basePath}/hr/super-admins`,
        icon: <Shield size={16} />,
      });
    }
    return items;
  }, [basePath, showRoles, showSuperAdmins, showWarehouse]);

  useEffect(() => {
    if (location.pathname === `${basePath}/hr` || location.pathname === `${basePath}/hr/`) {
      navigate(`${basePath}/hr/staff`, { replace: true });
    }
  }, [basePath, location.pathname, navigate]);

  if (!user || !canViewHr(user)) {
    return (
      <div className="page-content fade-in">
        <div className="panel glass">
          <p className="text-muted">You do not have permission to access HR.</p>
        </div>
      </div>
    );
  }

  const isTabActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <div className="hr-hub">
      <header className="hr-hub__header panel glass">
        <div>
          <h2>Human Resources</h2>
          <p className="text-muted text-sm">Staff records, work reports, holidays, warehouse users, roles, and super admins.</p>
        </div>
        {canManageHr(user) && isTabActive(`${basePath}/hr/staff`) && (
          <Link to={`${basePath}/hr/staff/new`} className="btn btn-primary btn-sm">
            Add staff
          </Link>
        )}
      </header>

      <nav className="hr-hub__tabs panel glass" aria-label="HR sections">
        {tabs.map(tab => (
          <Link
            key={tab.id}
            to={tab.path}
            className={`hr-hub__tab ${isTabActive(tab.path) ? 'is-active' : ''}`}
          >
            {tab.icon}
            {tab.label}
          </Link>
        ))}
        <Link
          to={`${basePath}/hr/me`}
          className={`hr-hub__tab hr-hub__tab--me ${isTabActive(`${basePath}/hr/me`) ? 'is-active' : ''}`}
        >
          My profile
        </Link>
      </nav>

      <Outlet />
    </div>
  );
};
