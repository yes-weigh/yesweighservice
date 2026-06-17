import React, { useEffect, useMemo, useState } from 'react';
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
import { SalesRangeSelect } from '../../components/dashboard/SalesRangeSelect';
import { formatCurrency } from '../../lib/catalog';
import {
  buildSalesEntriesFromInvoices,
  computeSalesForDateRange,
  computeSalesForPeriod,
  defaultCustomRange,
  fetchAllDealerInvoices,
  fetchDealerInvoiceDashboard,
  formatInvoiceRelativeTime,
  formatKpiPeriodRange,
  formatKpiTrendLabel,
  invoiceStatusLabel,
  parseDateInput,
  toDateInputValue,
} from '../../lib/invoices';
import type { DealerInvoice, InvoiceDashboardSummary, InvoiceSalesEntry, KpiPeriod, SalesRangePreset } from '../../types/invoices';

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

function invoiceActivityTone(status: string): ActivityItem['tone'] {
  const s = status.toLowerCase();
  if (s === 'overdue' || s === 'void') return 'red';
  if (s === 'paid') return 'green';
  if (s === 'unpaid' || s === 'partially_paid') return 'orange';
  return 'blue';
}

function buildSecondaryKpis(base: string, isDealerStaff: boolean): KpiCard[] {
  const cards: KpiCard[] = [
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
  const [salesEntries, setSalesEntries] = useState<InvoiceSalesEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(30);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const todayInput = toDateInputValue(new Date());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchDealerInvoiceDashboard();
        if (cancelled) return;
        setSummary(data);

        if (data.salesEntries?.length) {
          setSalesEntries(data.salesEntries);
        } else {
          const invoices = await fetchAllDealerInvoices();
          if (!cancelled) {
            setSalesEntries(buildSalesEntriesFromInvoices(invoices));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setSummary(null);
          setSalesEntries([]);
          setError(err instanceof Error ? err.message : 'Could not load dashboard data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const invoicesPath = `${basePath}/invoices`;
  const secondaryKpis = buildSecondaryKpis(basePath, isDealerStaff);
  const quickActions = buildQuickActions(basePath, isDealerStaff);
  const activities = summary ? buildActivitiesFromInvoices(summary.recentInvoices, invoicesPath) : [];
  const miniStats = buildMiniStats(basePath);

  const salesSummary = useMemo(() => {
    if (!salesEntries.length) {
      if (!summary || rangePreset !== 30) return null;
      return {
        periodStart: summary.periodStart,
        periodEnd: summary.periodEnd,
        totalSales: summary.totalSales,
        previousSales: summary.previousSales,
        salesTrendPct: summary.salesTrendPct,
      };
    }

    if (rangePreset === 'custom') {
      const start = parseDateInput(customStart);
      const end = parseDateInput(customEnd);
      if (!start || !end || start > end) return null;
      return computeSalesForDateRange(salesEntries, start, end);
    }

    return computeSalesForPeriod(salesEntries, rangePreset);
  }, [salesEntries, rangePreset, customStart, customEnd, summary]);

  const salesTrend = useMemo(() => {
    if (!salesSummary || salesSummary.salesTrendPct === null) return null;

    let trendLabel: string;
    if (rangePreset === 'custom' && salesSummary.periodStart) {
      const days =
        Math.round(
          (new Date(salesSummary.periodEnd).getTime() - new Date(salesSummary.periodStart).getTime()) /
            (24 * 60 * 60 * 1000),
        ) + 1;
      trendLabel = `${Math.abs(salesSummary.salesTrendPct).toFixed(1)}% vs previous ${days} days`;
    } else {
      trendLabel = `${Math.abs(salesSummary.salesTrendPct).toFixed(1)}% ${formatKpiTrendLabel(rangePreset as KpiPeriod)}`;
    }

    return {
      trend: salesSummary.salesTrendPct >= 0 ? 'up' as Trend : 'down' as Trend,
      label: trendLabel,
    };
  }, [salesSummary, rangePreset]);

  const dateRange = salesSummary
    ? formatKpiPeriodRange(salesSummary.periodStart, salesSummary.periodEnd)
    : rangePreset === 'custom'
      ? 'Custom range'
      : 'Last 30 days';

  const handleRangePresetChange = (preset: SalesRangePreset) => {
    if (preset === 'custom') {
      setRangePreset('custom');
      if (!customStart || !customEnd) {
        const defaults = defaultCustomRange();
        setCustomStart(defaults.start);
        setCustomEnd(defaults.end);
      }
      return;
    }
    setRangePreset(preset);
  };

  const firstName = user?.displayName?.split(/\s+/)[0] ?? 'Dealer';

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
        <div className="dealer-dash__range-tile panel glass">
          <div className="dealer-dash__range-icon" aria-hidden>
            <CalendarRange size={18} strokeWidth={2.25} />
          </div>
          <div className="dealer-dash__range-body">
            <span className="dealer-dash__range-label">Sales period</span>
            <SalesRangeSelect value={rangePreset} onChange={handleRangePresetChange} />
            {rangePreset === 'custom' && (
              <div className="dealer-dash__range-custom">
                <input
                  type="date"
                  className="dealer-dash__range-date catalog-select"
                  value={customStart}
                  max={customEnd || todayInput}
                  onChange={e => setCustomStart(e.target.value)}
                  aria-label="Start date"
                />
                <span className="dealer-dash__range-sep" aria-hidden>–</span>
                <input
                  type="date"
                  className="dealer-dash__range-date catalog-select"
                  value={customEnd}
                  min={customStart}
                  max={todayInput}
                  onChange={e => setCustomEnd(e.target.value)}
                  aria-label="End date"
                />
              </div>
            )}
            <span className="dealer-dash__range-display">{dateRange}</span>
          </div>
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
              {salesTrend && (
                <span className={`dealer-dash-kpi__trend dealer-dash-kpi__trend--${salesTrend.trend}`}>
                  {salesTrend.trend === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  {salesTrend.label}
                </span>
              )}
            </div>
          </div>
          <strong className="dealer-dash-kpi__value dealer-dash-kpi__value--featured">
            {loading ? '…' : salesSummary ? formatCurrency(salesSummary.totalSales) : ''}
          </strong>
          <button
            type="button"
            className="dealer-dash-kpi__chevron-btn"
            onClick={() => navigate(invoicesPath)}
            aria-label="View invoices"
          >
            <ChevronRight size={18} className="dealer-dash-kpi__chevron" aria-hidden />
          </button>
        </div>

        <div className="dealer-dash__kpis-grid">
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
            <p className="dealer-dash__section-sub">Daily invoice totals (last 30 days)</p>
          </div>
        </div>
        <SalesChart dailySales={summary?.dailySales} />
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
