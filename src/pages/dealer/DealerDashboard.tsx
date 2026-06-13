import React from 'react';
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

function buildKpis(base: string, isDealerStaff: boolean): KpiCard[] {
  const cards: KpiCard[] = [
    {
      id: 'sales',
      label: 'Total Sales',
      value: '₹ 12,86,540',
      trend: 'up',
      trendLabel: '18.6% vs last 30 days',
      path: isDealerStaff ? `${base}/products` : `${base}/invoices`,
      tone: 'blue',
      icon: <IndianRupee size={22} strokeWidth={2.5} />,
    },
    {
      id: 'services',
      label: 'Pending Services',
      value: '18',
      trend: 'up',
      trendLabel: '5 vs last 30 days',
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
        value: '12',
        trend: 'down',
        trendLabel: '3 vs last 30 days',
        path: `${base}/complaints`,
        tone: 'red',
        icon: <MessageSquareWarning size={22} strokeWidth={2.5} />,
      },
      {
        id: 'orders',
        label: 'Pending Orders',
        value: '24',
        trend: 'up',
        trendLabel: '8 vs last 30 days',
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
        value: '6',
        trend: 'down',
        trendLabel: '2 vs last 30 days',
        path: `${base}/returns`,
        tone: 'red',
        icon: <MessageSquareWarning size={22} strokeWidth={2.5} />,
      },
      {
        id: 'orders',
        label: 'Cart & Orders',
        value: '—',
        trend: 'up',
        trendLabel: 'View your cart',
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
      { label: 'Create Invoice', path: `${base}/invoices`, icon: <FileText size={20} /> },
    );
  } else {
    actions.push(
      { label: 'Returns', path: `${base}/returns`, icon: <Boxes size={20} /> },
      { label: 'Verification', path: `${base}/verification`, icon: <ShieldCheck size={20} /> },
      { label: 'Products', path: `${base}/products`, icon: <Package size={20} /> },
    );
  }
  return actions;
}

function buildActivities(): ActivityItem[] {
  return [
    {
      id: '1',
      title: 'New Complaint #CMP-2024-00125',
      description: 'Platform scale calibration issue reported by customer.',
      time: '2h ago',
      tone: 'red',
      icon: <MessageSquareWarning size={16} />,
    },
    {
      id: '2',
      title: 'Service Request #SRV-2024-00418',
      description: 'Annual maintenance scheduled for weighing indicator.',
      time: '4h ago',
      tone: 'green',
      icon: <Wrench size={16} />,
    },
    {
      id: '3',
      title: 'Order #ORD-2024-00902',
      description: 'Spare parts order placed — load cell & display board.',
      time: 'Yesterday',
      tone: 'orange',
      icon: <ShoppingCart size={16} />,
    },
    {
      id: '4',
      title: 'Verification #VER-2024-00331',
      description: 'Stamping verification due for 6 bench scales.',
      time: 'Yesterday',
      tone: 'blue',
      icon: <ShieldCheck size={16} />,
    },
    {
      id: '5',
      title: 'Invoice #INV-2024-00764',
      description: 'Invoice generated for ABC Traders — ₹ 42,500.',
      time: '2 days ago',
      tone: 'blue',
      icon: <FileText size={16} />,
    },
  ];
}

function buildMiniStats(base: string): MiniStat[] {
  return [
    {
      label: 'Total Customers',
      value: '256',
      trend: '+12 this month',
      tone: 'blue',
      icon: <Users size={18} />,
    },
    {
      label: 'Active Products',
      value: '48',
      trend: '+3 this month',
      tone: 'green',
      icon: <Package size={18} />,
      actionLabel: 'Browse catalog',
      path: `${base}/products`,
    },
    {
      label: 'Verifications Due',
      value: '15',
      trend: 'Due this week',
      tone: 'orange',
      icon: <ClipboardList size={18} />,
      actionLabel: 'View due list',
      path: `${base}/verification`,
    },
    {
      label: 'Upcoming Trainings',
      value: '2',
      trend: 'Next: 18 Jun',
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

  const kpis = buildKpis(basePath, isDealerStaff);
  const quickActions = buildQuickActions(basePath, isDealerStaff);
  const activities = buildActivities();
  const miniStats = buildMiniStats(basePath);

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
        <button type="button" className="dealer-dash__date-pill" aria-label="Date range">
          <CalendarRange size={16} />
          <span>{formatDateRange()}</span>
        </button>
      </header>

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
              Sales Overview
            </h3>
            <p className="dealer-dash__section-sub">Weekly revenue trend (placeholder)</p>
          </div>
          <button type="button" className="dealer-dash__select-pill">This month</button>
        </div>
        <SalesChart />
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
          <span className="dealer-dash__placeholder-badge">Sample data</span>
        </div>
        <ul className="dealer-dash-activity-list">
          {activities.map(item => (
            <li key={item.id}>
              <button
                type="button"
                className={`dealer-dash-activity dealer-dash-activity--${item.tone}`}
                onClick={() => navigate(`${basePath}/notifications`)}
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
          onClick={() => navigate(`${basePath}/notifications`)}
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
