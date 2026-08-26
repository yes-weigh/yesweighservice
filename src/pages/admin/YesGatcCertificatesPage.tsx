import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { YesGatcCertificateList } from '../../components/yesgatc/YesGatcCertificateList';
import { useCatalogPageHeader, useTopBarAction } from '../../context/PageHeaderContext';
import {
  compareYesGatcCertificateLatestFirst,
  countYesGatcIwpCertificates,
  listYesGatcCertificates,
  type YesGatcCertificate,
} from '../../lib/yesgatcRecords';

const PAGE_SIZE = 30;

function dayStartMs(ymd: string): number | null {
  if (!ymd) return null;
  const date = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function dayEndMs(ymd: string): number | null {
  if (!ymd) return null;
  const date = new Date(`${ymd}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export const YesGatcCertificatesPage: React.FC = () => {
  const [rows, setRows] = useState<YesGatcCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dealerQuery, setDealerQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [storedCount, setStoredCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [listed, counted] = await Promise.all([
        listYesGatcCertificates(),
        countYesGatcIwpCertificates().catch(() => 0),
      ]);
      setRows(listed);
      setStoredCount(Math.max(listed.length, counted));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load certificates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasActiveFilters = Boolean(dealerQuery.trim() || fromDate || toDate);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const dealerNeedle = dealerQuery.trim().toLowerCase();
    const fromMs = dayStartMs(fromDate);
    const toMs = dayEndMs(toDate);
    return rows
      .filter(row => {
        if (needle) {
          const blob = `${row.certificateNumber} ${row.serialNumber}`.toLowerCase();
          if (!blob.includes(needle)) return false;
        }
        if (dealerNeedle && !row.dealerName.toLowerCase().includes(dealerNeedle)) return false;
        if (fromMs != null || toMs != null) {
          const received = row.receivedAt ? new Date(row.receivedAt).getTime() : NaN;
          if (Number.isNaN(received)) return false;
          if (fromMs != null && received < fromMs) return false;
          if (toMs != null && received > toMs) return false;
        }
        return true;
      })
      .sort(compareYesGatcCertificateLatestFirst);
  }, [dealerQuery, fromDate, rows, search, toDate]);

  useEffect(() => {
    setPage(1);
  }, [dealerQuery, fromDate, search, toDate]);

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
          onClick={() => setFiltersOpen(open => !open)}
          aria-expanded={filtersOpen}
          aria-label="Filter certificates"
          title="Filters"
        >
          <SlidersHorizontal size={20} strokeWidth={2.25} />
        </button>
      </div>
    ),
    [filtersOpen, hasActiveFilters, search],
  );

  useCatalogPageHeader({ title: 'GATC' }, true);
  useTopBarAction(headerActions);

  const pagination = !loading && visibleRows.length > 0 ? (
    <>
      <span className="invoices-pagination__info text-muted text-sm">
        {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visibleRows.length)} of {visibleRows.length.toLocaleString('en-IN')}
        {storedCount != null && !search && !dealerQuery && !fromDate && !toDate
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
            <label className="settings-locations__field">
              <span>From</span>
              <input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            </label>
            <label className="settings-locations__field">
              <span>To</span>
              <input type="date" value={toDate} onChange={event => setToDate(event.target.value)} />
            </label>
            <label className="settings-locations__field settings-locations__field--grow">
              <span>Dealer</span>
              <input
                type="search"
                value={dealerQuery}
                onChange={event => setDealerQuery(event.target.value)}
                placeholder="Dealer name"
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!hasActiveFilters}
              onClick={() => {
                setDealerQuery('');
                setFromDate('');
                setToDate('');
              }}
            >
              Clear
            </button>
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
            empty="No GATC certificates match."
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
