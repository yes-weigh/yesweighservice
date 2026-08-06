import React, { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box, CalendarRange, Layers, Package, Printer, Tag, Truck, UserCircle } from 'lucide-react';
import { isLocalhostDev } from '../../lib/isLocalhost';

const baseTabs = [
  { id: 'profile', label: 'Profile', path: '/super-admin/settings/profile', icon: <UserCircle size={16} /> },
  { id: 'warehouse', label: 'Warehouse', path: '/super-admin/settings/warehouse', icon: <Layers size={16} /> },
  { id: 'store-room', label: 'Store room', path: '/super-admin/settings/store-room', icon: <Box size={16} /> },
  { id: 'audit-cycles', label: 'Audit', path: '/super-admin/settings/audit-cycles', icon: <CalendarRange size={16} /> },
  { id: 'product', label: 'Product settings', path: '/super-admin/settings/product', icon: <Package size={16} /> },
  { id: 'logistics', label: 'Logistics', path: '/super-admin/settings/logistics', icon: <Truck size={16} /> },
  { id: 'local-printers', label: 'Label printing', path: '/super-admin/settings/local-printers', icon: <Printer size={16} /> },
] as const;

const skuCorrectionTab = {
  id: 'sku-correction',
  label: 'SKU correction',
  path: '/super-admin/settings/sku-correction',
  icon: <Tag size={16} />,
} as const;

export const SettingsLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const showSkuCorrection = isLocalhostDev();

  const tabs = showSkuCorrection
    ? [
        ...baseTabs.slice(0, 5),
        skuCorrectionTab,
        ...baseTabs.slice(5),
      ]
    : [...baseTabs];

  useEffect(() => {
    if (
      location.pathname === '/super-admin/settings'
      || location.pathname === '/super-admin/settings/'
    ) {
      navigate('/super-admin/settings/profile', { replace: true });
      return;
    }
    if (
      !isLocalhostDev()
      && location.pathname.startsWith('/super-admin/settings/sku-correction')
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
            {showSkuCorrection
              ? 'Account profile, warehouse zones, store room layout, audit, product settings, SKU correction, logistics, and label printing.'
              : 'Account profile, warehouse zones, store room layout, audit, product settings, logistics, and label printing.'}
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
