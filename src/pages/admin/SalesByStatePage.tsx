import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2, IndianRupee, MapPinned, Users } from 'lucide-react';
import { IndiaSalesMap } from '../../components/dashboard/IndiaSalesMap';
import { KeralaSalesMap } from '../../components/dashboard/KeralaSalesMap';
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
import { KERALA_STATE } from '../../lib/keralaDistricts';
import {
  formatCompactInr,
  loadSalesByState,
  type DistrictSalesRow,
  type StateSalesRow,
} from '../../lib/salesByState';

const BASE = '/super-admin';

type NavState = {
  period?: DashboardPeriodPreset;
  customRange?: { start: string; end: string };
  mapLevel?: 'india' | 'kerala';
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
  const [keralaDistricts, setKeralaDistricts] = useState<DistrictSalesRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapLevel, setMapLevel] = useState<'india' | 'kerala'>(navState.mapLevel ?? 'india');
  const [selectedState, setSelectedState] = useState<string | null>(KERALA_STATE);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const showingKerala = mapLevel === 'kerala';

  const periodBounds = useMemo(
    () => resolveSalesMapBounds(opsPeriod, customRange),
    [opsPeriod, customRange.end, customRange.start],
  );
  const periodLabel = useMemo(
    () => formatDashboardPeriodLabel(periodBounds.start, periodBounds.end),
    [periodBounds.end, periodBounds.start],
  );

  const goIndia = useCallback(() => {
    setMapLevel('india');
    setSelectedState(KERALA_STATE);
    setFocusKey(key => key + 1);
  }, []);

  const goDashboard = useCallback(() => {
    navigate(BASE);
  }, [navigate]);

  useCatalogPageHeader({
    title: showingKerala ? 'Kerala districts' : 'Sales by state',
    showBack: true,
    onBack: showingKerala ? goIndia : goDashboard,
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

  const openKeralaDistricts = useCallback((districts = keralaDistricts) => {
    const leader = districts.find(row => row.sales > 0)?.district ?? districts[0]?.district ?? null;
    setMapLevel('kerala');
    setSelectedState(KERALA_STATE);
    setSelectedDistrict(leader);
    setFocusKey(key => key + 1);
  }, [keralaDistricts]);

  const selectSalesLeader = useCallback(() => {
    if (showingKerala) {
      openKeralaDistricts();
      return;
    }
    const leader = rows.find(row => row.sales > 0)?.state ?? rows[0]?.state ?? null;
    if (leader === KERALA_STATE) {
      openKeralaDistricts();
      return;
    }
    setSelectedState(leader);
    setFocusKey(key => key + 1);
  }, [openKeralaDistricts, rows, showingKerala]);

  useHorizontalSwipe(pageRef, {
    onSwipeLeft: showingKerala ? goIndia : goDashboard,
    onSwipeRight: selectSalesLeader,
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
        setKeralaDistricts(result.keralaDistricts);
        setTruncated(result.truncated);
        const leader = result.rows.find(row => row.sales > 0)?.state ?? result.rows[0]?.state ?? null;
        setSelectedState(leader ?? KERALA_STATE);
        if (navState.mapLevel === 'kerala' && (!leader || leader === KERALA_STATE)) {
          const districtLeader =
            result.keralaDistricts.find(row => row.sales > 0)?.district
            ?? result.keralaDistricts[0]?.district
            ?? null;
          setMapLevel('kerala');
          setSelectedDistrict(districtLeader);
        } else {
          setMapLevel('india');
        }
        setFocusKey(key => key + 1);
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
  const districtsWithSales = useMemo(
    () => keralaDistricts.filter(row => row.sales > 0),
    [keralaDistricts],
  );
  const rankedRows = showingKerala ? districtsWithSales : statesWithSales;
  const totalSales = useMemo(
    () => (showingKerala
      ? keralaDistricts.reduce((sum, row) => sum + row.sales, 0)
      : rows.reduce((sum, row) => sum + row.sales, 0)),
    [keralaDistricts, rows, showingKerala],
  );
  const activeDealers = useMemo(
    () => (showingKerala
      ? keralaDistricts.reduce((sum, row) => sum + row.activeDealers, 0)
      : rows.reduce((sum, row) => sum + row.activeDealers, 0)),
    [keralaDistricts, rows, showingKerala],
  );

  const selectState = useCallback((state: string) => {
    setSelectedState(state);
    if (state === KERALA_STATE) {
      openKeralaDistricts();
      return;
    }
    setMapLevel('india');
    setFocusKey(key => key + 1);
  }, [openKeralaDistricts]);

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
            <span className="sales-map-kpi__label">
              {showingKerala ? 'Districts with sales' : 'States with sales'}
            </span>
            <strong>{loading ? '…' : String(rankedRows.length)}</strong>
          </div>
        </article>
      </section>

      <section className="sales-map__panel">
        <h3 className="dealer-dash__section-title">
          <MapPinned size={18} />
          {showingKerala ? 'Sales performance by district' : 'Sales performance by state'}
        </h3>
        {loading ? (
          <p className="dealer-dash__empty-note">Loading map…</p>
        ) : showingKerala ? (
          <KeralaSalesMap
            rows={keralaDistricts}
            selectedDistrict={selectedDistrict}
            focusKey={focusKey}
            onSelect={setSelectedDistrict}
          />
        ) : (
          <IndiaSalesMap
            rows={rows}
            selectedState={selectedState}
            focusKey={focusKey}
            onSelect={selectState}
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
          <h3 className="dealer-dash__section-title">
            {showingKerala ? 'All districts by sales' : 'All states with sales'}
          </h3>
        </div>
        {loading ? (
          <p className="dealer-dash__empty-note">
            {showingKerala ? 'Loading districts…' : 'Loading states…'}
          </p>
        ) : rankedRows.length ? (
          <ol className="sales-map__rank-list">
            {rankedRows.map((row, index) => {
              const name = 'district' in row ? row.district : row.state;
              const selected = showingKerala ? selectedDistrict === name : selectedState === name;
              const tone = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : 'slate';
              return (
                <li key={name}>
                  <button
                    type="button"
                    className={`sales-map__rank-row sales-map__rank-row--${tone}${selected ? ' is-active' : ''}`}
                    onClick={() => {
                      if (showingKerala) setSelectedDistrict(name);
                      else selectState(name);
                    }}
                  >
                    <span className={`sales-map__rank sales-map__rank--${tone}`}>{index + 1}</span>
                    <span className="sales-map__rank-main">
                      <strong>{name}</strong>
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
