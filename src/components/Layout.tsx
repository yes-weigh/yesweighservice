import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { User } from '../types';
import { useCart } from '../context/useCart';
import { useCartFly } from '../context/useCartFly';
import { homePathForRole } from '../types';
import { canUseOrderCart, orderCartPathForUser } from '../lib/salesOrderSegments';
import { navigateBack } from '../lib/navigation';
import { canAccessNavFeature, canViewHr, type StaffNavFeature } from '../lib/staffAccess';
import {
  ArrowLeft,
  ChevronDown,
  LayoutDashboard,
  Package,
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
  Settings,
  Users,
  Building2,
  Menu,
  X,
  UserRoundPlus,
  ListTodo,
  Truck,
  Gift,
  BarChart3,
  ClipboardList,
  ShoppingBag,
} from 'lucide-react';
import { Logo } from './Logo';
import { getAppVersionLabel } from '../lib/appVersion';
import { PageHeaderProvider, usePageHeader } from '../context/PageHeaderContext';

type NavItem = {
  path: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
};

const OPS_PRIORITY_SUFFIXES = [
  '/logistics',
  '/warranty-support',
] as const;

/** Shown after Invoices, before Reports. */
const OPS_BEFORE_REPORTS_SUFFIXES = [
  '/verification',
  '/advertisements',
  '/loyalty',
  '/training',
  '/notifications',
] as const;

/** Shown after Reports. */
const OPS_AFTER_REPORTS_SUFFIXES = [
  '/ai-assistant',
] as const;

const OPS_REST_SUFFIXES = [
  ...OPS_BEFORE_REPORTS_SUFFIXES,
  ...OPS_AFTER_REPORTS_SUFFIXES,
] as const;

const OPS_PATH_SUFFIXES = [...OPS_PRIORITY_SUFFIXES, ...OPS_REST_SUFFIXES] as const;

function operationsNavItems(
  home: string,
  suffixes: readonly string[] = OPS_PATH_SUFFIXES,
): NavItem[] {
  return portalNavItems(home, 'dealer').filter(item =>
    suffixes.some(suffix => item.path === `${home}${suffix}`),
  );
}

function portalNavItems(
  home: string,
  order: 'dealer' | 'staff' | 'dealer_staff' = 'dealer',
): NavItem[] {
  const items: Record<string, NavItem> = {
    catalog: { path: `${home}/products`, icon: <Package size={20} />, label: 'Products' },
    orders: {
      path: `${home}/sales-orders`,
      icon: <ClipboardList size={20} />,
      label: 'Sales orders',
    },
    complaints: { path: `${home}/complaints`, icon: <MessageSquareWarning size={20} />, label: 'Complaints' },
    warrantySupport: {
      path: `${home}/warranty-support`,
      icon: <LifeBuoy size={20} />,
      label: 'Warranty & Support',
    },
    services: { path: `${home}/services`, icon: <Wrench size={20} />, label: 'Services' },
    returns: { path: `${home}/returns`, icon: <RotateCcw size={20} />, label: 'Returns' },
    verification: { path: `${home}/verification`, icon: <ShieldCheck size={20} />, label: 'Verification' },
    advertisements: { path: `${home}/advertisements`, icon: <Megaphone size={20} />, label: 'Media Center' },
    invoices: { path: `${home}/invoices`, icon: <FileText size={20} />, label: 'Invoice' },
    logistics: { path: `${home}/logistics`, icon: <Truck size={20} />, label: 'Logistics' },
    loyalty: { path: `${home}/loyalty`, icon: <Gift size={20} />, label: 'Loyalty' },
    aiAssistant: { path: `${home}/ai-assistant`, icon: <Bot size={20} />, label: 'AI assistance' },
    notifications: { path: `${home}/notifications`, icon: <Bell size={20} />, label: 'Notifications' },
    training: { path: `${home}/training`, icon: <GraduationCap size={20} />, label: 'Trainings' },
  };

  const sequence =
    order === 'staff'
      ? [
          'catalog',
          'logistics',
          'warrantySupport',
          'verification',
          'advertisements',
          'invoices',
          'loyalty',
          'aiAssistant',
          'notifications',
          'training',
        ]
      : order === 'dealer_staff'
        ? [
            'catalog',
            'orders',
            'logistics',
            'warrantySupport',
            'invoices',
            'verification',
            'advertisements',
            'loyalty',
            'aiAssistant',
            'training',
            'notifications',
          ]
        : [
          'catalog',
          'orders',
          'logistics',
          'warrantySupport',
          'invoices',
          'verification',
          'advertisements',
          'loyalty',
          'training',
          'notifications',
          'aiAssistant',
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
    catalog: 'catalog',
    products: 'catalog',
    orders: 'orders',
    spares: 'catalog',
    'warranty-support': 'warranty-support',
    verification: 'verification',
    advertisements: 'advertisements',
    invoices: 'invoices',
    'sales-orders': 'sales-orders',
    'purchase-orders': 'purchase-orders',
    logistics: 'logistics',
    loyalty: 'loyalty',
    'ai-assistant': 'ai-assistant',
    notifications: 'notifications',
    training: 'training',
    hr: 'staff',
    reports: 'reports',
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
  const { config: pageHeader, headerSlot, titleMeta, topBarAction } = usePageHeader();
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

  const topBarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isMobile || !headerSlot) return undefined;
    const bar = topBarRef.current;
    const main = bar?.closest('.main-content') as HTMLElement | null;
    if (!bar || !main) return undefined;

    const syncHeaderHeight = () => {
      main.style.setProperty('--header-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    };

    syncHeaderHeight();
    const observer = new ResizeObserver(syncHeaderHeight);
    observer.observe(bar);
    window.addEventListener('resize', syncHeaderHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncHeaderHeight);
      main.style.removeProperty('--header-height');
    };
  }, [isMobile, headerSlot, topBarAction, location.pathname, pageHeader.mobileCompactHeader]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Keep cart fly target even when pages inject topBarAction (e.g. spare filters/sync).
  const showCartFlyTarget = canUseOrderCart(user)
    && !/\/warranty-support(\/|$)/.test(location.pathname);

  useEffect(() => {
    if (showCartFlyTarget) {
      registerCartTarget(cartBtnRef.current);
    } else {
      registerCartTarget(null);
    }
    return () => registerCartTarget(null);
  }, [registerCartTarget, showCartFlyTarget, itemCount, topBarAction]);

  if (!user) return null;

  const getNavItems = (): NavItem[] => {
    switch (user.role) {
      case 'super_admin':
        return [
          { path: '/super-admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/super-admin/products', icon: <Package size={20} />, label: 'Products' },
          { path: '/super-admin/sales-orders', icon: <ClipboardList size={20} />, label: 'Sales orders' },
          ...operationsNavItems('/super-admin', OPS_PRIORITY_SUFFIXES),
          { path: '/super-admin/hr', icon: <Users size={20} />, label: 'HR' },
          { path: '/super-admin/dealers', icon: <Building2 size={20} />, label: 'Dealers' },
          { path: '/super-admin/invoices', icon: <FileText size={20} />, label: 'Invoices' },
          { path: '/super-admin/purchase-orders', icon: <ShoppingBag size={20} />, label: 'Purchase order' },
          ...operationsNavItems('/super-admin', OPS_BEFORE_REPORTS_SUFFIXES),
          { path: '/super-admin/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
          ...operationsNavItems('/super-admin', OPS_AFTER_REPORTS_SUFFIXES),
        ];
      case 'staff': {
        const portal = portalNavItems('/staff', 'staff');
        const withExtras = [...portal];
        const productsIndex = withExtras.findIndex(item => item.path.endsWith('/products'));
        const insertAt = productsIndex >= 0 ? productsIndex + 1 : 0;
        withExtras.splice(
          insertAt,
          0,
          { path: '/staff/sales-orders', icon: <ClipboardList size={20} />, label: 'Sales orders' },
        );
        const notificationsIndex = withExtras.findIndex(item => item.path.endsWith('/notifications'));
        const reportsItem = { path: '/staff/reports', icon: <BarChart3 size={20} />, label: 'Reports' };
        if (notificationsIndex >= 0) {
          withExtras.splice(notificationsIndex + 1, 0, reportsItem);
        } else {
          withExtras.push(reportsItem);
        }
        const items: NavItem[] = [
          { path: '/staff', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          ...withExtras,
          { path: '/staff/tasks', icon: <ListTodo size={20} />, label: 'Tasks' },
          { path: '/staff/dealers', icon: <Building2 size={20} />, label: 'Dealers' },
          { path: '/staff/leads', icon: <UserRoundPlus size={20} />, label: 'Leads' },
        ];
        if (canViewHr(user)) {
          items.splice(1 + withExtras.length, 0, { path: '/staff/hr', icon: <Users size={20} />, label: 'HR' });
        }
        return filterStaffNavItems(user, items);
      }
      case 'dealer':
        return [
          ...portalNavItems('/dealer', 'dealer'),
          { path: '/dealer/team', icon: <Users size={20} />, label: 'Staffs' },
        ];
      case 'dealer_staff':
        return [
          ...portalNavItems('/dealer-staff', 'dealer_staff'),
        ];
      case 'media':
        return [
          { path: '/media', icon: <LayoutDashboard size={20} />, label: 'Home' },
          { path: '/media/products', icon: <Package size={20} />, label: 'Products' },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();
  const home = homePathForRole(user.role);
  const isSuperAdmin = user.role === 'super_admin';
  const footerNavPath = isSuperAdmin ? `${home}/settings` : `${home}/profile`;
  const isFooterNavActive = isSuperAdmin
    ? location.pathname === footerNavPath || location.pathname.startsWith(`${footerNavPath}/`)
    : location.pathname === footerNavPath;

  const currentNavItem = navItems.find(item => {
    if (location.pathname === item.path) return true;
    if (item.path === home) return false;
    return location.pathname.startsWith(`${item.path}/`);
  });

  const isCatalogSpareDetail = /\/(?:products|catalog)\/spare\/[^/]+$/.test(location.pathname);
  const isCatalogProductDetail = /\/(?:products|catalog)\/[^/]+$/.test(location.pathname)
    && !isCatalogSpareDetail
    && !/\/(?:products|catalog)\/map\//.test(location.pathname)
    && !location.pathname.endsWith('/products')
    && !location.pathname.endsWith('/catalog');
  const isProductDetail = isCatalogProductDetail
    || isCatalogSpareDetail
    || /\/spares\/[^/]+$/.test(location.pathname)
    || /^\/oc\/[^/]+$/.test(location.pathname);
  const isSpareMapDetail = /\/(?:products|catalog)\/map\/[^/]+$/.test(location.pathname)
    || /\/spares\/product\/[^/]+$/.test(location.pathname);
  const isDealerDetail = /\/dealers\/[^/]+$/.test(location.pathname);
  const dealerListPath = isDealerDetail
    ? location.pathname.replace(/\/[^/]+$/, '')
    : null;
  // Exclude list helpers like /invoices/import from "invoice detail" title handling.
  const isInvoiceDetail = /\/invoices\/(?!(?:sync|import)(?:\/|$))[^/]+(\/(invoice(\/view)?|payments|logistic|qc))?$/.test(
    location.pathname,
  );
  const isPurchaseOrderDetail = /\/purchase-orders\/(?!sync(?:\/|$))[^/]+(\/view)?$/.test(
    location.pathname,
  );
  const isSalesOrderDetail = /\/sales-orders\/(?!sync(?:\/|$)|portal(?:\/|$))[^/]+(\/view)?$/.test(
    location.pathname,
  );
  const isSupportDetail = /\/warranty-support\/[^/]+$/.test(location.pathname)
    && !location.pathname.endsWith('/complaint-guidelines');
  const pageTitle = isFooterNavActive
    ? (isSuperAdmin ? 'Settings' : 'Profile')
    : isDealerDetail
      ? 'Dealer'
    : isInvoiceDetail
      ? 'Invoice'
    : isSalesOrderDetail
      ? 'Sales order'
    : isPurchaseOrderDetail
      ? 'Purchase order'
    : isSupportDetail
      ? 'Support'
    : isSpareMapDetail
      ? 'Map spares'
    : isProductDetail
      ? 'Product Details'
      : (currentNavItem?.label ?? 'Dashboard');
  const displayTitle = pageHeader.title ?? pageTitle;
  const isDashboardHome = location.pathname === home;
  const showHeaderBack = Boolean(pageHeader.showBack && pageHeader.onBack);
  const mobileCompactHeader = Boolean(pageHeader.mobileCompactHeader && isMobile);
  const showTrailing = Boolean(isDashboardHome || topBarAction || showCartFlyTarget);

  const handleNavClick = (path: string) => {
    const isProductsRoot = path.endsWith('/products');
    if (location.pathname === path) {
      if (isProductsRoot && location.search) {
        navigate(path, { replace: true });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setPageRefreshKey(k => k + 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
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
            <Logo size={collapsed || isMobile ? 'sm' : 'md'} />
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

        {footerNavPath && (
          <div className="sidebar-profile">
            <button
              type="button"
              className={`nav-item ${isFooterNavActive ? 'active' : ''}`}
              onClick={() => handleNavClick(isSuperAdmin ? `${home}/settings/profile` : footerNavPath)}
              aria-label={isSuperAdmin ? 'Open settings' : 'Open profile'}
              title={isSuperAdmin ? 'Settings' : 'Profile'}
            >
              <span className="nav-icon">
                {isSuperAdmin ? <Settings size={20} /> : <UserCircle size={20} />}
              </span>
              {!collapsed && (
                <span className="nav-label">{isSuperAdmin ? 'Settings' : 'Profile'}</span>
              )}
            </button>
          </div>
        )}
      </aside>

      <main className={`main-content ${collapsed && !isMobile ? 'expanded' : ''}`}>
        <header
          ref={topBarRef}
          className={[
            'top-bar',
            headerSlot && isMobile && !mobileCompactHeader ? 'top-bar--with-slot' : '',
            headerSlot && !isMobile ? 'top-bar--with-inline-slot' : '',
            mobileCompactHeader ? 'top-bar--compact-search' : '',
          ].filter(Boolean).join(' ')}
        >
          <div className="top-bar__primary">
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
          {showHeaderBack && (
            <button
              type="button"
              className="top-bar__back-btn"
              onClick={() => pageHeader.onBack?.()}
              aria-label="Back"
            >
              <ArrowLeft size={22} />
            </button>
          )}
          {mobileCompactHeader ? (
            <div className="top-bar__slot top-bar__slot--compact">
              {headerSlot}
            </div>
          ) : dealerListPath ? (
            <button
              type="button"
              className={[
                'top-bar__title-block',
                'page-title',
                'page-title--nav-back',
                titleMeta ? 'top-bar__title-block--with-meta' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => navigateBack(navigate, dealerListPath)}
            >
              <span className="page-title__copy">
                <span className={[
                  'page-title__text',
                  pageHeader.accentTitle ? 'page-title__text--accent' : '',
                ].filter(Boolean).join(' ')}>{displayTitle}</span>
                {pageHeader.subtitle && (
                  <span className="page-subtitle">{pageHeader.subtitle}</span>
                )}
              </span>
              {titleMeta ? <span className="page-title__meta">{titleMeta}</span> : null}
            </button>
          ) : pageHeader.onTitleClick ? (
            <button
              type="button"
              className={[
                'top-bar__title-block',
                'top-bar__title-block--toggle',
                'page-title',
                titleMeta ? 'top-bar__title-block--with-meta' : '',
                pageHeader.titleExpanded ? 'is-expanded' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => pageHeader.onTitleClick?.()}
              aria-expanded={pageHeader.titleExpanded === true}
              aria-label="Toggle request details"
            >
              <span className="page-title__copy">
                <span className="top-bar__title-row">
                  <span className={[
                    'page-title__text',
                    pageHeader.accentTitle ? 'page-title__text--accent' : '',
                  ].filter(Boolean).join(' ')}>{displayTitle}</span>
                  <ChevronDown size={18} className="top-bar__title-chevron" aria-hidden />
                </span>
                {pageHeader.subtitle && (
                  <span className="page-subtitle">{pageHeader.subtitle}</span>
                )}
              </span>
              {titleMeta ? <span className="page-title__meta">{titleMeta}</span> : null}
            </button>
          ) : (
            <div
              className={[
                'top-bar__title-block',
                titleMeta ? 'top-bar__title-block--with-meta' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="page-title__copy">
                <h1 className="page-title">
                  <span className={[
                    'page-title__text',
                    pageHeader.accentTitle ? 'page-title__text--accent' : '',
                  ].filter(Boolean).join(' ')}>{displayTitle}</span>
                </h1>
                {pageHeader.subtitle && (
                  <p className="page-subtitle">{pageHeader.subtitle}</p>
                )}
              </div>
              {titleMeta ? <div className="page-title__meta">{titleMeta}</div> : null}
            </div>
          )}
          {headerSlot && !isMobile && (
            <div className="top-bar__slot top-bar__slot--inline">
              {headerSlot}
            </div>
          )}
          {showTrailing && (
          <div className="top-bar__trailing">
            {isDashboardHome ? (
              <span
                className="top-bar__version"
                title="App version. If a feature looks outdated, clear cache and restart the app."
              >
                {getAppVersionLabel()}
              </span>
            ) : null}
            {topBarAction}
            {showCartFlyTarget ? (
              <button
                ref={cartBtnRef}
                id="cart-fly-target"
                type="button"
                className={`cart-header-btn ${cartBump ? 'cart-header-btn--bump' : ''} ${itemCount > 0 ? 'cart-header-btn--has-items' : ''}`}
                onClick={() => handleNavClick(orderCartPathForUser(user, home))}
                aria-label={itemCount > 0 ? `View cart, ${itemCount} items` : 'View cart'}
                title="View cart"
              >
                <ShoppingCart size={22} />
                {itemCount > 0 && (
                  <span className="cart-header-btn__badge">{itemCount > 99 ? '99+' : itemCount}</span>
                )}
              </button>
            ) : null}
          </div>
          )}
          </div>
          {headerSlot && isMobile && !mobileCompactHeader && (
            <div className="top-bar__slot">
              {headerSlot}
            </div>
          )}
        </header>

        <div className="content-area">
          <Outlet key={pageRefreshKey} />
        </div>
      </main>
    </div>
  );
};
