import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ClipboardList,
  IndianRupee,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  InvoiceCategoryBadge,
  InvoiceCategoryIcon,
} from '../../components/invoices/InvoiceCategoryVisual';
import { OrderStatusBadge } from '../../components/orders/OrderStatusBadge';
import { SalesOrderProgressChain } from '../../components/orders/SalesOrderProgressChain';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  subscribeAdminSalesOrders,
  type AdminFirestoreSalesOrder,
  type AdminSalesOrderSort,
} from '../../lib/admin-sales-orders';
import { formatCurrency } from '../../lib/catalog';
import { dealerOrderErrorMessage, listDealerOrders } from '../../lib/dealerOrders';
import {
  formatInvoiceDate,
  formatInvoiceItemQuantity,
  formatKpiPeriodRange,
  getInvoicePeriodBounds,
} from '../../lib/invoices';
import { useRevealScrollbarOnScroll } from '../../lib/useRevealScrollbarOnScroll';
import {
  countUnifiedStages,
  filterUnifiedSalesOrders,
  mergeUnifiedSalesOrders,
  summarizeUnifiedAmounts,
  UNIFIED_STATUS_CHIPS,
  type UnifiedSalesOrderRow,
  type UnifiedSalesOrderSource,
  type UnifiedStatusChip,
} from '../../lib/unified-sales-orders';
import type { DealerOrder } from '../../types/dealer-orders';
import type { InvoiceCategory, SalesRangePreset } from '../../types/invoices';
import { INVOICE_CATEGORY_FILTER_OPTIONS, SALES_RANGE_OPTIONS } from '../../types/invoices';

const ZOHO_PAGE_SIZE = 500;
const LIST_PAGE_SIZE = 25;
const DEFAULT_RANGE: SalesRangePreset = 'financial_year';
const DEFAULT_SORT: AdminSalesOrderSort = 'date';
const DEFAULT_CATEGORY: InvoiceCategory | 'all' = 'all';
const DEFAULT_SOURCE: UnifiedSalesOrderSource | 'all' = 'all';

const SORT_OPTIONS: Array<{ value: AdminSalesOrderSort; label: string }> = [
  { value: 'date', label: 'Date' },
  { value: 'syncedAt', label: 'Most recently updated' },
];

const SOURCE_OPTIONS: Array<{ value: UnifiedSalesOrderSource | 'all'; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'portal', label: 'Portal' },
  { value: 'zoho', label: 'Zoho' },
];

function UnifiedFilterSheet({
  open,
  rangePreset,
  category,
  sort,
  source,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  category: InvoiceCategory | 'all';
  sort: AdminSalesOrderSort;
  source: UnifiedSalesOrderSource | 'all';
  onClose: () => void;
  onApply: (next: {
    rangePreset: SalesRangePreset;
    category: InvoiceCategory | 'all';
    sort: AdminSalesOrderSort;
    source: UnifiedSalesOrderSource | 'all';
  }) => void;
}) {
  const [draftRange, setDraftRange] = useState(rangePreset);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftSort, setDraftSort] = useState(sort);
  const [draftSource, setDraftSource] = useState(source);

  useEffect(() => {
    if (!open) return;
    setDraftRange(rangePreset);
    setDraftCategory(category);
    setDraftSort(sort);
    setDraftSource(source);
  }, [open, rangePreset, category, sort, source]);

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
    || draftCategory !== DEFAULT_CATEGORY
    || draftSort !== DEFAULT_SORT
    || draftSource !== DEFAULT_SOURCE;

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
        aria-label="Filter sales orders"
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
              <span className="catalog-spares-multi-filters__label">Source</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Source">
                {SOURCE_OPTIONS.map(option => {
                  const id = `unified-so-source-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="unified-so-source"
                        checked={draftSource === option.value}
                        onChange={() => setDraftSource(option.value)}
                      />
                      <span className="catalog-spares-multi-filters__option-label">{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="catalog-spares-multi-filters__group">
              <span className="catalog-spares-multi-filters__label">Date range</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Date range">
                {SALES_RANGE_OPTIONS.map(option => {
                  const id = `unified-so-range-${String(option.value)}`;
                  return (
                    <label key={String(option.value)} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="unified-so-date-range"
                        checked={draftRange === option.value}
                        onChange={() => setDraftRange(option.value)}
                      />
                      <span className="catalog-spares-multi-filters__option-label">{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="catalog-spares-multi-filters__group">
              <span className="catalog-spares-multi-filters__label">Category (Zoho)</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Category">
                {INVOICE_CATEGORY_FILTER_OPTIONS.map(option => {
                  const id = `unified-so-category-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="unified-so-category"
                        checked={draftCategory === option.value}
                        onChange={() => setDraftCategory(option.value)}
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
                  const id = `unified-so-sort-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="unified-so-sort"
                        checked={draftSort === option.value}
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
                onApply({
                  rangePreset: draftRange,
                  category: draftCategory,
                  sort: draftSort,
                  source: draftSource,
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
                setDraftCategory(DEFAULT_CATEGORY);
                setDraftSort(DEFAULT_SORT);
                setDraftSource(DEFAULT_SOURCE);
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

function SourceBadge({ source }: { source: UnifiedSalesOrderSource }) {
  return (
    <span className={`unified-so-source unified-so-source--${source}`}>
      {source === 'portal' ? 'Portal' : 'Zoho'}
    </span>
  );
}

export const AdminUnifiedSalesOrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const dealerFilter = searchParams.get('dealerId')?.trim() || '';
  const { user } = useAuth();
  const basePath = pathname.startsWith('/staff') ? '/staff' : '/super-admin';
  const canSync = user?.role === 'super_admin';
  const scrollRef = useRevealScrollbarOnScroll();

  const [portalOrders, setPortalOrders] = useState<DealerOrder[]>([]);
  const [zohoOrders, setZohoOrders] = useState<AdminFirestoreSalesOrder[]>([]);
  const [portalLoading, setPortalLoading] = useState(true);
  const [zohoLoading, setZohoLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminSalesOrderSort>(DEFAULT_SORT);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [category, setCategory] = useState<InvoiceCategory | 'all'>(DEFAULT_CATEGORY);
  const [source, setSource] = useState<UnifiedSalesOrderSource | 'all'>(DEFAULT_SOURCE);
  const [statusChip, setStatusChip] = useState<UnifiedStatusChip>(
    dealerFilter ? 'all' : 'review',
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);

  const loadPortal = useCallback(() => {
    setPortalLoading(true);
    void listDealerOrders({
      limit: 200,
      ...(dealerFilter ? { dealerId: dealerFilter } : {}),
    })
      .then(rows => {
        setPortalOrders(rows);
        setError('');
      })
      .catch(err => setError(dealerOrderErrorMessage(err)))
      .finally(() => setPortalLoading(false));
  }, [dealerFilter]);

  useEffect(() => {
    loadPortal();
  }, [loadPortal]);

  useEffect(() => {
    setZohoLoading(true);
    setError('');
    const unsubscribe = subscribeAdminSalesOrders(
      sort,
      ZOHO_PAGE_SIZE,
      next => {
        setZohoOrders(next);
        setZohoLoading(false);
      },
      message => {
        setError(message);
        setZohoLoading(false);
      },
      category,
    );
    return () => unsubscribe();
  }, [sort, category]);

  const loading = portalLoading || zohoLoading;

  const merged = useMemo(
    () => mergeUnifiedSalesOrders(portalOrders, zohoOrders, basePath),
    [portalOrders, zohoOrders, basePath],
  );

  const filtered = useMemo(
    () => filterUnifiedSalesOrders(merged, {
      search,
      source,
      statusChip,
      category,
      period: rangePreset,
    }),
    [merged, search, source, statusChip, category, rangePreset],
  );

  useEffect(() => {
    setPage(1);
  }, [search, rangePreset, category, sort, source, statusChip, dealerFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * LIST_PAGE_SIZE;
    return filtered.slice(start, start + LIST_PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const stageCounts = useMemo(
    () => countUnifiedStages(merged),
    [merged],
  );

  const summary = useMemo(() => summarizeUnifiedAmounts(filtered), [filtered]);

  const bounds = getInvoicePeriodBounds(rangePreset);
  const dateRange = formatKpiPeriodRange(
    bounds?.start?.toISOString?.() ?? null,
    bounds?.end?.toISOString?.() ?? new Date().toISOString(),
  );

  const hasActiveFilters = rangePreset !== DEFAULT_RANGE
    || category !== DEFAULT_CATEGORY
    || sort !== DEFAULT_SORT
    || source !== DEFAULT_SOURCE;

  const openRow = (row: UnifiedSalesOrderRow) => {
    navigate(row.href);
  };

  const headerTools = useMemo(
    () => (
      <div className="invoices-header-tools">
        {canSync && (
          <Link
            to={`${basePath}/sales-orders/sync`}
            className="btn btn-secondary btn-sm"
            title="Sales order sync"
          >
            <RefreshCw size={14} />
            Sync
          </Link>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={loadPortal}
          disabled={loading}
          title="Refresh portal orders"
        >
          <RefreshCw size={14} />
        </button>
        <div className="catalog-search invoices-header-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search SO #, YES-ORD #, customer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search sales orders"
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
          aria-label="Filter sales orders"
          title="Filters"
        >
          <SlidersHorizontal size={20} strokeWidth={2.25} />
        </button>
      </div>
    ),
    [search, filterOpen, hasActiveFilters, canSync, basePath, loadPortal, loading],
  );

  useCatalogPageHeader({ mobileCompactHeader: true, title: 'Sales orders' }, true);
  usePageHeaderSlot(headerTools);

  return (
    <div className="page-content fade-in admin-invoices-page invoices-page unified-sales-orders-page">
      <section className="invoices-summary" aria-label="Sales order summary">
        <div className="invoices-summary__kpis">
          <div className="invoices-summary__kpi">
            <span className="invoices-summary__kpi-icon" aria-hidden>
              <ClipboardList size={16} strokeWidth={2.4} />
            </span>
            <div className="invoices-summary__kpi-body">
              <span className="invoices-summary__kpi-label">Total</span>
              <strong className="invoices-summary__kpi-value">
                {loading ? '…' : summary.count.toLocaleString('en-IN')}
              </strong>
              <span className="invoices-summary__kpi-sub">
                {loading ? '—' : dateRange}
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
                {loading
                  ? '…'
                  : summary.currencyCode
                    ? formatCurrency(summary.totalAmount, summary.currencyCode)
                    : filtered.length
                      ? 'Mixed currencies'
                      : formatCurrency(0)}
              </strong>
              <span className="invoices-summary__kpi-sub">Amount</span>
            </div>
          </div>
        </div>
      </section>

      {dealerFilter && (
        <p className="text-muted text-sm mb-3">Filtered to one dealer.</p>
      )}

      <div className="dealer-orders-tabs unified-so-tabs" role="tablist" aria-label="Order stage">
        {UNIFIED_STATUS_CHIPS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={statusChip === item.id}
            className={`dealer-orders-tabs__btn${statusChip === item.id ? ' is-active' : ''}`}
            onClick={() => setStatusChip(item.id)}
          >
            {item.label}
            <span>
              {item.id === 'all'
                ? (stageCounts.all ?? merged.length)
                : (stageCounts[item.id] ?? 0)}
            </span>
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="invoices-page__scroll">
        {error && (
          <div className="products-inline-error panel glass admin-invoices-error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {loading && filtered.length === 0 ? (
          <FetchingLoader label="Loading sales orders…" />
        ) : filtered.length === 0 ? (
          <div className="invoices-empty panel glass">
            <ClipboardList size={40} className="text-muted" aria-hidden />
            <p>No sales orders match these filters.</p>
            {canSync && (
              <Link to={`${basePath}/sales-orders/sync`} className="btn btn-primary mt-4">
                Open SO sync
              </Link>
            )}
          </div>
        ) : (
          <>
            {totalPages > 1 && (
              <div className="invoices-pagination invoices-pagination--top" role="navigation" aria-label="List pagination">
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
                      <th>Order</th>
                      <th>Party</th>
                      <th>Source</th>
                      <th>Date</th>
                      <th className="invoices-table__num">Qty</th>
                      <th className="invoices-table__num">Total</th>
                      <th>Category</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(row => (
                      <tr
                        key={row.key}
                        className="invoices-table__row--clickable"
                        onClick={() => openRow(row)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openRow(row);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`View ${row.primaryNumber}`}
                      >
                        <td>
                          <strong>{row.primaryNumber}</strong>
                        </td>
                        <td>{row.partyName}</td>
                        <td><SourceBadge source={row.source} /></td>
                        <td>{formatInvoiceDate(row.date)}</td>
                        <td className="invoices-table__num">{formatInvoiceItemQuantity(row.qty)}</td>
                        <td className="invoices-table__num">{formatCurrency(row.amount, row.currencyCode)}</td>
                        <td>
                          {row.category ? (
                            <InvoiceCategoryBadge category={row.category} />
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          {row.source === 'portal' ? (
                            <OrderStatusBadge status={row.statusRaw} />
                          ) : (
                            <span className={row.statusClass}>{row.statusLabel}</span>
                          )}
                          <SalesOrderProgressChain row={row} compact />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="invoices-mobile-list admin-invoices-mobile-list">
                {pageRows.map(row => (
                  <button
                    key={row.key}
                    type="button"
                    className="invoices-mobile-row invoices-mobile-row--po-stack unified-so-mobile-row"
                    onClick={() => openRow(row)}
                    aria-label={`View ${row.primaryNumber}`}
                  >
                    <span className="unified-so-mobile-row__lead">
                      <InvoiceCategoryIcon category={row.category} />
                      <span className="unified-so-mobile-row__badges">
                        <SourceBadge source={row.source} />
                        {row.category && <InvoiceCategoryBadge category={row.category} />}
                      </span>
                    </span>
                    <span className="invoices-mobile-row__body">
                      <span className="invoices-mobile-row__invoice">
                        <strong className="invoices-mobile-row__company">
                          {row.partyName}
                        </strong>
                        <span className="unified-so-mobile-row__progress">
                          <SalesOrderProgressChain row={row} compact />
                        </span>
                        <span className="invoices-mobile-row__pair unified-so-mobile-row__footer">
                          <span className="unified-so-mobile-row__meta">
                            <span className="invoices-mobile-row__po-num">{row.primaryNumber}</span>
                            <span className="unified-so-mobile-row__sep" aria-hidden>·</span>
                            <span>{formatInvoiceDate(row.date)}</span>
                          </span>
                          <strong className="invoices-mobile-row__amount-value">
                            {formatCurrency(row.amount, row.currencyCode)}
                          </strong>
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
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
      </div>

      <UnifiedFilterSheet
        open={filterOpen}
        rangePreset={rangePreset}
        category={category}
        sort={sort}
        source={source}
        onClose={() => setFilterOpen(false)}
        onApply={next => {
          setRangePreset(next.rangePreset);
          setCategory(next.category);
          setSort(next.sort);
          setSource(next.source);
        }}
      />
    </div>
  );
};
