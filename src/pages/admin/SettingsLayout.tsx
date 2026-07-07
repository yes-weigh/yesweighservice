import React, { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box, Layers, Package, UserCircle } from 'lucide-react';

const tabs = [
  { id: 'profile', label: 'Profile', path: '/super-admin/settings/profile', icon: <UserCircle size={16} /> },
  { id: 'warehouse', label: 'Warehouse', path: '/super-admin/settings/warehouse', icon: <Layers size={16} /> },
  { id: 'store-room', label: 'Store room', path: '/super-admin/settings/store-room', icon: <Box size={16} /> },
  { id: 'product', label: 'Product settings', path: '/super-admin/settings/product', icon: <Package size={16} /> },
] as const;

export const SettingsLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (
      location.pathname === '/super-admin/settings'
      || location.pathname === '/super-admin/settings/'
    ) {
      navigate('/super-admin/settings/profile', { replace: true });
    }
  }, [location.pathname, navigate]);

  const isTabActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <div className="settings-hub page-content fade-in">
      <header className="settings-hub__header panel glass">
        <div>
          <h2>Settings</h2>
          <p className="text-muted text-sm">
            Account profile, warehouse zones, store room layout, and product settings.
          </p>
        </div>
      </header>

      <nav className="settings-hub__tabs panel glass" aria-label="Settings sections">
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
