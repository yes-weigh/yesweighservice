import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { User } from '../types';
import { useCart } from '../context/useCart';
import { useCartFly } from '../context/useCartFly';
import { homePathForRole, canUseCart } from '../types';
import { canAccessNavFeature, type StaffNavFeature } from '../lib/staffAccess';
import {
  ArrowLeft,
  LayoutDashboard,
  Package,
  Boxes,
  LifeBuoy,
  ShieldCheck,
  GraduationCap,
  Bell,
  Bot,
  Wrench,
  RotateCcw,
  Megaphone,
  MessageSquareWarning,
  FileText,
  ShoppingCart,
  UserCircle,
  Users,
  UserCog,
  Building2,
  Menu,
  X,
  UserRoundPlus,
  ListTodo,
} from 'lucide-react';
import { Logo } from './Logo';
import { PageHeaderProvider, usePageHeader } from '../context/PageHeaderContext';

type NavItem = {
  path: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
};

function portalNavItems(home: string, itemCount: number, order: 'default' | 'staff' = 'default'): NavItem[] {
  const items: Record<string, NavItem> = {
    products: { path: `${home}/products`, icon: <Package size={20} />, label: 'Products' },
    orders: {
      path: `${home}/orders`,
      icon: <ShoppingCart size={20} />,
      label: 'Orders',
      badge: itemCount > 0 ? itemCount : undefined,
    },
    spares: { path: `${home}/spares`, icon: <Boxes size={20} />, label: 'Spares' },
    complaints: { path: `${home}/complaints`, icon: <MessageSquareWarning size={20} />, label: 'Complaints' },
    warrantySupport: {
      path: `${home}/warranty-support`,
      icon: <LifeBuoy size={20} />,
      label: 'Warranty & Support',
    },
    services: { path: `${home}/services`, icon: <Wrench size={20} />, label: 'Services' },
    returns: { path: `${home}/returns`, icon: <RotateCcw size={20} />, label: 'Returns' },
    verification: { path: `${home}/verification`, icon: <ShieldCheck size={20} />, label: 'Verifications' },
    advertisements: { path: `${home}/advertisements`, icon: <Megaphone size={20} />, label: 'Advertisement' },
    invoices: { path: `${home}/invoices`, icon: <FileText size={20} />, label: 'Invoice' },
    aiAssistant: { path: `${home}/ai-assistant`, icon: <Bot size={20} />, label: 'AI assistance' },
    notifications: { path: `${home}/notifications`, icon: <Bell size={20} />, label: 'Notifications' },
    training: { path: `${home}/training`, icon: <GraduationCap size={20} />, label: 'Trainings' },
  };

  const sequence =
    order === 'staff'
      ? [
          'orders',
          'products',
          'spares',
          'warrantySupport',
          'verification',
          'advertisements',
          'invoices',
          'aiAssistant',
          'notifications',
          'training',
        ]
      : [
          'products',
          'orders',
          'spares',
          'warrantySupport',
          'verification',
          'advertisements',
          'invoices',
          'aiAssistant',
          'notifications',
          'training',
        ];

  return sequence.map((key) => items[key]);
}

function staffPathToFeature(path: string): StaffNavFeature {
  if (path === '/staff') return 'dashboard';
  const suffix = path.replace(/^\/staff\/?/, '').split('/')[0];
  const map: Record<string, StaffNavFeature> = {
    tasks: 'tasks',
    dealers: 'dealers',
    leads: 'leads',
    products: 'products',
    orders: 'orders',
    spares: 'spares',
    'warranty-support': 'warranty-support',
    verification: 'verification',
    advertisements: 'advertisements',
    invoices: 'invoices',
    'ai-assistant': 'ai-assistant',
    notifications: 'notifications',
    training: 'training',
  };
  return map[suffix] ?? 'dashboard';
}

function filterStaffNavItems(user: User, items: NavItem[]): NavItem[] {
  return items.filter(item => canAccessNavFeature(user, staffPathToFeature(item.path)));
}

export const Layout: React.FC = () => (
  <PageHeaderProvider>
    <LayoutShell />
  </PageHeaderProvider>
);

const LayoutShell: React.FC = () => {
  const { user } = useAuth();
  const { itemCount } = useCart();
  const { registerCartTarget, cartBump } = useCartFly();
  const { config: pageHeader } = usePageHeader();
  const cartBtnRef = useRef<HTMLButtonElement>(null);
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

  const showCartFlyTarget = canUseCart(user?.role);
  const cartBadgeCount = showCartFlyTarget ? itemCount : 0;

  useEffect(() => {
    if (showCartFlyTarget) {
      registerCartTarget(cartBtnRef.current);
    } else {
      registerCartTarget(null);
    }
    return () => registerCartTarget(null);
  }, [registerCartTarget, showCartFlyTarget, itemCount]);

  if (!user) return null;

  const getNavItems = (): NavItem[] => {
    switch (user.role) {
      case 'super_admin':
        return [
          { path: '/super-admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/super-admin/products', icon: <Package size={20} />, label: 'Products' },
          { path: '/super-admin/spares', icon: <Boxes size={20} />, label: 'Spares' },
          { path: '/super-admin/staff', icon: <Users size={20} />, label: 'Staff' },
          { path: '/super-admin/dealers', icon: <Building2 size={20} />, label: 'Dealers' },
          { path: '/super-admin/dealer-accounts', icon: <UserCircle size={20} />, label: 'Dealer Logins' },
          { path: '/super-admin/dealer-staff', icon: <UserCog size={20} />, label: 'Dealer Staff' },
        ];
      case 'staff':
        return filterStaffNavItems(user, [
          { path: '/staff', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/staff/tasks', icon: <ListTodo size={20} />, label: 'Tasks' },
          { path: '/staff/dealers', icon: <Building2 size={20} />, label: 'Dealers' },
          { path: '/staff/leads', icon: <UserRoundPlus size={20} />, label: 'Leads' },
          ...portalNavItems('/staff', cartBadgeCount, 'staff'),
        ]);
      case 'dealer':
        return [
          { path: '/dealer', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          ...portalNavItems('/dealer', cartBadgeCount),
          { path: '/dealer/team', icon: <Users size={20} />, label: 'Staffs' },
        ];
      case 'dealer_staff':
        return [
          { path: '/dealer-staff', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/dealer-staff/warranty-support', icon: <LifeBuoy size={20} />, label: 'Warranty & Support' },
          { path: '/dealer-staff/products', icon: <Package size={20} />, label: 'Products' },
          { path: '/dealer-staff/spares', icon: <Boxes size={20} />, label: 'Spares' },
          {
            path: '/dealer-staff/orders',
            icon: <ShoppingCart size={20} />,
            label: 'Orders',
            badge: cartBadgeCount > 0 ? cartBadgeCount : undefined,
          },
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
          { path: '/dealer-staff/notifications', icon: <Bell size={20} />, label: 'Notifications' },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();
  const home = homePathForRole(user.role);
  const profilePath = `${home}/profile`;

  const currentNavItem = navItems.find(item => {
    if (location.pathname === item.path) return true;
    if (item.path === home) return false;
    return location.pathname.startsWith(`${item.path}/`);
  });

  const isProfileActive = profilePath !== null && location.pathname === profilePath;
  const isProductDetail = /\/products\/[^/]+$/.test(location.pathname)
    || /\/spares\/product\/[^/]+$/.test(location.pathname)
    || /\/spares\/[^/]+$/.test(location.pathname)
    || /^\/oc\/[^/]+$/.test(location.pathname);
  const isSpareMapDetail = /\/spares\/product\/[^/]+$/.test(location.pathname);
  const isDealerDetail = /\/dealers\/[^/]+$/.test(location.pathname);
  const dealerListPath = isDealerDetail
    ? location.pathname.replace(/\/[^/]+$/, '')
    : null;
  const isInvoiceDetail = /\/invoices\/[^/]+(\/(invoice(\/view)?|payments|logistic|qc))?$/.test(location.pathname);
  const isSupportDetail = /\/warranty-support\/[^/]+$/.test(location.pathname);
  const pageTitle = isProfileActive
    ? 'Profile'
    : isDealerDetail
      ? 'Dealer'
    : isInvoiceDetail
      ? 'Invoice'
    : isSupportDetail
      ? 'Support'
    : isSpareMapDetail
      ? 'Map spares'
    : isProductDetail
      ? 'Product Details'
      : (currentNavItem?.label ?? 'Dashboard');
  const displayTitle = pageHeader.title ?? pageTitle;
  const showHeaderBack = Boolean(pageHeader.showBack && pageHeader.onBack);

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
          isMobile ? 'sidebar--mobile' : '',
          collapsed && !isMobile ? 'collapsed' : '',
          isMobile && mobileOpen ? 'mobile-open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="sidebar-header">
          <div className="logo-area">
            <Logo size={collapsed || isMobile ? 'sm' : 'md'} showText={!collapsed} />
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
              <span className="nav-icon">
                {item.icon}
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="nav-badge" aria-label={`${item.badge} items in cart`}>
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </button>
          ))}
        </nav>

        {profilePath && (
          <div className="sidebar-profile">
            <button
              type="button"
              className={`nav-item ${isProfileActive ? 'active' : ''}`}
              onClick={() => handleNavClick(profilePath)}
              aria-label="Open profile"
              title="Profile"
            >
              <span className="nav-icon">
                <UserCircle size={20} />
              </span>
              {!collapsed && <span className="nav-label">Profile</span>}
            </button>
          </div>
        )}
      </aside>

      <main className={`main-content ${collapsed && !isMobile ? 'expanded' : ''}`}>
        <header className="top-bar">
          {showHeaderBack ? (
            <button
              type="button"
              className="top-bar__back-btn"
              onClick={() => pageHeader.onBack?.()}
              aria-label="Back"
            >
              <ArrowLeft size={22} />
            </button>
          ) : isMobile ? (
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
          ) : null}
          {dealerListPath ? (
            <button
              type="button"
              className="page-title page-title--nav-back"
              onClick={() => navigate(dealerListPath)}
            >
              {displayTitle}
            </button>
          ) : (
            <h1 className="page-title">{displayTitle}</h1>
          )}
          {showCartFlyTarget && (
            <button
              ref={cartBtnRef}
              id="cart-fly-target"
              type="button"
              className={`cart-header-btn ${cartBump ? 'cart-header-btn--bump' : ''} ${itemCount > 0 ? 'cart-header-btn--has-items' : ''}`}
              onClick={() => handleNavClick(`${home}/orders`)}
              aria-label={itemCount > 0 ? `View cart, ${itemCount} items` : 'View cart'}
              title="View cart"
            >
              <ShoppingCart size={22} />
              {itemCount > 0 && (
                <span className="cart-header-btn__badge">{itemCount > 99 ? '99+' : itemCount}</span>
              )}
            </button>
          )}
        </header>

        <div className="content-area">
          <Outlet key={pageRefreshKey} />
        </div>
      </main>
    </div>
  );
};
