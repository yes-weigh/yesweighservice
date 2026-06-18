import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Bell,
  Briefcase,
  Building2,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  LifeBuoy,
  ListTodo,
  MessageSquareWarning,
  Package,
  Plus,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  UserCheck,
  UserRoundPlus,
} from 'lucide-react';
import { SalesChart } from '../../components/dashboard/SalesChart';
import { useAuth } from '../../context/AuthContext';
import { dealerErrorMessage, fetchDealerStats } from '../../lib/dealers';
import type { DealerStats } from '../../types/dealers';

const BASE = '/staff';

type Trend = 'up' | 'down';

interface KpiCard {
  id: string;
  label: string;
  value: string;
  trend: Trend;
  trendLabel: string;
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

function buildKpis(stats: DealerStats | null): KpiCard[] {
  return [
    {
      id: 'dealers',
      label: 'Total Dealers',
      value: stats ? String(stats.total) : '—',
      trend: 'up',
      trendLabel: stats ? `${stats.active} active` : 'Loading…',
      path: `${BASE}/dealers`,
      tone: 'blue',
      icon: <Building2 size={22} strokeWidth={2.5} />,
    },
    {
      id: 'support',
      label: 'Warranty & Support',
      value: '—',
      trend: 'up',
      trendLabel: 'Dealer tickets',
      path: `${BASE}/warranty-support`,
      tone: 'green',
      icon: <LifeBuoy size={22} strokeWidth={2.5} />,
    },
    {
      id: 'orders',
      label: 'Pending Orders',
      value: '24',
      trend: 'up',
      trendLabel: '8 vs last 30 days',
      path: `${BASE}/orders`,
      tone: 'orange',
      icon: <ShoppingCart size={22} strokeWidth={2.5} />,
    },
  ];
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Manage Dealers', path: `${BASE}/dealers`, icon: <Building2 size={20} /> },
  { label: 'Leads', path: `${BASE}/leads`, icon: <UserRoundPlus size={20} /> },
  { label: 'Tasks', path: `${BASE}/tasks`, icon: <ListTodo size={20} /> },
  { label: 'Warranty & Support', path: `${BASE}/warranty-support`, icon: <LifeBuoy size={20} /> },
  { label: 'Products', path: `${BASE}/products`, icon: <Package size={20} /> },
  { label: 'Verification', path: `${BASE}/verification`, icon: <ShieldCheck size={20} /> },
];

const ACTIVITIES: ActivityItem[] = [
  {
    id: '1',
    title: 'Dealer stage updated — ABC Scales',
    description: 'Marked Active · assigned to Namratha (KAM).',
    time: '1h ago',
    tone: 'blue',
    icon: <Building2 size={16} />,
  },
  {
    id: '2',
    title: 'New lead — Pune weighing distributor',
    description: 'Inquiry for platform scales and AMC.',
    time: '3h ago',
    tone: 'purple',
    icon: <UserRoundPlus size={16} />,
  },
  {
    id: '3',
    title: 'Service Request #SRV-2024-00418',
    description: 'Annual maintenance scheduled for dealer in Korba.',
    time: '4h ago',
    tone: 'green',
    icon: <LifeBuoy size={16} />,
  },
  {
    id: '4',
    title: 'Complaint #CMP-2024-00125',
    description: 'Calibration issue escalated from dealer portal.',
    time: 'Yesterday',
    tone: 'red',
    icon: <MessageSquareWarning size={16} />,
  },
  {
    id: '5',
    title: 'Order #ORD-2024-00902',
    description: 'Spare parts order — load cell & display board.',
    time: 'Yesterday',
    tone: 'orange',
    icon: <ShoppingCart size={16} />,
  },
];

function buildMiniStats(stats: DealerStats | null): MiniStat[] {
  return [
    {
      label: 'Active Dealers',
      value: stats ? String(stats.active) : '—',
      trend: 'On roster',
      tone: 'green',
      icon: <UserCheck size={18} />,
      actionLabel: 'View dealers',
      path: `${BASE}/dealers`,
    },
    {
      label: 'Unassigned KAM',
      value: stats ? String(stats.unassignedKam) : '—',
      trend: 'Needs assignment',
      tone: 'orange',
      icon: <Briefcase size={18} />,
      actionLabel: 'Assign KAM',
      path: `${BASE}/dealers`,
    },
    {
      label: 'Blacklisted',
      value: stats ? String(stats.blacklisted) : '—',
      trend: 'Filtered accounts',
      tone: 'blue',
      icon: <Ban size={18} />,
      actionLabel: 'Review list',
      path: `${BASE}/dealers`,
    },
    {
      label: 'Open Tasks',
      value: '7',
      trend: '3 due today',
      tone: 'purple',
      icon: <ClipboardList size={18} />,
      actionLabel: 'View tasks',
      path: `${BASE}/tasks`,
    },
  ];
}

export const StaffDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dealerStats, setDealerStats] = useState<DealerStats | null>(null);
  const [statsError, setStatsError] = useState('');

  useEffect(() => {
    void fetchDealerStats()
      .then(setDealerStats)
      .catch(err => setStatsError(dealerErrorMessage(err)));
  }, []);

  const kpis = buildKpis(dealerStats);
  const miniStats = buildMiniStats(dealerStats);
  const firstName = user?.displayName?.split(/\s+/)[0] ?? 'Staff';

  return (
    <div className="page-content fade-in dealer-dashboard">
      <header className="dealer-dash__hero">
        <div className="dealer-dash__hero-copy">
          <p className="dealer-dash__eyebrow">YesWeigh Staff Portal</p>
          <h2 className="dealer-dash__title">
            Welcome, {firstName}
            <span className="dealer-dash__wave" aria-hidden>👋</span>
          </h2>
          <p className="dealer-dash__subtitle">
            Company operations at a glance — dealers, service, complaints, orders, and leads.
          </p>
        </div>
        <button type="button" className="dealer-dash__date-pill" aria-label="Date range">
          <CalendarRange size={16} />
          <span>{formatDateRange()}</span>
        </button>
      </header>

      {statsError && (
        <div className="products-inline-error panel glass">
          <span>{statsError}</span>
        </div>
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
              <strong className="dealer-dash-kpi__value">{card.value}</strong>
              <span className={`dealer-dash-kpi__trend dealer-dash-kpi__trend--${card.trend}`}>
                {card.trend === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                {card.trendLabel}
              </span>
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
              Dealer & Sales Overview
            </h3>
            <p className="dealer-dash__section-sub">Weekly activity trend (placeholder)</p>
          </div>
          <button type="button" className="dealer-dash__select-pill">This month</button>
        </div>
        <SalesChart />
      </section>

      <section className="dealer-dash__quick-actions">
        <h3 className="dealer-dash__section-title">Quick Actions</h3>
        <div className="dealer-dash__quick-scroll">
          {QUICK_ACTIONS.map(action => (
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
          <span className="dealer-dash__placeholder-badge">Sample data</span>
        </div>
        <ul className="dealer-dash-activity-list">
          {ACTIVITIES.map(item => (
            <li key={item.id}>
              <button
                type="button"
                className={`dealer-dash-activity dealer-dash-activity--${item.tone}`}
                onClick={() => navigate(`${BASE}/notifications`)}
              >
                <span className="dealer-dash-activity__icon">{item.icon}</span>
                <span className="dealer-dash-activity__main">
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </span>
                <time className="dealer-dash-activity__time">{item.time}</time>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="dealer-dash__view-all"
          onClick={() => navigate(`${BASE}/notifications`)}
        >
          View all activities
        </button>
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
