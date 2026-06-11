import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homePathForRole, ROLE_LABELS } from '../types';
import {
  LayoutDashboard,
  Package,
  ShieldCheck,
  GraduationCap,
  ClipboardCheck,
  Bell,
  Bot,
  Wrench,
  Megaphone,
  UserCircle,
  Users,
  UserCog,
  Building2,
  Menu,
  X,
  LogOut,
} from 'lucide-react';
import { Logo } from './Logo';

type NavItem = {
  path: string;
  icon: React.ReactNode;
  label: string;
};

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [pageRefreshKey, setPageRefreshKey] = useState(0);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (!user) return null;

  const getNavItems = (): NavItem[] => {
    switch (user.role) {
      case 'super_admin':
        return [
          { path: '/super-admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/super-admin/staff', icon: <Users size={20} />, label: 'Staff' },
          { path: '/super-admin/dealers', icon: <Building2 size={20} />, label: 'Dealers' },
          { path: '/super-admin/dealer-staff', icon: <UserCog size={20} />, label: 'Dealer Staff' },
        ];
      case 'staff':
        return [
          { path: '/staff', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/staff/dealers', icon: <Building2 size={20} />, label: 'Dealers' },
          { path: '/staff/dealer-staff', icon: <UserCog size={20} />, label: 'Dealer Staff' },
          { path: '/staff/profile', icon: <UserCircle size={20} />, label: 'My Profile' },
        ];
      case 'dealer':
        return [
          { path: '/dealer', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/dealer/service', icon: <Wrench size={20} />, label: 'Service' },
          { path: '/dealer/products', icon: <Package size={20} />, label: 'Products' },
          {
            path: '/dealer/verification',
            icon: <ShieldCheck size={20} />,
            label: 'Verification',
          },
          {
            path: '/dealer/advertisements',
            icon: <Megaphone size={20} />,
            label: 'Advertisements',
          },
          { path: '/dealer/training', icon: <GraduationCap size={20} />, label: 'Training' },
          {
            path: '/dealer/quality',
            icon: <ClipboardCheck size={20} />,
            label: 'QMS',
          },
          { path: '/dealer/notifications', icon: <Bell size={20} />, label: 'Notifications' },
          { path: '/dealer/team', icon: <Users size={20} />, label: 'Dealer Staff' },
          { path: '/dealer/ai-assistant', icon: <Bot size={20} />, label: 'AI Assistent' },
          { path: '/dealer/profile', icon: <UserCircle size={20} />, label: 'My Profile' },
        ];
      case 'dealer_staff':
        return [
          { path: '/dealer-staff', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/dealer-staff/service', icon: <Wrench size={20} />, label: 'Service' },
          { path: '/dealer-staff/products', icon: <Package size={20} />, label: 'Products' },
          {
            path: '/dealer-staff/verification',
            icon: <ShieldCheck size={20} />,
            label: 'Verification',
          },
          {
            path: '/dealer-staff/advertisements',
            icon: <Megaphone size={20} />,
            label: 'Advertisements',
          },
          { path: '/dealer-staff/training', icon: <GraduationCap size={20} />, label: 'Training' },
          {
            path: '/dealer-staff/quality',
            icon: <ClipboardCheck size={20} />,
            label: 'QMS',
          },
          { path: '/dealer-staff/notifications', icon: <Bell size={20} />, label: 'Notifications' },
          { path: '/dealer-staff/profile', icon: <UserCircle size={20} />, label: 'My Profile' },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();
  const home = homePathForRole(user.role);

  const currentNavItem = navItems.find(item => {
    if (location.pathname === item.path) return true;
    if (item.path === home) return false;
    return location.pathname.startsWith(`${item.path}/`);
  });

  const pageTitle = currentNavItem?.label ?? 'Dashboard';

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handleNavClick = (path: string) => {
    if (location.pathname === path) {
      setPageRefreshKey(k => k + 1);
    } else {
      navigate(path);
    }
    setMobileOpen(false);
  };

  const isActive = (path: string) => {
    if (path === home) return location.pathname === path;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <div className="app-wrapper">
      {isMobile && mobileOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={[
          'sidebar',
          collapsed && !isMobile ? 'collapsed' : '',
          isMobile && mobileOpen ? 'mobile-open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="sidebar-header">
          <div className="logo-area">
            <Logo size={collapsed ? 'sm' : 'md'} showText={!collapsed} />
          </div>
          {!isMobile && (
            <button
              type="button"
              className="collapse-btn"
              onClick={() => setCollapsed(c => !c)}
              aria-label="Toggle sidebar"
            >
              {collapsed ? <Menu size={18} /> : <X size={18} />}
            </button>
          )}
        </div>

        <nav className="nav-menu">
          {navItems.map(item => (
            <button
              key={item.path}
              type="button"
              className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
              onClick={() => handleNavClick(item.path)}
            >
              <span className="nav-icon">{item.icon}</span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!collapsed && (
            <div className="sidebar-user">
              <strong>{user.displayName}</strong>
              <span className="text-muted text-sm">{user.email}</span>
            </div>
          )}
          <button type="button" className="logout-btn w-full" onClick={handleLogout}>
            <LogOut size={16} />
            {!collapsed && 'Sign out'}
          </button>
        </div>
      </aside>

      <main className={`main-content ${collapsed && !isMobile ? 'expanded' : ''}`}>
        <header className="top-bar glass">
          {isMobile && (
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
          )}
          <h1 className="page-title">{pageTitle}</h1>
          <div className="user-chip">
            <span className="role-badge">{ROLE_LABELS[user.role]}</span>
          </div>
        </header>

        <div className="content-area">
          <Outlet key={pageRefreshKey} />
        </div>
      </main>
    </div>
  );
};
