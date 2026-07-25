import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  ClipboardList,
  IndianRupee,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  InvoiceCategoryBadge,
  InvoiceCategoryIcon,
} from '../../components/invoices/InvoiceCategoryVisual';
import { OrderStatusBadge } from '../../components/orders/OrderStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import type { AdminFirestoreSalesOrder } from '../../lib/admin-sales-orders';
import { formatCurrency } from '../../lib/catalog';
import { listDealerSalesOrders } from '../../lib/dealer-sales-orders';
import { dealerOrderErrorMessage, listDealerOrders } from '../../lib/dealerOrders';
import {
  formatInvoiceDate,
  formatInvoiceItemQuantity,
  formatKpiPeriodRange,
  getInvoicePeriodBounds,
  invoiceErrorMessage,
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
import { homePathForRole } from '../../types';
import type { DealerOrder } from '../../types/dealer-orders';
import type { InvoiceCategory, SalesRangePreset } from '../../types/invoices';
import { INVOICE_CATEGORY_FILTER_OPTIONS, SALES_RANGE_OPTIONS } from '../../types/invoices';

const LIST_PAGE_SIZE = 25;
const DEFAULT_RANGE: SalesRangePreset = 'financial_year';
const DEFAULT_CATEGORY: InvoiceCategory | 'all' = 'all';
const DEFAULT_SOURCE: UnifiedSalesOrderSource | 'all' = 'all';

const SOURCE_OPTIONS: Array<{ value: UnifiedSalesOrderSource | 'all'; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'portal', label: 'Portal' },
  { value: 'zoho', label: 'Zoho' },
];

function SourceBadge({ source }: { source: UnifiedSalesOrderSource }) {
  return (
    <span className={`unified-so-source unified-so-source--${source}`}>
      {source === 'portal' ? 'Portal' : 'Zoho'}
    </span>
  );
}

function DealerFilterSheet({
  open,
  rangePreset,
  category,
  source,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  category: InvoiceCategory | 'all';
  source: UnifiedSalesOrderSource | 'all';
  onClose: () => void;
  onApply: (next: {
    rangePreset: SalesRangePreset;
    category: InvoiceCategory | 'all';
    source: UnifiedSalesOrderSource | 'all';
  }) => void;
}) {
  const [draftRange, setDraftRange] = useState(rangePreset);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftSource, setDraftSource] = useState(source);

  useEffect(() => {
    if (!open) return;
    setDraftRange(rangePreset);
    setDraftCategory(category);
    setDraftSource(source);
  }, [open, rangePreset, category, source]);

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
            <button
              type="button"
              className="catalog-spares-multi-filters__close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="catalog-spares-multi-filters__body">
            <div className="catalog-spares-multi-filters__group">
              <span className="catalog-spares-multi-filters__label">Source</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Source">
                {SOURCE_OPTIONS.map(option => {
                  const id = `dealer-so-source-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="dealer-so-source"
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
                  const id = `dealer-so-range-${String(option.value)}`;
                  return (
                    <label key={String(option.value)} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="dealer-so-date-range"
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
              <span className="catalog-spares-multi-filters__label">Category</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Category">
                {INVOICE_CATEGORY_FILTER_OPTIONS.map(option => {
                  const id = `dealer-so-category-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="dealer-so-category"
                        checked={draftCategory === option.value}
                        onChange={() => setDraftCategory(option.value)}
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

export const DealerSalesOrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user ? homePathForRole(user.role) : '/dealer';
  const scrollRef = useRevealScrollbarOnScroll();

  const [portalOrders, setPortalOrders] = useState<DealerOrder[]>([]);
  const [zohoOrders, setZohoOrders] = useState<AdminFirestoreSalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [category, setCategory] = useState<InvoiceCategory | 'all'>(DEFAULT_CATEGORY);
  const [source, setSource] = useState<UnifiedSalesOrderSource | 'all'>(DEFAULT_SOURCE);
  const [statusChip, setStatusChip] = useState<UnifiedStatusChip>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    void Promise.allSettled([
      listDealerOrders({ limit: 200 }),
      listDealerSalesOrders({ limit: 300 }),
    ])
      .then(([portalResult, zohoResult]) => {
        const messages: string[] = [];
        if (portalResult.status === 'fulfilled') {
          setPortalOrders(portalResult.value);
        } else {
          setPortalOrders([]);
          messages.push(
            portalResult.reason instanceof Error
              ? portalResult.reason.message
              : dealerOrderErrorMessage(portalResult.reason),
          );
        }
        if (zohoResult.status === 'fulfilled') {
          setZohoOrders(zohoResult.value);
        } else {
          setZohoOrders([]);
          // Missing Zoho customer link should not block portal orders.
          const zohoMessage = zohoResult.reason instanceof Error
            ? zohoResult.reason.message
            : invoiceErrorMessage(zohoResult.reason);
          const unlinked = /not linked to a zoho customer|no zoho customer is linked/i.test(
            zohoMessage,
          );
          if (!unlinked) {
            messages.push(zohoMessage);
          }
        }
        setError(messages[0] ?? '');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const merged = useMemo(
    () => mergeUnifiedSalesOrders(portalOrders, zohoOrders, basePath, {
      includePortalDuplicates: false,
    }),
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

  const stageCounts = useMemo(() => {
    const inPeriod = filterUnifiedSalesOrders(merged, {
      search: '',
      source,
      statusChip: 'all',
      category,
      period: rangePreset,
    });
    return countUnifiedStages(inPeriod);
  }, [merged, source, category, rangePreset]);

  useEffect(() => {
    setPage(1);
  }, [search, rangePreset, category, source, statusChip]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * LIST_PAGE_SIZE;
    return filtered.slice(start, start + LIST_PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const summary = useMemo(() => {
    const amounts = summarizeUnifiedAmounts(filtered);
    return {
      count: filtered.length,
      totalAmount: amounts.totalAmount,
      currencyCode: amounts.currencyCode,
    };
  }, [filtered]);

  const bounds = getInvoicePeriodBounds(rangePreset);
  const dateRange = formatKpiPeriodRange(
    bounds ? bounds.start.toISOString() : null,
    bounds ? bounds.end.toISOString() : new Date().toISOString(),
  );

  const hasActiveFilters = rangePreset !== DEFAULT_RANGE
    || category !== DEFAULT_CATEGORY
    || source !== DEFAULT_SOURCE;

  const openRow = (row: UnifiedSalesOrderRow) => {
    navigate(row.href);
  };

  const headerTools = useMemo(
    () => (
      <div className="catalog-header-tools">
        <div className="catalog-header-search">
          <Search size={18} aria-hidden className="catalog-header-search__icon" />
          <input
            type="search"
            className="catalog-header-search__input"
            placeholder="Search SO #, YES-ORD #…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search sales orders"
          />
          {search ? (
            <button
              type="button"
              className="catalog-header-search__clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => navigate(`${basePath}/orders`)}
          title="Cart"
          aria-label="Open cart"
        >
          <ShoppingCart size={16} aria-hidden />
          <span className="catalog-header-tools__label">Cart</span>
        </button>
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
    [search, filterOpen, hasActiveFilters, basePath, navigate],
  );

  useCatalogPageHeader({ mobileCompactHeader: true, title: 'Sales orders' }, true);
  usePageHeaderSlot(headerTools);

  return (
    <div className="page-content fade-in admin-invoices-page invoices-page unified-sales-orders-page dealer-sales-orders-page">
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
                    : pageRows.length
                      ? 'Mixed currencies'
                      : formatCurrency(0)}
              </strong>
            </div>
          </div>
        </div>
      </section>

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
                ? (stageCounts.all ?? 0)
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

        {loading && pageRows.length === 0 ? (
          <FetchingLoader label="Loading sales orders…" />
        ) : !loading && filtered.length === 0 ? (
          <div className="invoices-empty panel glass">
            <ClipboardList size={36} aria-hidden />
            <h2>No sales orders found</h2>
            <p className="text-muted text-sm">
              Portal orders and Zoho sales orders for your account will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="panel glass invoices-table-panel admin-invoices-table-panel">
              <div className="invoices-table-wrap invoices-table-wrap--desktop">
                <table className="invoices-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th className="invoices-table__num">Qty</th>
                      <th className="invoices-table__num">Total</th>
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
                          <div className="unified-so-order-cell">
                            <strong>{row.primaryNumber}</strong>
                            <span className="invoices-table__ref text-muted text-sm">
                              {formatInvoiceDate(row.date)}
                            </span>
                            <span className="unified-so-order-cell__badges">
                              <SourceBadge source={row.source} />
                              {row.category ? (
                                <InvoiceCategoryBadge category={row.category} />
                              ) : null}
                              {row.source === 'portal' ? (
                                <OrderStatusBadge status={row.statusRaw} />
                              ) : (
                                <span className={row.statusClass}>{row.statusLabel}</span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="invoices-table__num">
                          {formatInvoiceItemQuantity(row.qty)}
                        </td>
                        <td className="invoices-table__num">
                          {formatCurrency(row.amount, row.currencyCode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="invoices-mobile-list admin-invoices-mobile-list">
                <div className="invoices-mobile-list__head" aria-hidden>
                  <span>Order</span>
                  <span>Amount</span>
                </div>
                {pageRows.map(row => (
                  <button
                    key={row.key}
                    type="button"
                    className="invoices-mobile-row invoices-mobile-row--po-stack unified-so-mobile-row"
                    onClick={() => openRow(row)}
                    aria-label={`View ${row.primaryNumber}`}
                  >
                    <InvoiceCategoryIcon category={row.category} />
                    <span className="invoices-mobile-row__body">
                      <span className="invoices-mobile-row__invoice">
                        <span className="invoices-mobile-row__pair">
                          <span className="unified-so-order-cell__badges">
                            {row.category ? (
                              <InvoiceCategoryBadge category={row.category} />
                            ) : null}
                            <SourceBadge source={row.source} />
                          </span>
                          <strong className="invoices-mobile-row__amount-value">
                            {formatCurrency(row.amount, row.currencyCode)}
                          </strong>
                        </span>
                        <strong className="invoices-mobile-row__company unified-so-mobile-row__number">
                          {row.primaryNumber}
                        </strong>
                        <span className="invoices-mobile-row__pair unified-so-mobile-row__footer">
                          <span className="invoices-mobile-row__meta">
                            {formatInvoiceDate(row.date)}
                            {' • '}
                            Qty {formatInvoiceItemQuantity(row.qty)}
                          </span>
                          {row.source === 'portal' ? (
                            <OrderStatusBadge status={row.statusRaw} />
                          ) : (
                            <span className={row.statusClass}>{row.statusLabel}</span>
                          )}
                        </span>
                      </span>
                    </span>
                    <span className="invoices-mobile-row__chevron" aria-hidden>
                      <ChevronRight size={18} />
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {totalPages > 1 && (
              <footer className="invoices-pagination invoices-pagination--sticky">
                <span className="invoices-pagination__info text-muted text-sm">
                  {pageRows.length
                    ? `${(page - 1) * LIST_PAGE_SIZE + 1}–${(page - 1) * LIST_PAGE_SIZE + pageRows.length}`
                    : '0'}
                  {' of '}
                  {filtered.length.toLocaleString('en-IN')}
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

      <DealerFilterSheet
        open={filterOpen}
        rangePreset={rangePreset}
        category={category}
        source={source}
        onClose={() => setFilterOpen(false)}
        onApply={next => {
          setRangePreset(next.rangePreset);
          setCategory(next.category);
          setSource(next.source);
        }}
      />
    </div>
  );
};
