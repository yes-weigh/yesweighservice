import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  FileText,
  IndianRupee,
  PackageCheck,
  Search,
  SlidersHorizontal,
  Truck,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import { formatCurrency } from '../../lib/catalog';
import { homePathForRole } from '../../types';
import {
  computeSalesForPeriod,
  countInvoiceSalesEntriesInPeriod,
  fetchDealerInvoiceDashboardWithCache,
  fetchDealerInvoicesWithCache,
  formatInvoiceDate,
  invoiceCategoryClassName,
  invoiceCategoryLabel,
  invoiceDeliveryLabel,
  getInvoiceDeliveryStage,
  invoiceErrorMessage,
  formatKpiPeriodRange,
  readCachedDealerInvoiceDashboard,
  readCachedDealerInvoices,
} from '../../lib/invoices';
import { useRevealScrollbarOnScroll } from '../../lib/useRevealScrollbarOnScroll';
import type { DealerInvoice, InvoiceDashboardSummary, InvoiceListParams, SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

type InvoiceSortField = NonNullable<InvoiceListParams['sortField']>;

const DEFAULT_RANGE: SalesRangePreset = 'current_month';
const DEFAULT_SORT_FIELD: InvoiceSortField = 'date';
const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

const SORT_OPTIONS: Array<{ value: InvoiceSortField; label: string }> = [
  { value: 'date', label: 'Invoice date' },
  { value: 'invoiceNumber', label: 'Invoice number' },
  { value: 'total', label: 'Total amount' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'balance', label: 'Balance' },
];

function InvoiceSearch({
  value,
  onChange,
  compactPlaceholder = false,
}: {
  value: string;
  onChange: (value: string) => void;
  compactPlaceholder?: boolean;
}) {
  return (
    <div className="catalog-search invoices-header-search">
      <Search size={15} aria-hidden />
      <input
        type="search"
        placeholder={compactPlaceholder ? 'Search invoices, SO…' : 'Search invoices, serial numbers, SO…'}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label="Search invoices and serial numbers"
      />
      {value && (
        <button
          type="button"
          className="invoices-header-search__clear"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function InvoiceDeliveryBadge({ date }: { date: string | null | undefined }) {
  const stage = getInvoiceDeliveryStage(date);
  const Icon = stage === 'delivered' ? PackageCheck : Truck;
  return (
    <span className={`invoices-delivery invoices-delivery--${stage}`}>
      <Icon size={12} strokeWidth={2.25} aria-hidden />
      {invoiceDeliveryLabel(stage)}
    </span>
  );
}

function InvoiceFilterSheet({
  open,
  rangePreset,
  sortField,
  sortDir,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  sortField: InvoiceSortField;
  sortDir: 'asc' | 'desc';
  onClose: () => void;
  onApply: (next: {
    rangePreset: SalesRangePreset;
    sortField: InvoiceSortField;
    sortDir: 'asc' | 'desc';
  }) => void;
}) {
  const [draftRange, setDraftRange] = useState(rangePreset);
  const [draftSortField, setDraftSortField] = useState(sortField);
  const [draftSortDir, setDraftSortDir] = useState(sortDir);

  useEffect(() => {
    if (!open) return;
    setDraftRange(rangePreset);
    setDraftSortField(sortField);
    setDraftSortDir(sortDir);
  }, [open, rangePreset, sortField, sortDir]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const draftDirty = draftRange !== DEFAULT_RANGE
    || draftSortField !== DEFAULT_SORT_FIELD
    || draftSortDir !== DEFAULT_SORT_DIR;

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
                  const id = `invoice-range-${String(option.value)}`;
                  return (
                    <label key={String(option.value)} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="invoice-date-range"
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
                  const checked = draftSortField === option.value;
                  const id = `invoice-sort-${option.value}`;
                  return (
                    <label
                      key={option.value}
                      className="catalog-spares-multi-filters__option"
                      htmlFor={id}
                      onClick={event => {
                        event.preventDefault();
                        if (checked) {
                          setDraftSortDir(prev => (prev === 'desc' ? 'asc' : 'desc'));
                        } else {
                          setDraftSortField(option.value);
                          setDraftSortDir(DEFAULT_SORT_DIR);
                        }
                      }}
                    >
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="invoice-sort"
                        checked={checked}
                        readOnly
                      />
                      <span className="catalog-spares-multi-filters__option-label">
                        {option.label}
                        {checked ? (draftSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </span>
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
                onApply({
                  rangePreset: draftRange,
                  sortField: draftSortField,
                  sortDir: draftSortDir,
                });
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
                setDraftSortField(DEFAULT_SORT_FIELD);
                setDraftSortDir(DEFAULT_SORT_DIR);
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

function InvoiceMobileRow({ invoice, onOpen }: { invoice: DealerInvoice; onOpen: (id: string) => void }) {
  const categoryLabel = invoiceCategoryLabel(invoice.invoiceCategory);
  return (
    <button
      type="button"
      className="invoices-mobile-row"
      onClick={() => onOpen(invoice.id)}
      aria-label={`View invoice ${invoice.invoiceNumber || invoice.id}`}
    >
      <span className="invoices-mobile-row__icon" aria-hidden>
        <FileText size={16} strokeWidth={2.25} />
      </span>
      <span className="invoices-mobile-row__body">
        <span className="invoices-mobile-row__invoice">
          <strong>{invoice.invoiceNumber || '—'}</strong>
          {invoice.referenceNumber && (
            <span className="invoices-mobile-row__so">{invoice.referenceNumber}</span>
          )}
          <span className="invoices-mobile-row__meta">{formatInvoiceDate(invoice.date)}</span>
          {categoryLabel && (
            <span className={invoiceCategoryClassName(invoice.invoiceCategory)}>
              {categoryLabel}
            </span>
          )}
        </span>
        <span className="invoices-mobile-row__amount">
          <strong>{formatCurrency(invoice.total)}</strong>
          <InvoiceDeliveryBadge date={invoice.date} />
        </span>
      </span>
      <span className="invoices-mobile-row__chevron" aria-hidden>
        <ChevronRight size={18} />
      </span>
    </button>
  );
}

function InvoicePagination({
  page,
  totalPages,
  total,
  limit,
  loading,
  onPageChange,
  sticky = false,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  loading: boolean;
  onPageChange: (updater: (current: number) => number) => void;
  sticky?: boolean;
}) {
  const className = `invoices-pagination${sticky ? ' invoices-pagination--sticky' : ' invoices-pagination--top'}`;
  const content = (
    <>
      <span className="invoices-pagination__info text-muted text-sm">
        {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total.toLocaleString('en-IN')}
      </span>
      <div className="invoices-pagination__btns">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(p => p - 1)}
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
          onClick={() => onPageChange(p => p + 1)}
        >
          Next
        </button>
      </div>
    </>
  );

  if (sticky) {
    return <footer className={className}>{content}</footer>;
  }

  return <div className={className} role="navigation" aria-label="Invoice list pagination">{content}</div>;
}

export const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user ? homePathForRole(user.role) : '/dealer';
  const scrollRef = useRevealScrollbarOnScroll();
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [sortField, setSortField] = useState<InvoiceSortField>(DEFAULT_SORT_FIELD);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(DEFAULT_SORT_DIR);
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const limit = 25;

  const [invoices, setInvoices] = useState<DealerInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState<InvoiceDashboardSummary | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);

  const openInvoice = (id: string) => navigate(`${basePath}/invoices/${id}/invoice`);

  const queryParams = useMemo((): InvoiceListParams => ({
    page,
    limit,
    sortField,
    sortDir,
    ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
  }), [page, debouncedSearch, sortField, sortDir]);

  const loadInvoices = useCallback(async () => {
    const uid = user?.uid;
    let usedCache = false;

    if (uid) {
      const cached = readCachedDealerInvoices(uid, queryParams);
      if (cached) {
        setInvoices(cached.data);
        setTotal(cached.pagination.total);
        setLoading(false);
        usedCache = true;
      } else {
        setLoading(true);
      }
    } else {
      setLoading(true);
    }

    if (!usedCache) setError('');

    try {
      const res = await fetchDealerInvoicesWithCache(uid, queryParams);
      setInvoices(res.data);
      setTotal(res.pagination.total);
      setError('');
    } catch (err) {
      if (!usedCache) {
        setError(invoiceErrorMessage(err));
        setInvoices([]);
        setTotal(0);
      } else {
        setError('Could not refresh. Showing saved invoices.');
      }
    } finally {
      setLoading(false);
    }
  }, [queryParams, user?.uid]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    const uid = user?.uid;
    let cancelled = false;
    let usedCache = false;

    const cached = readCachedDealerInvoiceDashboard(uid);
    if (cached) {
      setDashboard(cached);
      setKpiLoading(false);
      usedCache = true;
    } else {
      setKpiLoading(true);
    }

    void fetchDealerInvoiceDashboardWithCache(uid)
      .then(data => {
        if (!cancelled) setDashboard(data);
      })
      .catch(() => {
        if (!cancelled && !usedCache) setDashboard(null);
      })
      .finally(() => {
        if (!cancelled) setKpiLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sortField, sortDir]);

  const handleSort = (field: InvoiceSortField) => {
    if (sortField === field) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'invoiceNumber' ? 'asc' : 'desc');
    }
  };

  const SortMark = ({ field }: { field: InvoiceSortField }) => (
    <span className="invoices-sort-mark">{sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const showInitialLoader = loading && invoices.length === 0;
  const showList = !showInitialLoader && invoices.length > 0;

  const kpiSummary = useMemo(() => {
    if (!dashboard) {
      return {
        totalSales: 0,
        periodStart: null as string | null,
        periodEnd: new Date().toISOString(),
        invoiceCount: 0,
      };
    }

    if (dashboard.salesEntries?.length) {
      const sales = computeSalesForPeriod(dashboard.salesEntries, rangePreset);
      return {
        totalSales: sales.totalSales,
        periodStart: sales.periodStart,
        periodEnd: sales.periodEnd,
        invoiceCount: countInvoiceSalesEntriesInPeriod(dashboard.salesEntries, rangePreset),
      };
    }

    return {
      totalSales: dashboard.totalSales,
      periodStart: dashboard.periodStart,
      periodEnd: dashboard.periodEnd,
      invoiceCount: dashboard.totalInvoiceCount,
    };
  }, [dashboard, rangePreset]);

  const kpiDateRange = formatKpiPeriodRange(kpiSummary.periodStart, kpiSummary.periodEnd);
  const hasActiveFilters = rangePreset !== DEFAULT_RANGE
    || sortField !== DEFAULT_SORT_FIELD
    || sortDir !== DEFAULT_SORT_DIR;

  const headerSearch = useMemo(
    () => (
      <div className="invoices-header-tools">
        <InvoiceSearch
          value={searchTerm}
          onChange={setSearchTerm}
          compactPlaceholder
        />
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
    [searchTerm, filterOpen, hasActiveFilters],
  );

  useCatalogPageHeader({ mobileCompactHeader: true }, true);
  usePageHeaderSlot(headerSearch);

  const summaryBlock = (
    <section className="invoices-summary" aria-label="Invoice summary">
      <div className="invoices-summary__kpis">
        <div className="invoices-summary__kpi">
          <span className="invoices-summary__kpi-icon" aria-hidden>
            <FileText size={16} strokeWidth={2.4} />
          </span>
          <div className="invoices-summary__kpi-body">
            <span className="invoices-summary__kpi-label">Total Invoices</span>
            <strong className="invoices-summary__kpi-value">
              {kpiLoading ? '…' : kpiSummary.invoiceCount.toLocaleString('en-IN')}
            </strong>
            <span className="invoices-summary__kpi-sub">
              {kpiLoading ? '—' : kpiDateRange}
            </span>
          </div>
        </div>
        <div className="invoices-summary__divider" aria-hidden />
        <div className="invoices-summary__kpi">
          <span className="invoices-summary__kpi-icon" aria-hidden>
            <IndianRupee size={16} strokeWidth={2.4} />
          </span>
          <div className="invoices-summary__kpi-body">
            <span className="invoices-summary__kpi-label">Total Amount</span>
            <strong className="invoices-summary__kpi-value invoices-summary__kpi-value--amount">
              {kpiLoading ? '…' : formatCurrency(kpiSummary.totalSales)}
            </strong>
            <span className="invoices-summary__kpi-sub">Amount</span>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="page-content fade-in invoices-page">
      {summaryBlock}

      <div ref={scrollRef} className="invoices-page__scroll invoices-page__body">
      {error && (
        <div className="products-inline-error panel glass invoices-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

        {showInitialLoader ? (
          <FetchingLoader label="Loading invoices…" />
        ) : invoices.length === 0 ? (
          <div className="invoices-empty panel glass">
            <FileText size={36} aria-hidden />
            <h2>No invoices found</h2>
            <p className="text-muted text-sm">
              {debouncedSearch
                ? 'Try a different search term.'
                : 'No invoices are available for your account yet.'}
            </p>
          </div>
        ) : (
          <>
            {showList && totalPages > 1 && (
              <InvoicePagination
                page={page}
                totalPages={totalPages}
                total={total}
                limit={limit}
                loading={loading}
                onPageChange={setPage}
              />
            )}

            <div
              className={`invoices-list ${loading ? 'invoices-list--loading' : ''}`}
              aria-busy={loading}
            >
              <div className="invoices-table-panel panel glass invoices-table-wrap--desktop">
                <div className="invoices-table-wrap">
                  <table className="invoices-table">
                    <thead>
                      <tr>
                        <th>
                          <button type="button" onClick={() => handleSort('invoiceNumber')}>
                            Invoice <SortMark field="invoiceNumber" />
                          </button>
                        </th>
                        <th>
                          <button type="button" onClick={() => handleSort('date')}>
                            Date <SortMark field="date" />
                          </button>
                        </th>
                        <th>
                          <button type="button" onClick={() => handleSort('dueDate')}>
                            Due <SortMark field="dueDate" />
                          </button>
                        </th>
                        <th>Category</th>
                        <th>Delivery</th>
                        <th className="invoices-table__num">
                          <button type="button" onClick={() => handleSort('total')}>
                            Total <SortMark field="total" />
                          </button>
                        </th>
                        <th className="invoices-table__num">
                          <button type="button" onClick={() => handleSort('balance')}>
                            Balance <SortMark field="balance" />
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map(invoice => {
                        const categoryLabel = invoiceCategoryLabel(invoice.invoiceCategory);
                        return (
                        <tr
                          key={invoice.id}
                          className="invoices-table__row--clickable"
                          onClick={() => openInvoice(invoice.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openInvoice(invoice.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`View invoice ${invoice.invoiceNumber || invoice.id}`}
                        >
                          <td>
                            <strong>{invoice.invoiceNumber || '—'}</strong>
                            {invoice.referenceNumber && (
                              <span className="invoices-table__ref text-muted text-sm">
                                {invoice.referenceNumber}
                              </span>
                            )}
                          </td>
                          <td>{formatInvoiceDate(invoice.date)}</td>
                          <td>{formatInvoiceDate(invoice.dueDate)}</td>
                          <td>
                            {categoryLabel ? (
                              <span className={invoiceCategoryClassName(invoice.invoiceCategory)}>
                                {categoryLabel}
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td><InvoiceDeliveryBadge date={invoice.date} /></td>
                          <td className="invoices-table__num">{formatCurrency(invoice.total)}</td>
                          <td className="invoices-table__num">{formatCurrency(invoice.balance)}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="invoices-mobile-list">
                <div className="invoices-mobile-list__head" aria-hidden>
                  <span>Invoice</span>
                  <span>Amount</span>
                </div>
                {invoices.map(invoice => (
                  <InvoiceMobileRow key={invoice.id} invoice={invoice} onOpen={openInvoice} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {showList && totalPages > 1 && (
        <InvoicePagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          loading={loading}
          onPageChange={setPage}
          sticky
        />
      )}

      <InvoiceFilterSheet
        open={filterOpen}
        rangePreset={rangePreset}
        sortField={sortField}
        sortDir={sortDir}
        onClose={() => setFilterOpen(false)}
        onApply={next => {
          setRangePreset(next.rangePreset);
          setSortField(next.sortField);
          setSortDir(next.sortDir);
        }}
      />
    </div>
  );
};
