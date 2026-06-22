import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Bell,
  Briefcase,
  Building2,
  ChevronRight,
  ClipboardList,
  FileText,
  IndianRupee,
  LifeBuoy,
  Package,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { SalesChart } from '../../components/dashboard/SalesChart';
import { SalesRangeSelect } from '../../components/dashboard/SalesRangeSelect';
import { useAuth } from '../../context/AuthContext';
import {
  buildAdminDailySales,
  buildAdminSalesEntries,
  countAdminInvoicesByStatus,
  fetchAdminInvoicesPage,
  sumAdminOutstanding,
} from '../../lib/admin-invoices';
import { dealerErrorMessage, fetchDealerStats } from '../../lib/dealers';
import { fetchOpsSupportRequests } from '../../lib/dealerSupport';
import { db } from '../../firebase';
import { formatCurrency } from '../../lib/catalog';
import {
  computeSalesForPeriod,
  formatInvoiceRelativeTime,
  formatKpiTrendLabel,
  invoiceStatusLabel,
} from '../../lib/invoices';
import type { FirestoreUserDoc } from '../../types';
import { normalizeRole } from '../../types';
import type { DealerStats } from '../../types/dealers';
import type { DealerSupportRequest } from '../../types/dealer-support';
import type { AdminFirestoreInvoice } from '../../lib/admin-invoices';
import type { SalesRangePreset } from '../../types/invoices';

const BASE = '/super-admin';

type Trend = 'up' | 'down';

interface ActivityItem {
  id: string;
  title: string;
  description: string;
  time: string;
  tone: 'blue' | 'green' | 'red' | 'orange' | 'purple';
  icon: React.ReactNode;
  path: string;
  sortAt: number;
}

function supportActivityTone(request: DealerSupportRequest): ActivityItem['tone'] {
  if (request.status === 'cancelled') return 'red';
  if (request.type === 'complaint') return 'red';
  if (request.type === 'return') return 'orange';
  if (request.status === 'completed') return 'green';
  return 'blue';
}

function invoiceActivityTone(status: string): ActivityItem['tone'] {
  const s = status.toLowerCase();
  if (s === 'overdue' || s === 'void') return 'red';
  if (s === 'paid') return 'green';
  if (s === 'unpaid' || s === 'partially_paid') return 'orange';
  return 'blue';
}

function buildActivities(
  invoices: AdminFirestoreInvoice[],
  support: DealerSupportRequest[],
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const inv of invoices.slice(0, 8)) {
    const statusLabel = invoiceStatusLabel(inv.status);
    items.push({
      id: `inv-${inv.id}`,
      title: `Invoice ${inv.invoiceNumber || inv.id}`,
      description: `${inv.customerName ?? 'Dealer'} — ${statusLabel}`,
      time: formatInvoiceRelativeTime(inv.date),
      tone: invoiceActivityTone(inv.status),
      icon: <FileText size={16} />,
      path: `${BASE}/invoices`,
      sortAt: inv.date ? Date.parse(inv.date) : 0,
    });
  }

  for (const req of support.slice(0, 8)) {
    items.push({
      id: `sup-${req.id}`,
      title: `${req.requestNumber} — ${req.dealerName ?? 'Dealer'}`,
      description: `${req.type} · ${req.status.replace(/_/g, ' ')}`,
      time: formatInvoiceRelativeTime(req.updatedAt),
      tone: supportActivityTone(req),
      icon: <LifeBuoy size={16} />,
      path: `${BASE}/warranty-support/${req.id}`,
      sortAt: Date.parse(req.updatedAt) || 0,
    });
  }

  return items
    .sort((a, b) => b.sortAt - a.sortAt)
    .slice(0, 8);
}

export const SuperAdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dealerStats, setDealerStats] = useState<DealerStats | null>(null);
  const [invoices, setInvoices] = useState<AdminFirestoreInvoice[]>([]);
  const [supportRequests, setSupportRequests] = useState<DealerSupportRequest[]>([]);
  const [staffCount, setStaffCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(30);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [stats, invoiceRows, support, usersSnap] = await Promise.all([
          fetchDealerStats(),
          fetchAdminInvoicesPage('date', 200),
          fetchOpsSupportRequests(),
          getDocs(collection(db, 'users')),
        ]);
        if (cancelled) return;

        setDealerStats(stats);
        setInvoices(invoiceRows);
        setSupportRequests(support);
        setStaffCount(
          usersSnap.docs.filter(d => normalizeRole(String((d.data() as FirestoreUserDoc).role ?? '')) === 'staff').length,
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : dealerErrorMessage(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const salesEntries = useMemo(() => buildAdminSalesEntries(invoices), [invoices]);
  const salesSummary = useMemo(
    () => (salesEntries.length ? computeSalesForPeriod(salesEntries, rangePreset) : null),
    [salesEntries, rangePreset],
  );
  const dailySales = useMemo(() => buildAdminDailySales(invoices, 30), [invoices]);

  const salesTrend = useMemo(() => {
    if (!salesSummary || salesSummary.salesTrendPct === null) return null;
    return {
      trend: salesSummary.salesTrendPct >= 0 ? 'up' as Trend : 'down' as Trend,
      label: `${Math.abs(salesSummary.salesTrendPct).toFixed(1)}% ${formatKpiTrendLabel(rangePreset)}`,
    };
  }, [salesSummary, rangePreset]);

  const openSupport = useMemo(
    () => supportRequests.filter(r => r.status === 'pending' || r.status === 'in_progress').length,
    [supportRequests],
  );

  const openServiceTickets = useMemo(
    () => supportRequests.filter(
      r => (r.status === 'pending' || r.status === 'in_progress')
        && (r.type === 'service' || r.type === 'complaint'),
    ).length,
    [supportRequests],
  );

  const openReturnOrders = useMemo(
    () => supportRequests.filter(
      r => (r.status === 'pending' || r.status === 'in_progress') && r.type === 'return',
    ).length,
    [supportRequests],
  );

  const activities = useMemo(
    () => buildActivities(invoices, supportRequests),
    [invoices, supportRequests],
  );

  const outstanding = useMemo(() => sumAdminOutstanding(invoices), [invoices]);
  const overdueCount = useMemo(() => countAdminInvoicesByStatus(invoices, 'overdue'), [invoices]);

  const firstName = user?.displayName?.split(/\s+/)[0] ?? 'Admin';

  const opsKpis = [
    {
      id: 'support',
      label: 'Warranty & Support',
      value: loading ? '…' : String(openSupport),
      trendLabel: loading ? '' : `${openServiceTickets} service & complaints`,
      path: `${BASE}/warranty-support`,
      tone: 'green' as const,
      icon: <LifeBuoy size={22} strokeWidth={2.5} />,
    },
    {
      id: 'orders',
      label: 'Orders',
      value: loading ? '…' : String(openReturnOrders),
      trendLabel: 'Open returns & RMA',
      path: `${BASE}/orders`,
      tone: 'orange' as const,
      icon: <ShoppingCart size={22} strokeWidth={2.5} />,
    },
  ];

  const secondaryKpis = [
    {
      id: 'dealers-total',
      label: 'Total Dealers',
      value: loading ? '…' : dealerStats ? String(dealerStats.total) : '—',
      trendLabel: 'Active + Non Active + Blacklisted + Unstaged',
      path: `${BASE}/dealers`,
      tone: 'blue' as const,
      icon: <Building2 size={22} strokeWidth={2.5} />,
    },
    {
      id: 'dealers-active',
      label: 'Active Dealers',
      value: loading ? '…' : dealerStats ? String(dealerStats.active) : '—',
      trendLabel: 'Stage: Active',
      path: `${BASE}/dealers`,
      tone: 'green' as const,
      icon: <UserCheck size={22} strokeWidth={2.5} />,
    },
    {
      id: 'dealers-non-active',
      label: 'Non Active Dealers',
      value: loading ? '…' : dealerStats ? String(dealerStats.nonActive) : '—',
      trendLabel: 'Stage: Non Active',
      path: `${BASE}/dealers`,
      tone: 'orange' as const,
      icon: <UserMinus size={22} strokeWidth={2.5} />,
    },
    {
      id: 'dealers-blacklisted',
      label: 'Blacklisted Dealers',
      value: loading ? '…' : dealerStats ? String(dealerStats.blacklisted) : '—',
      trendLabel: 'Stage: Blacklisted',
      path: `${BASE}/dealers`,
      tone: 'red' as const,
      icon: <Ban size={22} strokeWidth={2.5} />,
    },
    {
      id: 'dealers-unstaged',
      label: 'Unstaged Dealers',
      value: loading ? '…' : dealerStats ? String(dealerStats.unstaged) : '—',
      trendLabel: 'No stage assigned',
      path: `${BASE}/dealers`,
      tone: 'purple' as const,
      icon: <Users size={22} strokeWidth={2.5} />,
    },
  ];

  const quickActions = [
    { label: 'Manage Dealers', path: `${BASE}/dealers`, icon: <Building2 size={20} /> },
    { label: 'HR', path: `${BASE}/hr`, icon: <Users size={20} /> },
    { label: 'Invoices', path: `${BASE}/invoices`, icon: <FileText size={20} /> },
    { label: 'Catalog', path: `${BASE}/catalog`, icon: <Package size={20} /> },
    { label: 'Warranty & Support', path: `${BASE}/warranty-support`, icon: <LifeBuoy size={20} /> },
    { label: 'Verification', path: `${BASE}/verification`, icon: <ShieldCheck size={20} /> },
  ];

  const miniStats = [
    {
      label: 'Staff',
      value: loading ? '…' : String(staffCount),
      trend: 'Company team',
      tone: 'purple' as const,
      icon: <Users size={18} />,
      actionLabel: 'Open HR',
      path: `${BASE}/hr`,
    },
    {
      label: 'Unassigned KAM',
      value: loading ? '…' : dealerStats ? String(dealerStats.unassignedKam) : '—',
      trend: 'Needs assignment',
      tone: 'orange' as const,
      icon: <Briefcase size={18} />,
      actionLabel: 'Assign KAM',
      path: `${BASE}/dealers`,
    },
    {
      label: 'Overdue Invoices',
      value: loading ? '…' : String(overdueCount),
      trend: outstanding > 0 ? `${formatCurrency(outstanding)} outstanding` : 'All clear',
      tone: 'blue' as const,
      icon: <ClipboardList size={18} />,
      actionLabel: 'View invoices',
      path: `${BASE}/invoices`,
    },
  ];

  return (
    <div className="page-content fade-in dealer-dashboard">
      <header className="dealer-dash__hero">
        <div className="dealer-dash__hero-copy">
          <p className="dealer-dash__eyebrow">YesOne Platform Admin</p>
          <h2 className="dealer-dash__title">
            Welcome, {firstName}
            <span className="dealer-dash__wave" aria-hidden>👋</span>
          </h2>
          <p className="dealer-dash__subtitle">
            Organisation snapshot — dealers, invoices, support, and staff across YesWeigh.
          </p>
        </div>
      </header>

      {error && (
        <p className="dealer-dash__error" role="alert">
          {error}
        </p>
      )}

      <section className="dealer-dash__kpis-layout" aria-label="Key metrics">
        <div className="dealer-dash-kpi dealer-dash-kpi--blue dealer-dash-kpi--featured">
          <div className="dealer-dash-kpi__featured-main">
            <div className="dealer-dash-kpi__icon dealer-dash-kpi__icon--featured">
              <IndianRupee strokeWidth={2.5} />
            </div>
            <div className="dealer-dash-kpi__body dealer-dash-kpi__body--featured">
              <span className="dealer-dash-kpi__label">Total Sales</span>
              <SalesRangeSelect value={rangePreset} onChange={setRangePreset} />
              {salesTrend && (
                <span className={`dealer-dash-kpi__trend dealer-dash-kpi__trend--${salesTrend.trend}`}>
                  {salesTrend.trend === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  {salesTrend.label}
                </span>
              )}
            </div>
          </div>
          <strong className="dealer-dash-kpi__value dealer-dash-kpi__value--featured">
            {loading ? '…' : salesSummary ? formatCurrency(salesSummary.totalSales) : formatCurrency(0)}
          </strong>
          <button
            type="button"
            className="dealer-dash-kpi__chevron-btn"
            onClick={() => navigate(`${BASE}/invoices`)}
            aria-label="View invoices"
          >
            <ChevronRight size={18} className="dealer-dash-kpi__chevron" aria-hidden />
          </button>
        </div>

        <div className="dealer-dash__kpis-grid">
          {opsKpis.map(card => (
            <button
              key={card.id}
              type="button"
              className={`dealer-dash-kpi dealer-dash-kpi--${card.tone}`}
              onClick={() => navigate(card.path)}
            >
              <div className="dealer-dash-kpi__icon">{card.icon}</div>
              <div className="dealer-dash-kpi__body">
                <span className="dealer-dash-kpi__label">{card.label}</span>
                <strong className="dealer-dash-kpi__value">{card.value}</strong>
                {card.trendLabel && (
                  <span className="dealer-dash-kpi__trend dealer-dash-kpi__trend--up">
                    <ArrowUpRight size={13} />
                    {card.trendLabel}
                  </span>
                )}
              </div>
              <ChevronRight size={18} className="dealer-dash-kpi__chevron" aria-hidden />
            </button>
          ))}
        </div>

        <div className="dealer-dash__kpis-grid dealer-dash__kpis-grid--dealer-stages">
          {secondaryKpis.map(card => (
            <button
              key={card.id}
              type="button"
              className={`dealer-dash-kpi dealer-dash-kpi--${card.tone}`}
              onClick={() => navigate(card.path)}
            >
              <div className="dealer-dash-kpi__icon">{card.icon}</div>
              <div className="dealer-dash-kpi__body">
                <span className="dealer-dash-kpi__label">{card.label}</span>
                <strong className="dealer-dash-kpi__value">{card.value}</strong>
                {card.trendLabel && (
                  <span className="dealer-dash-kpi__trend dealer-dash-kpi__trend--up">
                    <ArrowUpRight size={13} />
                    {card.trendLabel}
                  </span>
                )}
              </div>
              <ChevronRight size={18} className="dealer-dash-kpi__chevron" aria-hidden />
            </button>
          ))}
        </div>
      </section>

      <section className="dealer-dash__chart-panel">
        <div className="dealer-dash__chart-head">
          <div>
            <h3 className="dealer-dash__section-title">
              <TrendingUp size={18} />
              Sales Overview
            </h3>
            <p className="dealer-dash__section-sub">Daily invoice totals across all dealers (last 30 days)</p>
          </div>
          {loading && (
            <span className="dealer-dash__placeholder-badge">
              <RefreshCw size={12} className="spin-icon" aria-hidden />
              Loading
            </span>
          )}
        </div>
        <SalesChart dailySales={dailySales} />
      </section>

      <section className="dealer-dash__quick-actions">
        <h3 className="dealer-dash__section-title">Quick Actions</h3>
        <div className="dealer-dash__quick-scroll">
          {quickActions.map(action => (
            <button
              key={action.label}
              type="button"
              className="dealer-dash-quick"
              onClick={() => navigate(action.path)}
            >
              <span className="dealer-dash-quick__icon">{action.icon}</span>
              <span className="dealer-dash-quick__plus" aria-hidden>
                <Plus size={10} strokeWidth={3} />
              </span>
              <span className="dealer-dash-quick__label">{action.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="dealer-dash__activities">
        <div className="dealer-dash__activities-head">
          <h3 className="dealer-dash__section-title">
            <Bell size={18} />
            Recent Activities
          </h3>
        </div>
        {loading && !activities.length ? (
          <p className="dealer-dash__empty-note">Loading recent activity…</p>
        ) : activities.length ? (
          <ul className="dealer-dash-activity-list">
            {activities.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`dealer-dash-activity dealer-dash-activity--${item.tone}`}
                  onClick={() => navigate(item.path)}
                >
                  <span className="dealer-dash-activity__icon">{item.icon}</span>
                  <span className="dealer-dash-activity__main">
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </span>
                  {item.time && (
                    <time className="dealer-dash-activity__time">{item.time}</time>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dealer-dash__empty-note">No recent invoices or support tickets.</p>
        )}
        {activities.length > 0 && (
          <button
            type="button"
            className="dealer-dash__view-all"
            onClick={() => navigate(`${BASE}/invoices`)}
          >
            View all invoices
          </button>
        )}
      </section>

      <section className="dealer-dash__mini-stats" aria-label="Summary stats">
        {miniStats.map(stat => (
          <div key={stat.label} className={`dealer-dash-mini dealer-dash-mini--${stat.tone}`}>
            <div className="dealer-dash-mini__icon">{stat.icon}</div>
            <div className="dealer-dash-mini__body">
              <span className="dealer-dash-mini__label">{stat.label}</span>
              <strong className="dealer-dash-mini__value">{stat.value}</strong>
              <span className="dealer-dash-mini__trend">{stat.trend}</span>
              {stat.actionLabel && stat.path && (
                <button
                  type="button"
                  className="dealer-dash-mini__link"
                  onClick={() => navigate(stat.path)}
                >
                  {stat.actionLabel}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
};
