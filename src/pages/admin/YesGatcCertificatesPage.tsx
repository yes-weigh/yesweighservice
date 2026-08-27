import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { YesGatcCertificateList } from '../../components/yesgatc/YesGatcCertificateList';
import { useCatalogPageHeader, useTopBarAction } from '../../context/PageHeaderContext';
import {
  YESONE_RC_CODE,
  compareYesGatcCertificateLatestFirst,
  countYesGatcIwpCertificates,
  listYesGatcCertificates,
  listYesGatcRcDetails,
  withDefaultIwpRc,
  yesGatcCertifiedTimeMs,
  yesGatcRcKey,
  yesGatcRcLabel,
  type YesGatcCertificate,
  type YesGatcRcDetail,
} from '../../lib/yesgatcRecords';

const PAGE_SIZE = 30;

const GATC_PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_qtr', label: 'This Qtr' },
  { value: 'this_year', label: 'This Year' },
  { value: 'lifetime', label: 'Life Time' },
] as const;

type GatcPeriod = (typeof GATC_PERIODS)[number]['value'];

function periodBounds(period: GatcPeriod, now = new Date()): { start: number | null; end: number | null } {
  if (period === 'lifetime') return { start: null, end: null };
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'this_month') start.setDate(1);
  else if (period === 'this_qtr') start.setMonth(Math.floor(now.getMonth() / 3) * 3, 1);
  else if (period === 'this_year') start.setMonth(0, 1);
  return { start: start.getTime(), end: end.getTime() };
}

export const YesGatcCertificatesPage: React.FC = () => {
  const [rows, setRows] = useState<YesGatcCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [draftPeriod, setDraftPeriod] = useState<GatcPeriod>('lifetime');
  const [appliedPeriod, setAppliedPeriod] = useState<GatcPeriod>('lifetime');
  const [draftRc, setDraftRc] = useState(YESONE_RC_CODE);
  const [appliedRc, setAppliedRc] = useState(YESONE_RC_CODE);
  const [rcs, setRcs] = useState<YesGatcRcDetail[]>(() => withDefaultIwpRc([]));
  const [page, setPage] = useState(1);
  const [storedCount, setStoredCount] = useState<number | null>(null);

  useEffect(() => {
    void listYesGatcRcDetails()
      .then(rows => setRcs(withDefaultIwpRc(rows)))
      .catch(() => setRcs(withDefaultIwpRc([])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [listed, counted] = await Promise.all([
        listYesGatcCertificates(10000, { rcCode: appliedRc }),
        countYesGatcIwpCertificates(appliedRc).catch(() => 0),
      ]);
      setRows(listed);
      setStoredCount(Math.max(listed.length, counted));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load certificates.');
    } finally {
      setLoading(false);
    }
  }, [appliedRc]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasActiveFilters = appliedPeriod !== 'lifetime' || appliedRc !== YESONE_RC_CODE;

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const { start, end } = periodBounds(appliedPeriod);
    return rows
      .filter(row => {
        if (needle) {
          const blob = `${row.certificateNumber} ${row.serialNumber}`.toLowerCase();
          if (!blob.includes(needle)) return false;
        }
        if (start != null || end != null) {
          const certified = yesGatcCertifiedTimeMs(row);
          if (certified == null) return false;
          if (start != null && certified < start) return false;
          if (end != null && certified > end) return false;
        }
        return true;
      })
      .sort(compareYesGatcCertificateLatestFirst);
  }, [appliedPeriod, rows, search]);

  useEffect(() => {
    setPage(1);
  }, [appliedPeriod, search]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = visibleRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const headerActions = useMemo(
    () => (
      <div className="catalog-header-actions yesgatc-header-actions">
        <div className="catalog-search invoices-header-search yesgatc-header-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Serial or certificate"
            aria-label="Search serial number or certificate number"
          />
          {search ? (
            <button
              type="button"
              className="invoices-header-search__clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className={[
            'catalog-header-filter-btn',
            filtersOpen ? 'catalog-header-filter-btn--open' : '',
            hasActiveFilters ? 'catalog-header-filter-btn--active' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => setFiltersOpen(open => {
            if (!open) {
              setDraftPeriod(appliedPeriod);
              setDraftRc(appliedRc);
            }
            return !open;
          })}
          aria-expanded={filtersOpen}
          aria-label="Filter certificates"
          title="Filters"
        >
          <SlidersHorizontal size={20} strokeWidth={2.25} />
        </button>
      </div>
    ),
    [appliedPeriod, appliedRc, filtersOpen, hasActiveFilters, search],
  );

  useCatalogPageHeader({ title: 'GATC' }, true);
  useTopBarAction(headerActions);

  const pagination = !loading && visibleRows.length > 0 ? (
    <>
      <span className="invoices-pagination__info text-muted text-sm">
        {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visibleRows.length)} of {visibleRows.length.toLocaleString('en-IN')}
        {storedCount != null && !search && !hasActiveFilters
          ? ` · ${storedCount.toLocaleString('en-IN')} stored`
          : ''}
      </span>
      <div className="invoices-pagination__btns">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={safePage <= 1}
          onClick={() => setPage(current => Math.max(1, current - 1))}
        >
          Prev
        </button>
        <span className="invoices-pagination__page text-sm">
          {safePage} / {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={safePage >= totalPages}
          onClick={() => setPage(current => Math.min(totalPages, current + 1))}
        >
          Next
        </button>
      </div>
    </>
  ) : null;

  return (
    <div className="page-content fade-in yesgatc-certs-page">
      <section className="settings-locations panel glass yesgatc-certs-panel">
        {filtersOpen ? (
          <div className="yesgatc-filters">
            <label className="settings-locations__field settings-locations__field--grow">
              <span>RC</span>
              <select
                value={draftRc}
                onChange={event => setDraftRc(event.target.value)}
                aria-label="Regional center"
              >
                {rcs.map(rc => (
                  <option key={rc.id} value={yesGatcRcKey(rc)}>
                    {yesGatcRcLabel(rc)}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-locations__field settings-locations__field--grow">
              <span>Period</span>
              <select
                value={draftPeriod}
                onChange={event => setDraftPeriod(event.target.value as GatcPeriod)}
                aria-label="Certificate period"
              >
                {GATC_PERIODS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="yesgatc-filters__actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setAppliedPeriod(draftPeriod);
                  setAppliedRc(draftRc);
                }}
              >
                Apply
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={draftPeriod === 'lifetime' && appliedPeriod === 'lifetime' && draftRc === YESONE_RC_CODE && appliedRc === YESONE_RC_CODE}
                onClick={() => {
                  setDraftPeriod('lifetime');
                  setAppliedPeriod('lifetime');
                  setDraftRc(YESONE_RC_CODE);
                  setAppliedRc(YESONE_RC_CODE);
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}
        {error ? <p className="settings-locations__error">{error}</p> : null}
        {pagination ? (
          <div className="invoices-pagination yesgatc-certs-pagination yesgatc-certs-pagination--top" role="navigation" aria-label="Certificate list pagination">
            {pagination}
          </div>
        ) : null}
        <div className="yesgatc-certs-scroll">
          <YesGatcCertificateList
            rows={pageRows}
            loading={loading}
            empty={search || hasActiveFilters
              ? 'No GATC certificates match.'
              : 'No GATC certificates.'}
          />
        </div>
        {pagination ? (
          <footer className="invoices-pagination yesgatc-certs-pagination yesgatc-certs-pagination--bottom" role="navigation" aria-label="Certificate list pagination footer">
            {pagination}
          </footer>
        ) : null}
      </section>
    </div>
  );
};
