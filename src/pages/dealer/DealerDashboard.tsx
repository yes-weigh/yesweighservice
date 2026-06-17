import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Boxes,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  FileText,
  GraduationCap,
  IndianRupee,
  MessageSquareWarning,
  Package,
  Plus,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { SalesChart } from '../../components/dashboard/SalesChart';
import { formatCurrency } from '../../lib/catalog';
import {
  fetchDealerInvoiceDashboard,
  formatInvoiceRelativeTime,
  invoiceStatusLabel,
} from '../../lib/invoices';
import type { DealerInvoice, InvoiceDashboardSummary } from '../../types/invoices';

type Trend = 'up' | 'down';

interface KpiCard {
  id: string;
  label: string;
  value: string;
  trend?: Trend;
  trendLabel?: string;
  path: string;
  tone: 'blue' | 'green' | 'red' | 'orange';
  icon: React.ReactNode;
}

interface QuickAction {
  label: string;
  path: string;
  icon: React.ReactNode;
}

interface ActivityItem {
  id: string;
  title: string;
  description: string;
  time: string;
  tone: 'blue' | 'green' | 'red' | 'orange' | 'purple';
  icon: React.ReactNode;
  path: string;
}

interface MiniStat {
  label: string;
  value: string;
  trend: string;
  tone: 'blue' | 'green' | 'orange' | 'purple';
  icon: React.ReactNode;
  actionLabel?: string;
  path?: string;
}

function formatDateRange(): string {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatPeriodRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function salesTrendFromSummary(summary: InvoiceDashboardSummary): { trend: Trend; label: string } | null {
  const pct = summary.salesTrendPct;
  if (pct === null) return null;
  return {
    trend: pct >= 0 ? 'up' : 'down',
    label: `${Math.abs(pct).toFixed(1)}% vs previous 30 days`,
  };
}

function invoiceActivityTone(status: string): ActivityItem['tone'] {
  const s = status.toLowerCase();
  if (s === 'overdue' || s === 'void') return 'red';
  if (s === 'paid') return 'green';
  if (s === 'unpaid' || s === 'partially_paid') return 'orange';
  return 'blue';
}

function buildKpis(
  base: string,
  isDealerStaff: boolean,
  summary: InvoiceDashboardSummary | null,
): KpiCard[] {
  const salesTrend = summary ? salesTrendFromSummary(summary) : null;
  const invoicesPath = `${base}/invoices`;

  const cards: KpiCard[] = [
    {
      id: 'sales',
      label: 'Total Sales',
      value: summary ? formatCurrency(summary.totalSales) : '',
      trend: salesTrend?.trend,
      trendLabel: salesTrend?.label,
      path: invoicesPath,
      tone: 'blue',
      icon: <IndianRupee size={22} strokeWidth={2.5} />,
    },
    {
      id: 'services',
      label: 'Pending Services',
      value: '',
      path: `${base}/${isDealerStaff ? 'service' : 'services'}`,
      tone: 'green',
      icon: <Wrench size={22} strokeWidth={2.5} />,
    },
  ];

  if (!isDealerStaff) {
    cards.push(
      {
        id: 'complaints',
        label: 'Pending Complaints',
        value: '',
        path: `${base}/complaints`,
        tone: 'red',
        icon: <MessageSquareWarning size={22} strokeWidth={2.5} />,
      },
      {
        id: 'orders',
        label: 'Pending Orders',
        value: '',
        path: `${base}/orders`,
        tone: 'orange',
        icon: <ShoppingCart size={22} strokeWidth={2.5} />,
      },
    );
  } else {
    cards.push(
      {
        id: 'returns',
        label: 'Pending Returns',
        value: '',
        path: `${base}/returns`,
        tone: 'red',
        icon: <MessageSquareWarning size={22} strokeWidth={2.5} />,
      },
      {
        id: 'orders',
        label: 'Cart & Orders',
        value: '',
        path: `${base}/orders`,
        tone: 'orange',
        icon: <ShoppingCart size={22} strokeWidth={2.5} />,
      },
    );
  }

  return cards;
}

function buildQuickActions(base: string, isDealerStaff: boolean): QuickAction[] {
  const actions: QuickAction[] = [
    {
      label: 'New Service',
      path: `${base}/${isDealerStaff ? 'service' : 'services'}`,
      icon: <Wrench size={20} />,
    },
  ];
  if (!isDealerStaff) {
    actions.push(
      { label: 'New Complaint', path: `${base}/complaints`, icon: <MessageSquareWarning size={20} /> },
      { label: 'New Order', path: `${base}/products`, icon: <Boxes size={20} /> },
      { label: 'Verification', path: `${base}/verification`, icon: <ShieldCheck size={20} /> },
      { label: 'View Invoices', path: `${base}/invoices`, icon: <FileText size={20} /> },
    );
  } else {
    actions.push(
      { label: 'Returns', path: `${base}/returns`, icon: <Boxes size={20} /> },
      { label: 'Verification', path: `${base}/verification`, icon: <ShieldCheck size={20} /> },
      { label: 'Products', path: `${base}/products`, icon: <Package size={20} /> },
      { label: 'View Invoices', path: `${base}/invoices`, icon: <FileText size={20} /> },
    );
  }
  return actions;
}

function buildActivitiesFromInvoices(invoices: DealerInvoice[], invoicesPath: string): ActivityItem[] {
  return invoices.map(inv => {
    const statusLabel = invoiceStatusLabel(inv.status);
    const balanceNote =
      inv.balance > 0 ? `Balance ${formatCurrency(inv.balance)}` : formatCurrency(inv.total);
    return {
      id: inv.id,
      title: `Invoice ${inv.invoiceNumber || inv.id}`,
      description: `${statusLabel} — ${balanceNote}`,
      time: formatInvoiceRelativeTime(inv.date),
      tone: invoiceActivityTone(inv.status),
      icon: <FileText size={16} />,
      path: invoicesPath,
    };
  });
}

function buildMiniStats(base: string): MiniStat[] {
  return [
    {
      label: 'Total Customers',
      value: '',
      trend: '',
      tone: 'blue',
      icon: <Users size={18} />,
    },
    {
      label: 'Active Products',
      value: '',
      trend: '',
      tone: 'green',
      icon: <Package size={18} />,
      actionLabel: 'Browse catalog',
      path: `${base}/products`,
    },
    {
      label: 'Verifications Due',
      value: '',
      trend: '',
      tone: 'orange',
      icon: <ClipboardList size={18} />,
      actionLabel: 'View due list',
      path: `${base}/verification`,
    },
    {
      label: 'Upcoming Trainings',
      value: '',
      trend: '',
      tone: 'purple',
      icon: <GraduationCap size={18} />,
      actionLabel: 'View schedule',
      path: `${base}/training`,
    },
  ];
}

export const DealerDashboard: React.FC<{ basePath: string }> = ({ basePath }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDealerStaff = user?.role === 'dealer_staff';

  const [summary, setSummary] = useState<InvoiceDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchDealerInvoiceDashboard()
      .then(data => {
        if (!cancelled) setSummary(data);
      })
      .catch(err => {
        if (!cancelled) {
          setSummary(null);
          setError(err instanceof Error ? err.message : 'Could not load dashboard data.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const invoicesPath = `${basePath}/invoices`;
  const kpis = buildKpis(basePath, isDealerStaff, summary);
  const quickActions = buildQuickActions(basePath, isDealerStaff);
  const activities = summary ? buildActivitiesFromInvoices(summary.recentInvoices, invoicesPath) : [];
  const miniStats = buildMiniStats(basePath);

  const firstName = user?.displayName?.split(/\s+/)[0] ?? 'Dealer';
  const dateRange =
    summary ? formatPeriodRange(summary.periodStart, summary.periodEnd) : formatDateRange();

  return (
    <div className="page-content fade-in dealer-dashboard">
      <header className="dealer-dash__hero">
        <div className="dealer-dash__hero-copy">
          <p className="dealer-dash__eyebrow">YesWeigh Service & Spares CRM</p>
          <h2 className="dealer-dash__title">
            Welcome, {firstName}
            <span className="dealer-dash__wave" aria-hidden>👋</span>
          </h2>
          <p className="dealer-dash__subtitle">
            Your operations snapshot — sales, service, complaints, and orders at a glance.
          </p>
        </div>
        <button type="button" className="dealer-dash__date-pill" aria-label="Date range">
          <CalendarRange size={16} />
          <span>{dateRange}</span>
        </button>
      </header>

      {error && (
        <p className="dealer-dash__error" role="alert">
          {error}
        </p>
      )}

      <section className="dealer-dash__kpis" aria-label="Key metrics">
        {kpis.map(card => (
          <button
            key={card.id}
            type="button"
            className={`dealer-dash-kpi dealer-dash-kpi--${card.tone}`}
            onClick={() => navigate(card.path)}
          >
            <div className="dealer-dash-kpi__icon">{card.icon}</div>
            <div className="dealer-dash-kpi__body">
              <span className="dealer-dash-kpi__label">{card.label}</span>
              <strong className="dealer-dash-kpi__value">
                {loading && card.id === 'sales' ? '…' : card.value}
              </strong>
              {card.trend && card.trendLabel && (
                <span className={`dealer-dash-kpi__trend dealer-dash-kpi__trend--${card.trend}`}>
                  {card.trend === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  {card.trendLabel}
                </span>
              )}
            </div>
            <ChevronRight size={18} className="dealer-dash-kpi__chevron" aria-hidden />
          </button>
        ))}
      </section>

      <section className="dealer-dash__chart-panel">
        <div className="dealer-dash__chart-head">
          <div>
            <h3 className="dealer-dash__section-title">
              <TrendingUp size={18} />
              Sales Overview
            </h3>
            <p className="dealer-dash__section-sub">Weekly invoice totals (last 7 weeks)</p>
          </div>
        </div>
        <SalesChart weeklySales={summary?.weeklySales} />
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
          <p className="dealer-dash__empty-note">Loading recent invoices…</p>
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
          <p className="dealer-dash__empty-note">No recent invoices.</p>
        )}
        {activities.length > 0 && (
          <button
            type="button"
            className="dealer-dash__view-all"
            onClick={() => navigate(invoicesPath)}
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
              {stat.trend && <span className="dealer-dash-mini__trend">{stat.trend}</span>}
              {stat.actionLabel && stat.path && (
                <button
                  type="button"
                  className="dealer-dash-mini__link"
                  onClick={() => navigate(stat.path!)}
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
