import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
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
import { usePageHeaderSlot } from '../../context/PageHeaderContext';
import { formatCurrency } from '../../lib/catalog';
import { homePathForRole } from '../../types';
import {
  computeSalesForPeriod,
  countInvoiceSalesEntriesInPeriod,
  fetchDealerInvoiceDashboardWithCache,
  fetchDealerInvoicesWithCache,
  formatInvoiceDate,
  invoiceDeliveryLabel,
  getInvoiceDeliveryStage,
  invoiceErrorMessage,
  formatKpiPeriodRange,
  readCachedDealerInvoiceDashboard,
  readCachedDealerInvoices,
} from '../../lib/invoices';
import type { DealerInvoice, InvoiceDashboardSummary, InvoiceListParams, SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

type InvoiceSortField = NonNullable<InvoiceListParams['sortField']>;

const SORT_OPTIONS: Array<{ value: InvoiceSortField; label: string }> = [
  { value: 'date', label: 'Invoice date' },
  { value: 'invoiceNumber', label: 'Invoice number' },
  { value: 'total', label: 'Total amount' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'balance', label: 'Balance' },
];

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= breakpoint);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return isMobile;
}

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

function InvoiceDateRangeControl({
  value,
  onChange,
  rangeLabel,
}: {
  value: SalesRangePreset;
  onChange: (value: SalesRangePreset) => void;
  rangeLabel: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div className={`invoices-date-range${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="invoices-date-range__trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Date range"
      >
        <CalendarDays size={16} aria-hidden />
        <span className="invoices-date-range__copy">
          <span className="invoices-date-range__label">Date Range</span>
          <span className="invoices-date-range__value">{rangeLabel}</span>
        </span>
        <ChevronDown size={16} className="invoices-date-range__chevron" aria-hidden />
      </button>

      {open && createPortal(
        <div className="invoices-filter-sheet" role="dialog" aria-modal="true" aria-label="Date range">
          <button
            type="button"
            className="invoices-filter-sheet__backdrop"
            aria-label="Close date range"
            onClick={() => setOpen(false)}
          />
          <div className="invoices-filter-sheet__panel panel glass">
            <header className="invoices-filter-sheet__header">
              <h3 className="invoices-filter-sheet__title">Date Range</h3>
              <button type="button" className="invoices-filter-sheet__close" onClick={() => setOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </header>
            <section className="invoices-filter-sheet__section">
              <div className="invoices-filter-sheet__options" role="listbox" aria-label="Date range options">
                {SALES_RANGE_OPTIONS.map(option => {
                  const isActive = option.value === value;
                  return (
                    <button
                      key={String(option.value)}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`invoices-filter-sheet__option${isActive ? ' is-active' : ''}`}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function InvoiceFilterSheet({
  open,
  sortField,
  sortDir,
  onClose,
  onSortChange,
}: {
  open: boolean;
  sortField: InvoiceSortField;
  sortDir: 'asc' | 'desc';
  onClose: () => void;
  onSortChange: (field: InvoiceSortField, dir: 'asc' | 'desc') => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="invoices-filter-sheet" role="dialog" aria-modal="true" aria-label="Filter invoices">
      <button type="button" className="invoices-filter-sheet__backdrop" aria-label="Close filters" onClick={onClose} />
      <div className="invoices-filter-sheet__panel panel glass">
        <header className="invoices-filter-sheet__header">
          <h3 className="invoices-filter-sheet__title">Filter</h3>
          <button type="button" className="invoices-filter-sheet__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <section className="invoices-filter-sheet__section">
          <h4 className="invoices-filter-sheet__section-title">Sort by</h4>
          <div className="invoices-filter-sheet__options">
            {SORT_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={`invoices-filter-sheet__option${sortField === option.value ? ' is-active' : ''}`}
                onClick={() => onSortChange(option.value, sortField === option.value && sortDir === 'desc' ? 'asc' : 'desc')}
              >
                {option.label}
                {sortField === option.value ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
          </div>
        </section>

        <footer className="invoices-filter-sheet__footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function InvoiceMobileRow({ invoice, onOpen }: { invoice: DealerInvoice; onOpen: (id: string) => void }) {
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
  const className = `invoices-pagination panel glass${sticky ? ' invoices-pagination--sticky' : ' invoices-pagination--top'}`;
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
  const isMobile = useIsMobile();
  const basePath = user ? homePathForRole(user.role) : '/dealer';
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [sortField, setSortField] = useState<InvoiceSortField>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const limit = 25;

  const [invoices, setInvoices] = useState<DealerInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState<InvoiceDashboardSummary | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>('current_month');

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

  const headerSearch = useMemo(
    () => (
      <InvoiceSearch
        value={searchTerm}
        onChange={setSearchTerm}
        compactPlaceholder={isMobile}
      />
    ),
    [searchTerm, isMobile],
  );

  usePageHeaderSlot(headerSearch);

  const summaryBlock = (
    <section className="invoices-summary" aria-label="Invoice summary">
      <div className="invoices-summary__kpis">
        <div className="invoices-summary__kpi">
          <span className="invoices-summary__kpi-icon" aria-hidden>
            <FileText size={18} strokeWidth={2.4} />
          </span>
          <span className="invoices-summary__kpi-label">Total Invoices</span>
          <strong className="invoices-summary__kpi-value">
            {kpiLoading ? '…' : kpiSummary.invoiceCount.toLocaleString('en-IN')}
          </strong>
          <span className="invoices-summary__kpi-sub">Invoices</span>
        </div>
        <div className="invoices-summary__divider" aria-hidden />
        <div className="invoices-summary__kpi">
          <span className="invoices-summary__kpi-icon" aria-hidden>
            <IndianRupee size={18} strokeWidth={2.4} />
          </span>
          <span className="invoices-summary__kpi-label">Total Amount</span>
          <strong className="invoices-summary__kpi-value invoices-summary__kpi-value--amount">
            {kpiLoading ? '…' : formatCurrency(kpiSummary.totalSales)}
          </strong>
          <span className="invoices-summary__kpi-sub">Amount</span>
        </div>
      </div>

      <div className="invoices-summary__controls">
        <InvoiceDateRangeControl
          value={rangePreset}
          onChange={setRangePreset}
          rangeLabel={kpiDateRange}
        />
        <button
          type="button"
          className="invoices-summary__filter-btn"
          onClick={() => setFilterOpen(true)}
        >
          <SlidersHorizontal size={15} aria-hidden />
          Filter
        </button>
      </div>
    </section>
  );

  return (
    <div className="page-content fade-in invoices-page">
      {error && (
        <div className="products-inline-error panel glass invoices-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {summaryBlock}

      <div className="invoices-page__body">
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
                      {invoices.map(invoice => (
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
                          <td><InvoiceDeliveryBadge date={invoice.date} /></td>
                          <td className="invoices-table__num">{formatCurrency(invoice.total)}</td>
                          <td className="invoices-table__num">{formatCurrency(invoice.balance)}</td>
                        </tr>
                      ))}
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
        sortField={sortField}
        sortDir={sortDir}
        onClose={() => setFilterOpen(false)}
        onSortChange={(field, dir) => {
          setSortField(field);
          setSortDir(dir);
        }}
      />
    </div>
  );
};
