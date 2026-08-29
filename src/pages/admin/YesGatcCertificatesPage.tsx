import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { YesGatcCertificateList } from '../../components/yesgatc/YesGatcCertificateList';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, useTopBarAction } from '../../context/PageHeaderContext';
import { canUseYesGatcFilters } from '../../lib/staffAccess';
import {
  YESONE_RC_CODE,
  compareYesGatcCertificateLatestFirst,
  certificateMatchesRc,
  isYesGatcOvCertificate,
  isYesoneIwpRcDetail,
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

const GATC_LINK_STATES = [
  { value: 'all', label: 'All' },
  { value: 'linked', label: 'Linked' },
  { value: 'unlinked', label: 'Unlinked' },
] as const;

type GatcPeriod = (typeof GATC_PERIODS)[number]['value'];
type GatcLinkState = (typeof GATC_LINK_STATES)[number]['value'];

function isCertificateLinked(row: YesGatcCertificate): boolean {
  return Boolean(row.invoiceNumber?.trim() || row.invoiceId?.trim());
}

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
  const { user } = useAuth();
  const canFilter = canUseYesGatcFilters(user);
  const [rows, setRows] = useState<YesGatcCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftPeriod, setDraftPeriod] = useState<GatcPeriod>('lifetime');
  const [appliedPeriod, setAppliedPeriod] = useState<GatcPeriod>('lifetime');
  const [draftRc, setDraftRc] = useState(YESONE_RC_CODE);
  const [appliedRc, setAppliedRc] = useState(YESONE_RC_CODE);
  const [draftLink, setDraftLink] = useState<GatcLinkState>('unlinked');
  const [appliedLink, setAppliedLink] = useState<GatcLinkState>('unlinked');
  const [rcs, setRcs] = useState<YesGatcRcDetail[]>(() => withDefaultIwpRc([]));
  const [page, setPage] = useState(1);
  const [storedCount, setStoredCount] = useState<number | null>(null);

  useEffect(() => {
    void listYesGatcRcDetails()
      .then(rows => setRcs(withDefaultIwpRc(rows)))
      .catch(() => setRcs(withDefaultIwpRc([])));
  }, []);

  useEffect(() => {
    const iwp = rcs.find(isYesoneIwpRcDetail);
    if (!iwp) return;
    setAppliedRc(current => (
      current === YESONE_RC_CODE || current === yesGatcRcKey(iwp) ? iwp.id : current
    ));
    setDraftRc(current => (
      current === YESONE_RC_CODE || current === yesGatcRcKey(iwp) ? iwp.id : current
    ));
  }, [rcs]);

  const selectedRc = useMemo(
    () => rcs.find(row => row.id === appliedRc) ?? rcs.find(row => yesGatcRcKey(row) === appliedRc) ?? null,
    [appliedRc, rcs],
  );
  const defaultRcId = useMemo(
    () => rcs.find(isYesoneIwpRcDetail)?.id ?? YESONE_RC_CODE,
    [rcs],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const listed = await listYesGatcCertificates(10000, {
        rcId: selectedRc?.id || appliedRc,
        rcCode: selectedRc ? yesGatcRcKey(selectedRc) : appliedRc,
        ovOnly: true,
      });
      setRows(listed);
      setStoredCount(listed.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load certificates.');
    } finally {
      setLoading(false);
    }
  }, [appliedRc, selectedRc]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canFilter) setFiltersOpen(false);
  }, [canFilter]);

  const hasActiveFilters = appliedPeriod !== 'lifetime'
    || Boolean(selectedRc && !isYesoneIwpRcDetail(selectedRc))
    || appliedLink !== 'unlinked';

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const { start, end } = periodBounds(appliedPeriod);
    return rows
      .filter(row => {
        if (row.voided) return false;
        if (!isYesGatcOvCertificate(row)) return false;
        if (selectedRc && !certificateMatchesRc(row, selectedRc)) return false;
        if (needle) {
          const blob = `${row.certificateNumber} ${row.serialNumber} ${row.invoiceNumber ?? ''}`.toLowerCase();
          if (!blob.includes(needle)) return false;
        }
        if (start != null || end != null) {
          const certified = yesGatcCertifiedTimeMs(row);
          if (certified == null) return false;
          if (start != null && certified < start) return false;
          if (end != null && certified > end) return false;
        }
        if (appliedLink === 'linked' && !isCertificateLinked(row)) return false;
        if (appliedLink === 'unlinked' && isCertificateLinked(row)) return false;
        return true;
      })
      .sort(compareYesGatcCertificateLatestFirst);
  }, [appliedLink, appliedPeriod, rows, search, selectedRc]);

  useEffect(() => {
    setPage(1);
  }, [appliedLink, appliedPeriod, appliedRc, search]);

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
        {canFilter ? (
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
                setDraftLink(appliedLink);
              }
              return !open;
            })}
            aria-expanded={filtersOpen}
            aria-label="Filter certificates"
            title="Filters"
          >
            <SlidersHorizontal size={20} strokeWidth={2.25} />
          </button>
        ) : null}
      </div>
    ),
    [appliedLink, appliedPeriod, appliedRc, canFilter, filtersOpen, hasActiveFilters, search],
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
        {canFilter && filtersOpen ? (
          <div className="yesgatc-filters">
            <div className="yesgatc-filters__top">
              <span className="yesgatc-filters__title">Filters</span>
              <button
                type="button"
                className="yesgatc-filters__close"
                onClick={() => setFiltersOpen(false)}
                aria-label="Close filters"
              >
                <X size={18} />
              </button>
            </div>
            <label className="settings-locations__field settings-locations__field--grow">
              <span>RC</span>
              <select
                value={draftRc}
                onChange={event => setDraftRc(event.target.value)}
                aria-label="Regional center"
              >
                {rcs.map(rc => (
                  <option key={rc.id} value={rc.id}>
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
            <label className="settings-locations__field settings-locations__field--grow">
              <span>Link</span>
              <select
                value={draftLink}
                onChange={event => setDraftLink(event.target.value as GatcLinkState)}
                aria-label="Invoice link status"
              >
                {GATC_LINK_STATES.map(option => (
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
                  setAppliedLink(draftLink);
                  setFiltersOpen(false);
                }}
              >
                Apply
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={
                  draftPeriod === 'lifetime'
                  && appliedPeriod === 'lifetime'
                  && draftRc === defaultRcId
                  && appliedRc === defaultRcId
                  && draftLink === 'unlinked'
                  && appliedLink === 'unlinked'
                }
                onClick={() => {
                  setDraftPeriod('lifetime');
                  setAppliedPeriod('lifetime');
                  setDraftRc(defaultRcId);
                  setAppliedRc(defaultRcId);
                  setDraftLink('unlinked');
                  setAppliedLink('unlinked');
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
            rcs={rcs}
            loading={loading}
            empty={search || hasActiveFilters
              ? 'No GATC certificates match.'
              : 'No GATC certificates.'}
            onLinked={next => {
              setRows(current => current.map(row => (row.id === next.id ? next : row)));
            }}
            onVoided={id => {
              setRows(current => current.filter(row => row.id !== id));
              setStoredCount(count => (count != null ? Math.max(0, count - 1) : count));
            }}
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
