import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  ClipboardList,
  IndianRupee,
  LayoutGrid,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  InvoiceCategoryBadgeList,
  InvoiceCategoryIcon,
} from '../../components/invoices/InvoiceCategoryVisual';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import type {
  AdminFirestoreSalesOrder,
  AdminSalesOrderCategoryCounts,
} from '../../lib/admin-sales-orders';
import { toSalesOrderDateKey } from '../../lib/admin-sales-orders';
import { formatCurrency } from '../../lib/catalog';
import { listDealerSalesOrders } from '../../lib/dealer-sales-orders';
import {
  formatInvoiceDate,
  formatInvoiceItemQuantity,
  formatKpiPeriodRange,
  getInvoicePeriodBounds,
  invoiceErrorMessage,
} from '../../lib/invoices';
import { useRevealScrollbarOnScroll } from '../../lib/useRevealScrollbarOnScroll';
import {
  filterUnifiedSalesOrders,
  mergeUnifiedSalesOrders,
  summarizeUnifiedAmounts,
  type UnifiedSalesOrderRow,
} from '../../lib/unified-sales-orders';
import { homePathForRole } from '../../types';
import type { InvoiceCategory, SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

const LIST_PAGE_SIZE = 25;
const DEFAULT_RANGE: SalesRangePreset = 'financial_year';
const DEFAULT_CATEGORY: InvoiceCategory | 'all' = 'all';
const CATEGORY_BLOCKS: Array<{ value: InvoiceCategory | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'product', label: 'Product' },
  { value: 'spare', label: 'Spares' },
  { value: 'software_key', label: 'Software' },
  { value: 'service', label: 'Service' },
  { value: 'gatc', label: 'GATC' },
];

const EMPTY_CATEGORY_COUNTS: AdminSalesOrderCategoryCounts = {
  all: 0,
  product: 0,
  spare: 0,
  software_key: 0,
  service: 0,
  gatc: 0,
};

function DealerFilterSheet({
  open,
  rangePreset,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  onClose: () => void;
  onApply: (next: { rangePreset: SalesRangePreset }) => void;
}) {
  const [draftRange, setDraftRange] = useState(rangePreset);

  useEffect(() => {
    if (!open) return;
    setDraftRange(rangePreset);
  }, [open, rangePreset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const draftDirty = draftRange !== DEFAULT_RANGE;

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
          </div>

          <div className="catalog-spares-multi-filters__footer">
            <button
              type="button"
              className="catalog-spares-multi-filters__apply"
              onClick={() => {
                onApply({ rangePreset: draftRange });
                onClose();
              }}
            >
              Apply
            </button>
            <button
              type="button"
              className="catalog-spares-multi-filters__clear-btn"
              disabled={!draftDirty}
              onClick={() => setDraftRange(DEFAULT_RANGE)}
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

  const [zohoOrders, setZohoOrders] = useState<AdminFirestoreSalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [category, setCategory] = useState<InvoiceCategory | 'all'>(DEFAULT_CATEGORY);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const bounds = getInvoicePeriodBounds(rangePreset);
    const dateStart = bounds ? toSalesOrderDateKey(bounds.start) : null;
    const dateEnd = bounds ? toSalesOrderDateKey(bounds.end) : null;
    // Zoho-only list — portal dealerOrders are no longer merged.
    void listDealerSalesOrders({ limit: 2500, dateStart, dateEnd })
      .then(rows => {
        setZohoOrders(rows);
        setError('');
      })
      .catch(err => {
        setZohoOrders([]);
        setError(invoiceErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [rangePreset]);

  useEffect(() => {
    load();
  }, [load]);

  const merged = useMemo(
    () => mergeUnifiedSalesOrders([], zohoOrders, basePath, {
      includePortalDuplicates: false,
    }),
    [zohoOrders, basePath],
  );

  const filtered = useMemo(
    () => filterUnifiedSalesOrders(merged, {
      search,
      source: 'zoho',
      statusChip: 'all',
      category,
      period: rangePreset,
    }),
    [merged, search, category, rangePreset],
  );

  const categoryCounts = useMemo(() => {
    const inPeriod = filterUnifiedSalesOrders(merged, {
      search: '',
      source: 'zoho',
      statusChip: 'all',
      category: 'all',
      period: rangePreset,
    });
    const counts: AdminSalesOrderCategoryCounts = { ...EMPTY_CATEGORY_COUNTS, all: inPeriod.length };
    for (const row of inPeriod) {
      for (const key of row.categories) counts[key] += 1;
    }
    return counts;
  }, [merged, rangePreset]);

  useEffect(() => {
    setPage(1);
  }, [search, rangePreset, category]);

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
    const categoryAmount = category === 'all'
      ? amounts.totalAmount
      : filtered.reduce((sum, row) => sum + Number(row.categoryAmounts[category] ?? row.amount ?? 0), 0);
    return {
      count: filtered.length,
      categoryAmount,
      totalAmount: amounts.totalAmount,
      currencyCode: amounts.currencyCode,
    };
  }, [filtered, category]);

  const bounds = getInvoicePeriodBounds(rangePreset);
  const dateRange = formatKpiPeriodRange(
    bounds ? bounds.start.toISOString() : null,
    bounds ? bounds.end.toISOString() : new Date().toISOString(),
  );

  const hasActiveFilters = rangePreset !== DEFAULT_RANGE;

  const openRow = (row: UnifiedSalesOrderRow) => {
    navigate(row.href);
  };

  const headerTools = useMemo(
    () => (
      <div className="invoices-header-tools">
        <div className="catalog-search invoices-header-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search SO #, YES-ORD #…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search sales orders"
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
    [search, filterOpen, hasActiveFilters],
  );

  useCatalogPageHeader({ mobileCompactHeader: true }, true);
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
              <span className="invoices-summary__kpi-label">
                {category === 'all' ? 'Total Amount' : 'Category Amount'}
              </span>
              <strong className="invoices-summary__kpi-value invoices-summary__kpi-value--amount">
                {loading
                  ? '…'
                  : summary.currencyCode
                    ? formatCurrency(category === 'all' ? summary.totalAmount : summary.categoryAmount, summary.currencyCode)
                    : pageRows.length
                      ? 'Mixed currencies'
                      : formatCurrency(0)}
              </strong>
            </div>
          </div>
        </div>

        <div className="unified-so-category-blocks" role="tablist" aria-label="Order category">
          {CATEGORY_BLOCKS.map(item => {
            const active = category === item.value;
            const count = item.value === 'all'
              ? categoryCounts.all
              : categoryCounts[item.value];
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={active}
                className={`unified-so-category-block${active ? ' is-active' : ''}${
                  item.value !== 'all' ? ` unified-so-category-block--${item.value}` : ''
                }`}
                onClick={() => setCategory(item.value)}
              >
                <span className="unified-so-category-block__icon" aria-hidden>
                  {item.value === 'all' ? (
                    <span className="unified-so-category-block__icon--all">
                      <LayoutGrid size={18} strokeWidth={2.2} />
                    </span>
                  ) : (
                    <InvoiceCategoryIcon category={item.value} />
                  )}
                </span>
                <span className="unified-so-category-block__label">{item.label}</span>
                <span className="unified-so-category-block__count">
                  {loading ? '…' : count.toLocaleString('en-IN')}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div ref={scrollRef} className="invoices-page__scroll">
        {error && (
          <div className="products-inline-error panel glass admin-invoices-error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && zohoOrders.length > 0 && !filtered.some(row => row.source === 'zoho') && (
          <div className="products-inline-error panel glass admin-invoices-error" role="status">
            <AlertCircle size={18} />
            <span>
              {zohoOrders.length.toLocaleString('en-IN')} Zoho sales orders are loaded but hidden by the
              current date filter. Open Filters and choose Lifetime (or a wider range).
            </span>
          </div>
        )}

        {loading && pageRows.length === 0 ? (
          <FetchingLoader label="Loading sales orders…" />
        ) : !loading && filtered.length === 0 ? (
          <div className="invoices-empty panel glass">
            <ClipboardList size={36} aria-hidden />
            <h2>No sales orders found</h2>
            <p className="text-muted text-sm">
              Zoho sales orders for your account will appear here after you submit a cart.
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
                              <InvoiceCategoryBadgeList
                                categories={row.categories}
                                invoiceCategory={row.category}
                              />
                              <span className={row.statusClass}>{row.statusLabel}</span>
                            </span>
                          </div>
                        </td>
                        <td className="invoices-table__num">
                          {formatInvoiceItemQuantity(row.qty)}
                        </td>
                        <td className="invoices-table__num">
                          {formatCurrency(
                            category === 'all'
                              ? row.amount
                              : Number(row.categoryAmounts[category] ?? row.amount ?? 0),
                            row.currencyCode,
                          )}
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
                          <strong className="invoices-mobile-row__amount-value">
                            {formatCurrency(
                              category === 'all'
                                ? row.amount
                                : Number(row.categoryAmounts[category] ?? row.amount ?? 0),
                              row.currencyCode,
                            )}
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
                          <span className={row.statusClass}>{row.statusLabel}</span>
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
        onClose={() => setFilterOpen(false)}
        onApply={next => {
          setRangePreset(next.rangePreset);
        }}
      />
    </div>
  );
};
