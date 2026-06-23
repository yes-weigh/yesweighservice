import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, FileText, IndianRupee, PackageCheck, Search, Truck, X } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { SalesRangeSelect } from '../../components/dashboard/SalesRangeSelect';
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
  formatInvoiceRelativeTime,
  formatKpiPeriodRange,
  getInvoiceDeliveryStage,
  invoiceDeliveryLabel,
  invoiceErrorMessage,
  readCachedDealerInvoiceDashboard,
  readCachedDealerInvoices,
} from '../../lib/invoices';
import type { DealerInvoice, InvoiceDashboardSummary, InvoiceListParams, SalesRangePreset } from '../../types/invoices';

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
      <Icon size={14} strokeWidth={2.25} aria-hidden />
      {invoiceDeliveryLabel(stage)}
    </span>
  );
}

function InvoiceMobileCard({ invoice, onOpen }: { invoice: DealerInvoice; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      className="invoices-card invoices-card--link panel glass"
      onClick={() => onOpen(invoice.id)}
    >
      <div className="invoices-card__main">
        <div className="invoices-card__row">
          <strong className="invoices-card__number">{invoice.invoiceNumber || '—'}</strong>
          <span className="invoices-card__total">{formatCurrency(invoice.total)}</span>
        </div>
        <div className="invoices-card__row invoices-card__row--meta">
          <div className="invoices-card__meta">
            <span className="invoices-card__date">{formatInvoiceDate(invoice.date)}</span>
            {invoice.referenceNumber && (
              <span className="invoices-card__so">{invoice.referenceNumber}</span>
            )}
          </div>
          <InvoiceDeliveryBadge date={invoice.date} />
        </div>
      </div>
      <span className="invoices-card__chevron" aria-hidden>
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
          {page}/{totalPages}
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
  const [sortField, setSortField] = useState<NonNullable<InvoiceListParams['sortField']>>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const limit = 25;

  const [invoices, setInvoices] = useState<DealerInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
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
        setLastSyncedAt(cached.lastSyncedAt ?? null);
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
      setLastSyncedAt(res.lastSyncedAt ?? null);
      setError('');
    } catch (err) {
      if (!usedCache) {
        setError(invoiceErrorMessage(err));
        setInvoices([]);
        setTotal(0);
        setLastSyncedAt(null);
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

  const handleSort = (field: NonNullable<InvoiceListParams['sortField']>) => {
    if (sortField === field) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'invoiceNumber' ? 'asc' : 'desc');
    }
  };

  const SortMark = ({ field }: { field: NonNullable<InvoiceListParams['sortField']> }) => (
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
        unpaidCount: 0,
        outstanding: 0,
      };
    }

    if (dashboard.salesEntries?.length) {
      const sales = computeSalesForPeriod(dashboard.salesEntries, rangePreset);
      return {
        totalSales: sales.totalSales,
        periodStart: sales.periodStart,
        periodEnd: sales.periodEnd,
        invoiceCount: countInvoiceSalesEntriesInPeriod(dashboard.salesEntries, rangePreset),
        unpaidCount: dashboard.unpaidCount,
        outstanding: dashboard.outstandingBalance,
      };
    }

    return {
      totalSales: dashboard.totalSales,
      periodStart: dashboard.periodStart,
      periodEnd: dashboard.periodEnd,
      invoiceCount: dashboard.totalInvoiceCount,
      unpaidCount: dashboard.unpaidCount,
      outstanding: dashboard.outstandingBalance,
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

  return (
    <div className="page-content fade-in invoices-page">
      {error && (
        <div className="products-inline-error panel glass invoices-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="dealer-dash__kpis-layout admin-invoices-kpis invoices-page-kpis" aria-label="Invoice summary">
        <div className="dealer-dash-kpi dealer-dash-kpi--blue dealer-dash-kpi--featured admin-invoices-kpi--featured">
          <div className="dealer-dash-kpi__featured-main">
            <div className="dealer-dash-kpi__icon dealer-dash-kpi__icon--featured">
              <IndianRupee strokeWidth={2.5} />
            </div>
            <div className="dealer-dash-kpi__body dealer-dash-kpi__body--featured">
              <span className="dealer-dash-kpi__label">Total sales</span>
              <SalesRangeSelect value={rangePreset} onChange={setRangePreset} />
              <span className="admin-invoices-kpi__range text-muted text-sm">{kpiDateRange}</span>
            </div>
          </div>
          <strong className="dealer-dash-kpi__value dealer-dash-kpi__value--featured">
            {kpiLoading ? '…' : formatCurrency(kpiSummary.totalSales)}
          </strong>
        </div>

        <div className="dealer-dash__kpis-grid admin-invoices-kpis__grid">
          <div className="dealer-dash-kpi dealer-dash-kpi--blue admin-invoices-kpi--static">
            <div className="dealer-dash-kpi__icon"><FileText size={22} strokeWidth={2.5} /></div>
            <div className="dealer-dash-kpi__body">
              <span className="dealer-dash-kpi__label">Invoices</span>
              <strong className="dealer-dash-kpi__value">
                {kpiLoading ? '…' : kpiSummary.invoiceCount.toLocaleString('en-IN')}
              </strong>
              <span className="dealer-dash-kpi__trend dealer-dash-kpi__trend--up">In selected period</span>
            </div>
          </div>
          <div className="dealer-dash-kpi dealer-dash-kpi--orange admin-invoices-kpi--static">
            <div className="dealer-dash-kpi__icon"><FileText size={22} strokeWidth={2.5} /></div>
            <div className="dealer-dash-kpi__body">
              <span className="dealer-dash-kpi__label">Unpaid</span>
              <strong className="dealer-dash-kpi__value">
                {kpiLoading ? '…' : kpiSummary.unpaidCount.toLocaleString('en-IN')}
              </strong>
              <span className="dealer-dash-kpi__trend dealer-dash-kpi__trend--up">All invoices</span>
            </div>
          </div>
          <div className="dealer-dash-kpi dealer-dash-kpi--green admin-invoices-kpi--static">
            <div className="dealer-dash-kpi__icon"><IndianRupee size={22} strokeWidth={2.5} /></div>
            <div className="dealer-dash-kpi__body">
              <span className="dealer-dash-kpi__label">Outstanding</span>
              <strong className="dealer-dash-kpi__value">
                {kpiLoading ? '…' : formatCurrency(kpiSummary.outstanding)}
              </strong>
              <span className="dealer-dash-kpi__trend dealer-dash-kpi__trend--up">Balance due</span>
            </div>
          </div>
        </div>
      </section>

      <header className="invoices-toolbar invoices-toolbar--sticky">
        <div className="invoices-toolbar__filters">
          <span className="invoices-toolbar__count" aria-live="polite">
            {loading && invoices.length === 0
              ? 'Loading…'
              : total > 0
                ? `${total.toLocaleString('en-IN')} invoices`
                : 'No invoices'}
          </span>
          {lastSyncedAt && (
            <span className="invoices-toolbar__sync text-muted text-sm">
              Updated {formatInvoiceRelativeTime(lastSyncedAt)}
            </span>
          )}
        </div>
      </header>

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

              <div className="invoices-cards invoices-cards--mobile">
                {invoices.map(invoice => (
                  <InvoiceMobileCard key={invoice.id} invoice={invoice} onOpen={openInvoice} />
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
    </div>
  );
};
