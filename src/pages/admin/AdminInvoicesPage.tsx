import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  FileText,
  IndianRupee,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  buildAdminSalesEntries,
  fetchAdminCustomerLocations,
  filterAdminInvoices,
  filterAdminInvoicesByPeriod,
  formatAdminCustomerLocation,
  subscribeAdminInvoices,
  type AdminFirestoreInvoice,
  type AdminInvoiceSort,
} from '../../lib/admin-invoices';
import { formatCurrency } from '../../lib/catalog';
import {
  computeSalesForPeriod,
  formatInvoiceDate,
  formatInvoiceItemQuantity,
  formatKpiPeriodRange,
  invoiceStatusLabel,
} from '../../lib/invoices';
import type { SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

const PAGE_SIZE = 500;
const LIST_PAGE_SIZE = 25;
const DEFAULT_RANGE: SalesRangePreset = 'current_month';
const DEFAULT_SORT: AdminInvoiceSort = 'date';

const SORT_OPTIONS: Array<{ value: AdminInvoiceSort; label: string }> = [
  { value: 'date', label: 'Invoice date' },
  { value: 'syncedAt', label: 'Most recently updated' },
];

function invoiceStatusClass(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return `invoices-status invoices-status--${key}`;
}

function AdminFilterSheet({
  open,
  rangePreset,
  sort,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  sort: AdminInvoiceSort;
  onClose: () => void;
  onApply: (next: { rangePreset: SalesRangePreset; sort: AdminInvoiceSort }) => void;
}) {
  const [draftRange, setDraftRange] = useState(rangePreset);
  const [draftSort, setDraftSort] = useState(sort);

  useEffect(() => {
    if (!open) return;
    setDraftRange(rangePreset);
    setDraftSort(sort);
  }, [open, rangePreset, sort]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const draftDirty = draftRange !== DEFAULT_RANGE || draftSort !== DEFAULT_SORT;

  return createPortal(
    <>
      <button
        type="button"
        className="catalog-filter-dropdown__backdrop"
        aria-label="Close filters"
        onClick={onClose}
      />
      <div
        className="catalog-filter-dropdown panel glass"
        role="dialog"
        aria-modal="true"
        aria-label="Filter invoices"
      >
        <div className="catalog-spares-multi-filters catalog-spares-multi-filters--dropdown">
          <div className="catalog-spares-multi-filters__header">
            <span className="catalog-spares-multi-filters__title">Filters</span>
            <div className="catalog-spares-multi-filters__header-actions">
              <button
                type="button"
                className="catalog-spares-multi-filters__close"
                onClick={onClose}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="catalog-spares-multi-filters__body">
            <div className="catalog-spares-multi-filters__group">
              <span className="catalog-spares-multi-filters__label">Date range</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Date range">
                {SALES_RANGE_OPTIONS.map(option => {
                  const checked = draftRange === option.value;
                  const id = `admin-invoice-range-${String(option.value)}`;
                  return (
                    <label key={String(option.value)} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="admin-invoice-date-range"
                        checked={checked}
                        onChange={() => setDraftRange(option.value)}
                      />
                      <span className="catalog-spares-multi-filters__option-label">{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="catalog-spares-multi-filters__group">
              <span className="catalog-spares-multi-filters__label">Sort by</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Sort by">
                {SORT_OPTIONS.map(option => {
                  const checked = draftSort === option.value;
                  const id = `admin-invoice-sort-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="admin-invoice-sort"
                        checked={checked}
                        onChange={() => setDraftSort(option.value)}
                      />
                      <span className="catalog-spares-multi-filters__option-label">{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="catalog-spares-multi-filters__footer">
            <button
              type="button"
              className="catalog-spares-multi-filters__apply"
              onClick={() => {
                onApply({ rangePreset: draftRange, sort: draftSort });
                onClose();
              }}
            >
              Apply
            </button>
            <button
              type="button"
              className="catalog-spares-multi-filters__clear-btn"
              disabled={!draftDirty}
              onClick={() => {
                setDraftRange(DEFAULT_RANGE);
                setDraftSort(DEFAULT_SORT);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

export const AdminInvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdminFirestoreInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminInvoiceSort>(DEFAULT_SORT);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [customerLocations, setCustomerLocations] = useState(
    () => new Map<string, { district: string | null; state: string | null }>(),
  );

  useEffect(() => {
    setLoading(true);
    setError('');
    const unsubscribe = subscribeAdminInvoices(
      sort,
      PAGE_SIZE,
      next => {
        setRows(next);
        setLoading(false);
      },
      message => {
        setError(message);
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [sort]);

  const periodRows = useMemo(
    () => filterAdminInvoicesByPeriod(rows, rangePreset),
    [rows, rangePreset],
  );

  const filtered = useMemo(
    () => filterAdminInvoices(periodRows, search),
    [periodRows, search],
  );

  useEffect(() => {
    setPage(1);
  }, [search, rangePreset, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * LIST_PAGE_SIZE;
    return filtered.slice(start, start + LIST_PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    const customerIds = pageRows.map(invoice => invoice.customerId);
    if (!customerIds.length) {
      setCustomerLocations(new Map());
      return;
    }

    let cancelled = false;
    void fetchAdminCustomerLocations(customerIds).then(map => {
      if (!cancelled) setCustomerLocations(map);
    });

    return () => {
      cancelled = true;
    };
  }, [pageRows]);

  const openInvoice = (invoice: AdminFirestoreInvoice) => {
    navigate(`/super-admin/invoices/${invoice.customerId}/${invoice.id}/invoice`);
  };

  const summary = useMemo(() => {
    const salesEntries = buildAdminSalesEntries(filtered);
    const sales = salesEntries.length ? computeSalesForPeriod(salesEntries, rangePreset) : null;
    return {
      invoiceCount: filtered.length,
      totalSales: sales?.totalSales ?? 0,
      periodStart: sales?.periodStart ?? null,
      periodEnd: sales?.periodEnd ?? new Date().toISOString(),
    };
  }, [filtered, rangePreset]);

  const dateRange = formatKpiPeriodRange(summary.periodStart, summary.periodEnd);
  const hasActiveFilters = rangePreset !== DEFAULT_RANGE || sort !== DEFAULT_SORT;

  const headerTools = useMemo(
    () => (
      <div className="invoices-header-tools">
        <div className="catalog-search invoices-header-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search invoice #, customer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search invoices"
          />
          {search && (
            <button
              type="button"
              className="invoices-header-search__clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          type="button"
          className={[
            'catalog-header-filter-btn',
            filterOpen ? 'catalog-header-filter-btn--open' : '',
            hasActiveFilters ? 'catalog-header-filter-btn--active' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => setFilterOpen(open => !open)}
          aria-expanded={filterOpen}
          aria-haspopup="dialog"
          aria-label="Filter invoices"
          title="Filters"
        >
          <SlidersHorizontal size={20} strokeWidth={2.25} />
        </button>
      </div>
    ),
    [search, filterOpen, hasActiveFilters],
  );

  useCatalogPageHeader({ mobileCompactHeader: true }, true);
  usePageHeaderSlot(headerTools);

  return (
    <div className="page-content fade-in admin-invoices-page invoices-page">
      <section className="invoices-summary" aria-label="Invoice summary">
        <div className="invoices-summary__kpis">
          <div className="invoices-summary__kpi">
            <span className="invoices-summary__kpi-icon" aria-hidden>
              <FileText size={18} strokeWidth={2.4} />
            </span>
            <span className="invoices-summary__kpi-label">Total Invoices</span>
            <strong className="invoices-summary__kpi-value">
              {loading ? '…' : summary.invoiceCount.toLocaleString('en-IN')}
            </strong>
            <span className="invoices-summary__kpi-sub">
              {loading ? '—' : dateRange}
            </span>
          </div>
          <div className="invoices-summary__divider" aria-hidden />
          <div className="invoices-summary__kpi">
            <span className="invoices-summary__kpi-icon" aria-hidden>
              <IndianRupee size={18} strokeWidth={2.4} />
            </span>
            <span className="invoices-summary__kpi-label">Total Amount</span>
            <strong className="invoices-summary__kpi-value invoices-summary__kpi-value--amount">
              {loading ? '…' : formatCurrency(summary.totalSales)}
            </strong>
            <span className="invoices-summary__kpi-sub">Amount</span>
          </div>
        </div>
      </section>

      {error && (
        <div className="products-inline-error panel glass admin-invoices-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <FetchingLoader label="Loading invoices…" />
      ) : filtered.length === 0 ? (
        <div className="invoices-empty panel glass">
          <FileText size={40} className="text-muted" aria-hidden />
          <p>No invoices found for this period.</p>
        </div>
      ) : (
        <>
          {totalPages > 1 && (
            <div className="invoices-pagination invoices-pagination--top" role="navigation" aria-label="Invoice list pagination">
              <span className="invoices-pagination__info text-muted text-sm">
                {(page - 1) * LIST_PAGE_SIZE + 1}–{Math.min(page * LIST_PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString('en-IN')}
              </span>
              <div className="invoices-pagination__btns">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(p => p - 1)}
                >
                  Prev
                </button>
                <span className="invoices-pagination__page text-sm">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        <div className="panel glass invoices-table-panel admin-invoices-table-panel">
          <div className="invoices-table-wrap invoices-table-wrap--desktop">
            <table className="invoices-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th className="invoices-table__num">Qty</th>
                  <th className="invoices-table__num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(invoice => {
                  const locationLabel = formatAdminCustomerLocation(
                    customerLocations.get(invoice.customerId),
                  );
                  return (
                    <tr
                      key={`${invoice.customerId}-${invoice.id}`}
                      className="invoices-table__row--clickable"
                      onClick={() => openInvoice(invoice)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openInvoice(invoice);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`View invoice ${invoice.invoiceNumber || invoice.id}`}
                    >
                      <td>
                        <strong>{invoice.invoiceNumber || invoice.id}</strong>
                        {invoice.referenceNumber && (
                          <div className="invoices-table__ref text-muted text-sm">
                            Order {invoice.referenceNumber}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{invoice.customerName ?? '—'}</div>
                        {locationLabel && (
                          <div className="invoices-table__ref text-muted text-sm">{locationLabel}</div>
                        )}
                      </td>
                      <td>{formatInvoiceDate(invoice.date)}</td>
                      <td className="invoices-table__num">{formatInvoiceItemQuantity(invoice.itemQuantity)}</td>
                      <td className="invoices-table__num">{formatCurrency(invoice.total)}</td>
                      <td>
                        <span className={invoiceStatusClass(invoice.status)}>
                          {invoiceStatusLabel(invoice.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="invoices-mobile-list admin-invoices-mobile-list">
            <div className="invoices-mobile-list__head" aria-hidden>
              <span>Invoice</span>
              <span>Amount</span>
            </div>
            {pageRows.map(invoice => {
              const locationLabel = formatAdminCustomerLocation(
                customerLocations.get(invoice.customerId),
              );
              return (
                <button
                  key={`${invoice.customerId}-${invoice.id}`}
                  type="button"
                  className="invoices-mobile-row"
                  onClick={() => openInvoice(invoice)}
                  aria-label={`View invoice ${invoice.invoiceNumber || invoice.id}`}
                >
                  <span className="invoices-mobile-row__icon" aria-hidden>
                    <FileText size={16} strokeWidth={2.25} />
                  </span>
                  <span className="invoices-mobile-row__body">
                    <span className="invoices-mobile-row__invoice">
                      <strong>{invoice.invoiceNumber || invoice.id}</strong>
                      <span className="invoices-mobile-row__so">
                        {invoice.customerName ?? locationLabel ?? '—'}
                      </span>
                      <span className="invoices-mobile-row__meta">
                        {formatInvoiceDate(invoice.date)}
                        {' · '}
                        Qty {formatInvoiceItemQuantity(invoice.itemQuantity)}
                      </span>
                    </span>
                    <span className="invoices-mobile-row__amount">
                      <strong>{formatCurrency(invoice.total)}</strong>
                      <span className={invoiceStatusClass(invoice.status)}>
                        {invoiceStatusLabel(invoice.status)}
                      </span>
                    </span>
                  </span>
                  <span className="invoices-mobile-row__chevron" aria-hidden>
                    <ChevronRight size={18} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
          {totalPages > 1 && (
            <footer className="invoices-pagination invoices-pagination--sticky">
              <span className="invoices-pagination__info text-muted text-sm">
                {(page - 1) * LIST_PAGE_SIZE + 1}–{Math.min(page * LIST_PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString('en-IN')}
              </span>
              <div className="invoices-pagination__btns">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(p => p - 1)}
                >
                  Prev
                </button>
                <span className="invoices-pagination__page text-sm">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          )}
        </>
      )}

      <AdminFilterSheet
        open={filterOpen}
        rangePreset={rangePreset}
        sort={sort}
        onClose={() => setFilterOpen(false)}
        onApply={next => {
          setRangePreset(next.rangePreset);
          setSort(next.sort);
        }}
      />
    </div>
  );
};
