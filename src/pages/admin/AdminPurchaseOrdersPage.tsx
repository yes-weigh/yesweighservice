import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  FileText,
  IndianRupee,
  RefreshCw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  InvoiceCategoryBadge,
  InvoiceCategoryIcon,
} from '../../components/invoices/InvoiceCategoryVisual';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  buildAdminPurchaseOrderSalesEntries,
  filterAdminPurchaseOrders,
  filterAdminPurchaseOrdersByPeriod,
  subscribeAdminPurchaseOrders,
  type AdminFirestorePurchaseOrder,
  type AdminPurchaseOrderSort,
} from '../../lib/admin-purchase-orders';
import { formatCurrency } from '../../lib/catalog';
import {
  computeSalesForPeriod,
  formatInvoiceDate,
  formatInvoiceItemQuantity,
  formatKpiPeriodRange,
  invoiceCategoryLabel,
  invoiceStatusLabel,
} from '../../lib/invoices';
import { useRevealScrollbarOnScroll } from '../../lib/useRevealScrollbarOnScroll';
import type { InvoiceCategory, SalesRangePreset } from '../../types/invoices';
import { INVOICE_CATEGORY_FILTER_OPTIONS, SALES_RANGE_OPTIONS } from '../../types/invoices';

const PAGE_SIZE = 500;
const LIST_PAGE_SIZE = 25;
const DEFAULT_RANGE: SalesRangePreset = 'current_month';
const DEFAULT_SORT: AdminPurchaseOrderSort = 'date';
const DEFAULT_CATEGORY: InvoiceCategory | 'all' = 'all';

const SORT_OPTIONS: Array<{ value: AdminPurchaseOrderSort; label: string }> = [
  { value: 'date', label: 'PO date' },
  { value: 'syncedAt', label: 'Most recently updated' },
];

function poStatusClass(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return `invoices-status invoices-status--${key}`;
}

function PurchaseOrderFilterSheet({
  open,
  rangePreset,
  category,
  sort,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  category: InvoiceCategory | 'all';
  sort: AdminPurchaseOrderSort;
  onClose: () => void;
  onApply: (next: {
    rangePreset: SalesRangePreset;
    category: InvoiceCategory | 'all';
    sort: AdminPurchaseOrderSort;
  }) => void;
}) {
  const [draftRange, setDraftRange] = useState(rangePreset);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftSort, setDraftSort] = useState(sort);

  useEffect(() => {
    if (!open) return;
    setDraftRange(rangePreset);
    setDraftCategory(category);
    setDraftSort(sort);
  }, [open, rangePreset, category, sort]);

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
    || draftSort !== DEFAULT_SORT;

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
        aria-label="Filter purchase orders"
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
                  const id = `admin-po-range-${String(option.value)}`;
                  return (
                    <label key={String(option.value)} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="admin-po-date-range"
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
              <span className="catalog-spares-multi-filters__label">Category</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Category">
                {INVOICE_CATEGORY_FILTER_OPTIONS.map(option => {
                  const checked = draftCategory === option.value;
                  const id = `admin-po-category-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="admin-po-category"
                        checked={checked}
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
                  const checked = draftSort === option.value;
                  const id = `admin-po-sort-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="admin-po-sort"
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
                onApply({
                  rangePreset: draftRange,
                  category: draftCategory,
                  sort: draftSort,
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

export const AdminPurchaseOrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const basePath = pathname.startsWith('/staff') ? '/staff' : '/super-admin';
  const canSync = user?.role === 'super_admin';
  const scrollRef = useRevealScrollbarOnScroll();
  const [rows, setRows] = useState<AdminFirestorePurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminPurchaseOrderSort>(DEFAULT_SORT);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [category, setCategory] = useState<InvoiceCategory | 'all'>(DEFAULT_CATEGORY);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    setError('');
    setRows([]);
    const unsubscribe = subscribeAdminPurchaseOrders(
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
      category,
    );
    return () => unsubscribe();
  }, [sort, category]);

  const periodRows = useMemo(
    () => filterAdminPurchaseOrdersByPeriod(rows, rangePreset),
    [rows, rangePreset],
  );

  const filtered = useMemo(
    () => filterAdminPurchaseOrders(periodRows, search, category),
    [periodRows, search, category],
  );

  useEffect(() => {
    setPage(1);
  }, [search, rangePreset, category, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * LIST_PAGE_SIZE;
    return filtered.slice(start, start + LIST_PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const openPo = (po: AdminFirestorePurchaseOrder) => {
    navigate(`${basePath}/purchase-orders/${po.id}`);
  };

  const summary = useMemo(() => {
    const salesEntries = buildAdminPurchaseOrderSalesEntries(filtered);
    const sales = salesEntries.length ? computeSalesForPeriod(salesEntries, rangePreset) : null;
    return {
      count: filtered.length,
      totalAmount: sales?.totalSales ?? 0,
      periodStart: sales?.periodStart ?? null,
      periodEnd: sales?.periodEnd ?? new Date().toISOString(),
    };
  }, [filtered, rangePreset]);

  const dateRange = formatKpiPeriodRange(summary.periodStart, summary.periodEnd);
  const hasActiveFilters = rangePreset !== DEFAULT_RANGE
    || category !== DEFAULT_CATEGORY
    || sort !== DEFAULT_SORT;

  const headerTools = useMemo(
    () => (
      <div className="invoices-header-tools">
        {canSync && (
          <Link
            to={`${basePath}/purchase-orders/sync`}
            className="btn btn-secondary btn-sm"
            title="Purchase order sync"
          >
            <RefreshCw size={14} />
            Sync
          </Link>
        )}
        <div className="catalog-search invoices-header-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search PO #, vendor…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search purchase orders"
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
          aria-label="Filter purchase orders"
          title="Filters"
        >
          <SlidersHorizontal size={20} strokeWidth={2.25} />
        </button>
      </div>
    ),
    [search, filterOpen, hasActiveFilters, canSync, basePath],
  );

  useCatalogPageHeader({ mobileCompactHeader: true }, true);
  usePageHeaderSlot(headerTools);

  return (
    <div className="page-content fade-in admin-invoices-page invoices-page">
      <section className="invoices-summary" aria-label="Purchase order summary">
        <div className="invoices-summary__kpis">
          <div className="invoices-summary__kpi">
            <span className="invoices-summary__kpi-icon" aria-hidden>
              <ShoppingBag size={16} strokeWidth={2.4} />
            </span>
            <div className="invoices-summary__kpi-body">
              <span className="invoices-summary__kpi-label">Total POs</span>
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
                {loading ? '…' : formatCurrency(summary.totalAmount)}
              </strong>
              <span className="invoices-summary__kpi-sub">Amount</span>
            </div>
          </div>
        </div>
      </section>

      <div ref={scrollRef} className="invoices-page__scroll">
        {error && (
          <div className="products-inline-error panel glass admin-invoices-error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {loading && rows.length === 0 ? (
          <FetchingLoader label="Loading purchase orders…" />
        ) : filtered.length === 0 ? (
          <div className="invoices-empty panel glass">
            <FileText size={40} className="text-muted" aria-hidden />
            <p>No purchase orders found for this period.</p>
            {canSync && (
              <Link to={`${basePath}/purchase-orders/sync`} className="btn btn-primary mt-4">
                Open PO sync
              </Link>
            )}
          </div>
        ) : (
          <>
            {totalPages > 1 && (
              <div className="invoices-pagination invoices-pagination--top" role="navigation" aria-label="PO list pagination">
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
                      <th>Purchase order</th>
                      <th>Vendor</th>
                      <th>Date</th>
                      <th className="invoices-table__num">Qty</th>
                      <th className="invoices-table__num">Total</th>
                      <th>Category</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(po => {
                      const categoryLabel = invoiceCategoryLabel(po.purchaseOrderCategory);
                      return (
                        <tr
                          key={po.id}
                          className="invoices-table__row--clickable"
                          onClick={() => openPo(po)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openPo(po);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`View purchase order ${po.purchaseOrderNumber || po.id}`}
                        >
                          <td>
                            <strong>{po.purchaseOrderNumber || po.id}</strong>
                            {po.referenceNumber && (
                              <div className="invoices-table__ref text-muted text-sm">
                                Ref {po.referenceNumber}
                              </div>
                            )}
                          </td>
                          <td>{po.vendorName ?? '—'}</td>
                          <td>{formatInvoiceDate(po.date)}</td>
                          <td className="invoices-table__num">{formatInvoiceItemQuantity(po.itemQuantity)}</td>
                          <td className="invoices-table__num">{formatCurrency(po.total)}</td>
                          <td>
                            {categoryLabel ? (
                              <InvoiceCategoryBadge category={po.purchaseOrderCategory} />
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td>
                            <span className={poStatusClass(po.status)}>
                              {invoiceStatusLabel(po.status)}
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
                  <span>Purchase order</span>
                  <span>Amount</span>
                </div>
                {pageRows.map(po => (
                  <button
                    key={po.id}
                    type="button"
                    className="invoices-mobile-row"
                    onClick={() => openPo(po)}
                    aria-label={`View purchase order ${po.purchaseOrderNumber || po.id}`}
                  >
                    <InvoiceCategoryIcon category={po.purchaseOrderCategory} />
                    <span className="invoices-mobile-row__body">
                      <span className="invoices-mobile-row__invoice">
                        <span className="invoices-mobile-row__title">
                          <InvoiceCategoryBadge category={po.purchaseOrderCategory} />
                          <strong>{po.purchaseOrderNumber || po.id}</strong>
                        </span>
                        <span className="invoices-mobile-row__so">
                          {po.vendorName ?? '—'}
                        </span>
                        <span className="invoices-mobile-row__meta">
                          {formatInvoiceDate(po.date)}
                          {' • '}
                          Qty {formatInvoiceItemQuantity(po.itemQuantity)}
                        </span>
                      </span>
                      <span className="invoices-mobile-row__amount">
                        <strong>{formatCurrency(po.total)}</strong>
                        <span className={poStatusClass(po.status)}>
                          {invoiceStatusLabel(po.status)}
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

      <PurchaseOrderFilterSheet
        open={filterOpen}
        rangePreset={rangePreset}
        category={category}
        sort={sort}
        onClose={() => setFilterOpen(false)}
        onApply={next => {
          setRangePreset(next.rangePreset);
          setCategory(next.category);
          setSort(next.sort);
        }}
      />
    </div>
  );
};
