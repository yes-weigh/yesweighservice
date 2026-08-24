import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
  Building2,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  Loader2,
  PackagePlus,
  Shield,
  Truck,
  UserCheck,
  UserMinus,
} from 'lucide-react';
import { DashboardPeriodFilter } from '../../components/dashboard/DashboardPeriodFilter';
import { useTopBarAction } from '../../context/PageHeaderContext';
import { loadAdminInvoiceKpis } from '../../lib/admin-invoices';
import { countAdminPurchaseOrders } from '../../lib/admin-purchase-orders';
import { countAdminSalesOrdersByYesOneStages } from '../../lib/admin-sales-orders';
import {
  defaultDashboardCustomRange,
  formatDashboardPeriodLabel,
  resolveDashboardPeriodBounds,
  type DashboardPeriodPreset,
} from '../../lib/dashboardPeriod';
import { dealerErrorMessage, fetchDealerStats } from '../../lib/dealers';
import { countOpsSupportRequestsInRange } from '../../lib/dealerSupport';
import { refreshKotakBankFeeds } from '../../lib/kotakBankFeeds';
import kotakBankLogo from '../../assets/kotak-mahindra-bank.jpg';
import type { DealerStats } from '../../types/dealers';

const BASE = '/super-admin';

const EMPTY_OPS_COUNTS = {
  newOrders: 0,
  pendingApproval: 0,
  toDispatch: 0,
  warrantySupport: 0,
  openComplaints: 0,
  purchaseOrders: 0,
};

export const SuperAdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [dealerStats, setDealerStats] = useState<DealerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [opsLoading, setOpsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opsPeriod, setOpsPeriod] = useState<DashboardPeriodPreset>('month');
  const [customRange, setCustomRange] = useState(defaultDashboardCustomRange);
  const [opsCounts, setOpsCounts] = useState(EMPTY_OPS_COUNTS);
  const [kotakPhase, setKotakPhase] = useState<'idle' | 'working' | 'ok' | 'fail'>('idle');
  const [kotakMessage, setKotakMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const stats = await fetchDealerStats();
        if (!cancelled) setDealerStats(stats);
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

  const periodBounds = useMemo(
    () => resolveDashboardPeriodBounds(opsPeriod, customRange.start, customRange.end),
    [customRange.end, customRange.start, opsPeriod],
  );
  const periodLabel = useMemo(
    () => formatDashboardPeriodLabel(periodBounds.start, periodBounds.end),
    [periodBounds.end, periodBounds.start],
  );

  useEffect(() => {
    let cancelled = false;
    const loadOps = async () => {
      setOpsLoading(true);
      try {
        const [stages, invoiceKpi, warrantySupport, openComplaints, purchaseOrders] = await Promise.all([
          countAdminSalesOrdersByYesOneStages({
            dateStart: periodBounds.start,
            dateEnd: periodBounds.end,
          }),
          loadAdminInvoiceKpis({
            dateStart: periodBounds.start,
            dateEnd: periodBounds.end,
            category: 'all',
          }),
          countOpsSupportRequestsInRange(periodBounds.start, periodBounds.end, {
            types: ['service', 'return', 'chat'],
          }),
          countOpsSupportRequestsInRange(periodBounds.start, periodBounds.end, {
            types: ['complaint'],
          }),
          countAdminPurchaseOrders({
            dateStart: periodBounds.start,
            dateEnd: periodBounds.end,
            status: '',
          }),
        ]);
        if (cancelled) return;
        const invoiceStatuses = invoiceKpi.byFilterStatus ?? {};
        setOpsCounts({
          newOrders: stages.review,
          pendingApproval: stages.payment_submitted,
          toDispatch: invoiceStatuses.to_dispatch ?? 0,
          warrantySupport,
          openComplaints,
          purchaseOrders,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : dealerErrorMessage(err));
        }
      } finally {
        if (!cancelled) setOpsLoading(false);
      }
    };
    void loadOps();
    return () => {
      cancelled = true;
    };
  }, [periodBounds.end, periodBounds.start]);

  const periodFilter = useMemo(
    () => (
      <DashboardPeriodFilter
        preset={opsPeriod}
        customFrom={customRange.start}
        customTo={customRange.end}
        rangeLabel={periodLabel}
        onPresetChange={next => {
          setOpsPeriod(next);
          if (next === 'custom' && (!customRange.start || !customRange.end)) {
            setCustomRange(defaultDashboardCustomRange());
          }
        }}
        onCustomFromChange={start => setCustomRange(prev => ({ ...prev, start }))}
        onCustomToChange={end => setCustomRange(prev => ({ ...prev, end }))}
      />
    ),
    [customRange.end, customRange.start, opsPeriod, periodLabel],
  );

  useTopBarAction(periodFilter);

  const refreshKotakFeeds = async () => {
    if (kotakPhase === 'working') return;
    setKotakPhase('working');
    setKotakMessage('Asking Zoho Books to refresh Kotak bank feeds…');
    try {
      const result = await refreshKotakBankFeeds();
      setKotakPhase('ok');
      setKotakMessage(result.message);
      window.setTimeout(() => {
        setKotakPhase(current => (current === 'ok' ? 'idle' : current));
        setKotakMessage(current => (current === result.message ? null : current));
      }, 5000);
    } catch (err) {
      setKotakPhase('fail');
      setKotakMessage(err instanceof Error ? err.message : 'Could not refresh Kotak bank feeds.');
    }
  };

  const opsKpis = [
    {
      id: 'to-dispatch',
      label: 'To dispatch',
      value: opsLoading ? '…' : String(opsCounts.toDispatch),
      path: `${BASE}/invoices`,
      tone: 'orange' as const,
      icon: <Truck size={22} strokeWidth={2.5} />,
    },
    {
      id: 'pending-approval',
      label: 'Pending approval',
      value: opsLoading ? '…' : String(opsCounts.pendingApproval),
      path: `${BASE}/sales-orders`,
      tone: 'orange' as const,
      icon: <Clock size={22} strokeWidth={2.5} />,
    },
    {
      id: 'new-orders',
      label: 'New orders',
      value: opsLoading ? '…' : String(opsCounts.newOrders),
      path: `${BASE}/sales-orders`,
      tone: 'blue' as const,
      icon: <PackagePlus size={22} strokeWidth={2.5} />,
    },
    {
      id: 'purchase-orders',
      label: 'Purchase orders',
      value: opsLoading ? '…' : String(opsCounts.purchaseOrders),
      path: `${BASE}/purchase-orders`,
      tone: 'blue' as const,
      icon: <ClipboardList size={22} strokeWidth={2.5} />,
    },
    {
      id: 'warranty-support',
      label: 'Warranty support',
      value: opsLoading ? '…' : String(opsCounts.warrantySupport),
      path: `${BASE}/warranty-support`,
      tone: 'green' as const,
      icon: <Shield size={22} strokeWidth={2.5} />,
    },
    {
      id: 'open-complaints',
      label: 'Open complaints',
      value: opsLoading ? '…' : String(opsCounts.openComplaints),
      path: `${BASE}/warranty-support`,
      tone: 'red' as const,
      icon: <AlertTriangle size={22} strokeWidth={2.5} />,
    },
  ];

  const dealerKpis = [
    {
      id: 'dealers-total',
      label: 'Total Dealers',
      value: loading ? '…' : dealerStats ? String(dealerStats.total) : '—',
      path: `${BASE}/dealers`,
      tone: 'blue' as const,
      icon: <Building2 size={22} strokeWidth={2.5} />,
    },
    {
      id: 'dealers-active',
      label: 'Active Dealers',
      value: loading ? '…' : dealerStats ? String(dealerStats.active) : '—',
      path: `${BASE}/dealers`,
      tone: 'green' as const,
      icon: <UserCheck size={22} strokeWidth={2.5} />,
    },
    {
      id: 'dealers-non-active',
      label: 'Non Active Dealers',
      value: loading ? '…' : dealerStats ? String(dealerStats.nonActive) : '—',
      path: `${BASE}/dealers`,
      tone: 'orange' as const,
      icon: <UserMinus size={22} strokeWidth={2.5} />,
    },
    {
      id: 'dealers-blacklisted',
      label: 'Blacklisted Dealers',
      value: loading ? '…' : dealerStats ? String(dealerStats.blacklisted) : '—',
      path: `${BASE}/dealers`,
      tone: 'red' as const,
      icon: <Ban size={22} strokeWidth={2.5} />,
    },
  ];

  return (
    <div className="page-content fade-in dealer-dashboard">
      {error && (
        <p className="dealer-dash__error" role="alert">
          {error}
        </p>
      )}

      <section className="dealer-dash__kpis-layout" aria-label="Key metrics">
        <section className="dealer-dash-period-panel" aria-label="Orders and support">
          <div className="dealer-dash__kpis-grid dealer-dash__kpis-grid--pairs">
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
                </div>
                <ChevronRight size={18} className="dealer-dash-kpi__chevron" aria-hidden />
              </button>
            ))}
          </div>
        </section>

        <div className="dealer-dash__kpis-grid dealer-dash__kpis-grid--dealer-stages">
          {dealerKpis.map(card => (
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
          <button
            type="button"
            className={`dealer-dash-kpi dealer-dash-kpi--kotak-tile${kotakPhase === 'working' ? ' is-busy' : ''}${kotakPhase === 'ok' ? ' is-ok' : ''}${kotakPhase === 'fail' ? ' is-fail' : ''}`}
            onClick={() => void refreshKotakFeeds()}
            disabled={kotakPhase === 'working'}
            aria-label="Refresh Kotak bank feeds in Zoho Books"
            title="Refresh Kotak bank feeds in Zoho Books"
          >
            <span className="dealer-dash-kpi__kotak-logo-wrap">
              {kotakPhase === 'working' ? (
                <Loader2 size={22} className="spin-icon" />
              ) : kotakPhase === 'ok' ? (
                <Check size={22} strokeWidth={3} />
              ) : (
                <img
                  src={kotakBankLogo}
                  alt=""
                  className="dealer-dash-kpi__kotak-logo"
                />
              )}
            </span>
            <div className="dealer-dash-kpi__body">
              <span className="dealer-dash-kpi__label">Kotak</span>
              <strong className="dealer-dash-kpi__value dealer-dash-kpi__value--sub">
                {kotakPhase === 'working'
                  ? 'Refreshing…'
                  : kotakPhase === 'ok'
                    ? 'Refresh started'
                    : kotakPhase === 'fail'
                      ? 'Try again'
                      : 'Refresh feeds'}
              </strong>
            </div>
          </button>
        </div>
        {kotakMessage ? (
          <p
            className={`dealer-dash__kotak-status${kotakPhase === 'fail' ? ' is-fail' : ''}${kotakPhase === 'ok' ? ' is-ok' : ''}`}
            role="status"
          >
            {kotakMessage}
          </p>
        ) : null}
      </section>
    </div>
  );
};
