import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2, IndianRupee, MapPinned, Users } from 'lucide-react';
import { IndiaSalesMap } from '../../components/dashboard/IndiaSalesMap';
import {
  SalesMapPeriodSelect,
  type SalesMapPeriod,
} from '../../components/dashboard/SalesMapPeriodSelect';
import { useCatalogPageHeader, useTopBarAction } from '../../context/PageHeaderContext';
import { useHorizontalSwipe } from '../../hooks/useHorizontalSwipe';
import {
  defaultDashboardCustomRange,
  formatDashboardPeriodLabel,
  resolveDashboardPeriodBounds,
  type DashboardPeriodPreset,
} from '../../lib/dashboardPeriod';
import { dealerErrorMessage } from '../../lib/dealers';
import { getInvoicePeriodBounds, toDateInputValue } from '../../lib/invoices';
import { formatCompactInr, loadSalesByState, type StateSalesRow } from '../../lib/salesByState';

const BASE = '/super-admin';

type NavState = {
  period?: DashboardPeriodPreset;
  customRange?: { start: string; end: string };
};

function periodFromDashboard(period?: DashboardPeriodPreset): SalesMapPeriod {
  if (period === 'custom') return 'custom';
  if (period === 'year') return 'financial_year';
  return 'current_month';
}

function resolveSalesMapBounds(
  period: SalesMapPeriod,
  customRange: { start: string; end: string },
): { start: string; end: string } {
  if (period === 'custom') {
    return resolveDashboardPeriodBounds('custom', customRange.start, customRange.end);
  }
  const bounds = getInvoicePeriodBounds(period);
  if (!bounds) return defaultDashboardCustomRange();
  return {
    start: toDateInputValue(bounds.start),
    end: toDateInputValue(bounds.end),
  };
}

export const SalesByStatePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? {}) as NavState;
  const pageRef = useRef<HTMLDivElement>(null);

  const [opsPeriod, setOpsPeriod] = useState<SalesMapPeriod>(
    periodFromDashboard(navState.period),
  );
  const [customRange, setCustomRange] = useState(
    navState.customRange ?? defaultDashboardCustomRange(),
  );
  const [rows, setRows] = useState<StateSalesRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<string | null>(null);

  const periodBounds = useMemo(
    () => resolveSalesMapBounds(opsPeriod, customRange),
    [opsPeriod, customRange.end, customRange.start],
  );
  const periodLabel = useMemo(
    () => formatDashboardPeriodLabel(periodBounds.start, periodBounds.end),
    [periodBounds.end, periodBounds.start],
  );

  useCatalogPageHeader({
    title: 'Sales by state',
    showBack: true,
    onBack: () => navigate(BASE),
  }, true);

  const periodFilter = useMemo(
    () => (
      <SalesMapPeriodSelect
        value={opsPeriod}
        rangeLabel={periodLabel}
        customFrom={customRange.start}
        customTo={customRange.end}
        onChange={next => {
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

  const goDashboard = useCallback(() => {
    navigate(BASE);
  }, [navigate]);

  useHorizontalSwipe(pageRef, {
    onSwipeLeft: goDashboard,
    enabled: true,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadSalesByState({
          dateStart: periodBounds.start,
          dateEnd: periodBounds.end,
        });
        if (cancelled) return;
        setRows(result.rows);
        setTruncated(result.truncated);
        setSelectedState(result.rows[0]?.state ?? null);
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
  }, [periodBounds.end, periodBounds.start]);

  const statesWithSales = useMemo(() => rows.filter(row => row.sales > 0), [rows]);
  const totalSales = useMemo(() => rows.reduce((sum, row) => sum + row.sales, 0), [rows]);
  const activeDealers = useMemo(
    () => rows.reduce((sum, row) => sum + row.activeDealers, 0),
    [rows],
  );

  return (
    <div ref={pageRef} className="page-content fade-in sales-map-page">
      {error && (
        <p className="dealer-dash__error" role="alert">{error}</p>
      )}

      <section className="sales-map__kpis" aria-label="Sales summary">
        <article className="sales-map-kpi sales-map-kpi--blue">
          <span className="sales-map-kpi__icon"><Users size={18} /></span>
          <div>
            <span className="sales-map-kpi__label">Active dealers</span>
            <strong>{loading ? '…' : String(activeDealers)}</strong>
          </div>
        </article>
        <article className="sales-map-kpi sales-map-kpi--green">
          <span className="sales-map-kpi__icon"><IndianRupee size={18} /></span>
          <div>
            <span className="sales-map-kpi__label">Total sales</span>
            <strong>{loading ? '…' : formatCompactInr(totalSales)}</strong>
          </div>
        </article>
        <article className="sales-map-kpi sales-map-kpi--purple">
          <span className="sales-map-kpi__icon"><Building2 size={18} /></span>
          <div>
            <span className="sales-map-kpi__label">States with sales</span>
            <strong>{loading ? '…' : String(rows.filter(r => r.sales > 0).length)}</strong>
          </div>
        </article>
      </section>

      <section className="sales-map__panel">
        <h3 className="dealer-dash__section-title">
          <MapPinned size={18} />
          Sales performance by state
        </h3>
        {loading ? (
          <p className="dealer-dash__empty-note">Loading map…</p>
        ) : (
          <IndiaSalesMap
            rows={rows}
            selectedState={selectedState}
            onSelect={setSelectedState}
          />
        )}
        {truncated && (
          <p className="dealer-dash__empty-note">
            Showing the latest invoices in this range. Older invoices may be omitted.
          </p>
        )}
      </section>

      <section className="sales-map__panel">
        <div className="sales-map__table-head">
          <h3 className="dealer-dash__section-title">All states with sales</h3>
        </div>
        {loading ? (
          <p className="dealer-dash__empty-note">Loading states…</p>
        ) : statesWithSales.length ? (
          <ol className="sales-map__rank-list">
            {statesWithSales.map((row, index) => {
              const tone = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : 'slate';
              return (
                <li key={row.state}>
                  <button
                    type="button"
                    className={`sales-map__rank-row sales-map__rank-row--${tone}${selectedState === row.state ? ' is-active' : ''}`}
                    onClick={() => setSelectedState(row.state)}
                  >
                    <span className={`sales-map__rank sales-map__rank--${tone}`}>{index + 1}</span>
                    <span className="sales-map__rank-main">
                      <strong>{row.state}</strong>
                      <span>{row.activeDealers} active dealers</span>
                      <span className="sales-map__bar" aria-hidden>
                        <span style={{ width: `${Math.max(6, row.share * 100)}%` }} />
                      </span>
                    </span>
                    <span className="sales-map__rank-sales">
                      <strong>{formatCompactInr(row.sales)}</strong>
                      <span>{(row.share * 100).toFixed(1)}%</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="dealer-dash__empty-note">No billed sales in this period.</p>
        )}
      </section>
    </div>
  );
};
