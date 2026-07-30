import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  AlertCircle,
  ChevronRight,
  FileText,
  IndianRupee,
  LayoutGrid,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  InvoiceCategoryBadgeList,
  InvoiceCategoryIcon,
} from '../../components/invoices/InvoiceCategoryVisual';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  countAdminPurchaseOrdersByCategory,
  fetchAdminPurchaseOrdersPageDetailed,
  fetchAllAdminPurchaseOrdersInRange,
  filterAdminPurchaseOrders,
  toPurchaseOrderDateKey,
  type AdminFirestorePurchaseOrder,
  type AdminPurchaseOrderCategoryCounts,
  type AdminPurchaseOrderSort,
} from '../../lib/admin-purchase-orders';
import { formatCurrency } from '../../lib/catalog';
import {
  formatInvoiceDate,
  formatInvoiceItemQuantity,
  formatKpiPeriodRange,
  getInvoicePeriodBounds,
  invoiceCategoryLabel,
  invoiceErrorMessage,
  invoiceStatusLabel,
} from '../../lib/invoices';
import { useRevealScrollbarOnScroll } from '../../lib/useRevealScrollbarOnScroll';
import type { InvoiceCategory, SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

const LIST_PAGE_SIZE = 25;
const SEARCH_FETCH_SIZE = 100;
const DEFAULT_RANGE: SalesRangePreset = 'financial_year';
const DEFAULT_SORT: AdminPurchaseOrderSort = 'date';
const DEFAULT_CATEGORY: InvoiceCategory | 'all' = 'all';

const CATEGORY_BLOCKS: Array<{ value: InvoiceCategory | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'product', label: 'Product' },
  { value: 'spare', label: 'Spares' },
  { value: 'software_key', label: 'Software' },
  { value: 'service', label: 'Service' },
  { value: 'gatc', label: 'Stamping' },
];

const EMPTY_CATEGORY_COUNTS: AdminPurchaseOrderCategoryCounts = {
  all: 0,
  product: 0,
  spare: 0,
  software_key: 0,
  service: 0,
  gatc: 0,
};

const SORT_OPTIONS: Array<{ value: AdminPurchaseOrderSort; label: string }> = [
  { value: 'date', label: 'PO date' },
  { value: 'syncedAt', label: 'Most recently updated' },
];

function poStatusClass(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return `invoices-status invoices-status--${key}`;
}

function totalsByCurrency(
  rows: AdminFirestorePurchaseOrder[],
  category: InvoiceCategory | 'all',
): Array<{ currencyCode: string; total: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const code = (row.currencyCode || 'INR').toUpperCase();
    const amount = category === 'all'
      ? Number(row.total ?? 0)
      : Number(row.categoryAmounts[category] ?? row.total ?? 0);
    map.set(code, (map.get(code) ?? 0) + amount);
  }
  return [...map.entries()]
    .map(([currencyCode, total]) => ({ currencyCode, total }))
    .sort((a, b) => {
      if (a.currencyCode === 'INR') return -1;
      if (b.currencyCode === 'INR') return 1;
      return a.currencyCode.localeCompare(b.currencyCode);
    });
}

function PurchaseOrderFilterSheet({
  open,
  rangePreset,
  sort,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  sort: AdminPurchaseOrderSort;
  onClose: () => void;
  onApply: (next: {
    rangePreset: SalesRangePreset;
    sort: AdminPurchaseOrderSort;
  }) => void;
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
                  const id = `po-range-${String(option.value)}`;
                  return (
                    <label key={String(option.value)} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="po-date-range"
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
              <span className="catalog-spares-multi-filters__label">Sort by</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Sort by">
                {SORT_OPTIONS.map(option => {
                  const id = `po-sort-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="po-sort"
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

export const AdminPurchaseOrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const basePath = pathname.startsWith('/staff') ? '/staff' : '/super-admin';
  const scrollRef = useRevealScrollbarOnScroll();
  const pageStartCursors = useRef<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const [pageCursorVersion, setPageCursorVersion] = useState(0);

  const [rows, setRows] = useState<AdminFirestorePurchaseOrder[]>([]);
  const [amountRows, setAmountRows] = useState<AdminFirestorePurchaseOrder[]>([]);
  const [categoryCounts, setCategoryCounts] = useState(EMPTY_CATEGORY_COUNTS);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [countsLoading, setCountsLoading] = useState(true);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminPurchaseOrderSort>(DEFAULT_SORT);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [category, setCategory] = useState<InvoiceCategory | 'all'>(DEFAULT_CATEGORY);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);

  const bounds = getInvoicePeriodBounds(rangePreset);
  const dateStart = bounds?.start ? toPurchaseOrderDateKey(bounds.start) : null;
  const dateEnd = bounds?.end ? toPurchaseOrderDateKey(bounds.end) : null;
  const searchActive = Boolean(search.trim());

  useEffect(() => {
    setPage(1);
    pageStartCursors.current = [null];
    setPageCursorVersion(v => v + 1);
  }, [search, rangePreset, category, sort]);

  useEffect(() => {
    let cancelled = false;
    setCountsLoading(true);
    void countAdminPurchaseOrdersByCategory({ dateStart, dateEnd })
      .then(counts => {
        if (cancelled) return;
        setCategoryCounts(counts);
        setTotalCount(category === 'all' ? counts.all : counts[category]);
      })
      .catch(err => {
        if (!cancelled) setError(invoiceErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setCountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateStart, dateEnd, category]);

  // Full-period scan for amount KPIs (bounded).
  useEffect(() => {
    let cancelled = false;
    void fetchAllAdminPurchaseOrdersInRange({
      sort,
      category: 'all',
      dateStart,
      dateEnd,
    })
      .then(({ rows: next, truncated: wasTruncated }) => {
        if (cancelled) return;
        setAmountRows(next);
        setTruncated(wasTruncated);
      })
      .catch(() => {
        if (!cancelled) setAmountRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sort, dateStart, dateEnd]);

  useEffect(() => {
    let cancelled = false;
    const cursor = pageStartCursors.current[page - 1] ?? null;
    setLoading(true);
    setError('');

    void fetchAdminPurchaseOrdersPageDetailed({
      sort,
      pageSize: searchActive ? SEARCH_FETCH_SIZE : LIST_PAGE_SIZE,
      cursor: searchActive ? null : cursor,
      category: searchActive ? 'all' : category,
      dateStart,
      dateEnd,
    })
      .then(result => {
        if (cancelled) return;
        setRows(result.rows);
        if (!searchActive && result.lastDoc) {
          pageStartCursors.current[page] = result.lastDoc;
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(invoiceErrorMessage(err));
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, pageCursorVersion, sort, category, dateStart, dateEnd, searchActive]);

  const filtered = useMemo(
    () => filterAdminPurchaseOrders(rows, search, searchActive ? category : 'all'),
    [rows, search, category, searchActive],
  );

  const amountFiltered = useMemo(
    () => filterAdminPurchaseOrders(amountRows, search, category),
    [amountRows, search, category],
  );

  const clientPaged = searchActive;
  const filteredTotal = searchActive ? filtered.length : totalCount;
  const pageRows = useMemo(() => {
    if (searchActive) {
      const start = (page - 1) * LIST_PAGE_SIZE;
      return filtered.slice(start, start + LIST_PAGE_SIZE);
    }
    return filtered;
  }, [searchActive, filtered, page]);

  const totalPages = useMemo(() => {
    if (clientPaged) return Math.max(1, Math.ceil(filteredTotal / LIST_PAGE_SIZE));
    if (filteredTotal <= 0) return 1;
    return Math.ceil(filteredTotal / LIST_PAGE_SIZE);
  }, [clientPaged, filteredTotal]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const openPo = (po: AdminFirestorePurchaseOrder) => {
    navigate(`${basePath}/purchase-orders/${po.id}`);
  };

  const summary = useMemo(() => {
    const categoryTotalsByCurrency = totalsByCurrency(amountFiltered, category);
    return {
      count: filteredTotal,
      categoryTotalsByCurrency,
      periodStart: bounds?.start?.toISOString() ?? null,
      periodEnd: bounds?.end?.toISOString() ?? new Date().toISOString(),
    };
  }, [amountFiltered, category, filteredTotal, bounds]);

  const dateRange = formatKpiPeriodRange(summary.periodStart, summary.periodEnd);
  const hasActiveFilters = rangePreset !== DEFAULT_RANGE || sort !== DEFAULT_SORT;
  const busy = loading || countsLoading;

  const headerTools = useMemo(
    () => (
      <div className="invoices-header-tools">
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
    [search, filterOpen, hasActiveFilters],
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
                {busy ? '…' : summary.count.toLocaleString('en-IN')}
              </strong>
              <span className="invoices-summary__kpi-sub">
                {busy ? '—' : dateRange}
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
              {busy ? (
                <strong className="invoices-summary__kpi-value invoices-summary__kpi-value--amount">…</strong>
              ) : summary.categoryTotalsByCurrency.length === 0 ? (
                <strong className="invoices-summary__kpi-value invoices-summary__kpi-value--amount">
                  {formatCurrency(0)}
                </strong>
              ) : summary.categoryTotalsByCurrency.length === 1 ? (
                <strong className="invoices-summary__kpi-value invoices-summary__kpi-value--amount">
                  {formatCurrency(
                    summary.categoryTotalsByCurrency[0].total,
                    summary.categoryTotalsByCurrency[0].currencyCode,
                  )}
                </strong>
              ) : (
                <ul className="invoices-summary__currency-totals" aria-label="Totals by currency">
                  {summary.categoryTotalsByCurrency.map(row => (
                    <li key={row.currencyCode}>
                      <strong>{formatCurrency(row.total, row.currencyCode)}</strong>
                    </li>
                  ))}
                </ul>
              )}
              <span className="invoices-summary__kpi-sub">
                {truncated
                  ? 'Partial (scan cap)'
                  : summary.categoryTotalsByCurrency.length > 1
                    ? `${summary.categoryTotalsByCurrency.length} currencies`
                    : (category === 'all' ? 'Amount' : `${invoiceCategoryLabel(category)} lines`)}
              </span>
            </div>
          </div>
        </div>

        <div className="unified-so-category-blocks" role="tablist" aria-label="PO category">
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
                  {busy ? '…' : count.toLocaleString('en-IN')}
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

        {loading && rows.length === 0 ? (
          <FetchingLoader label="Loading purchase orders…" />
        ) : pageRows.length === 0 ? (
          <div className="invoices-empty panel glass">
            <FileText size={40} className="text-muted" aria-hidden />
            <p>No purchase orders found for this period.</p>
          </div>
        ) : (
          <>
            {totalPages > 1 && (
              <div className="invoices-pagination invoices-pagination--top" role="navigation" aria-label="PO list pagination">
                <span className="invoices-pagination__info text-muted text-sm">
                  {(page - 1) * LIST_PAGE_SIZE + 1}–{Math.min(page * LIST_PAGE_SIZE, filteredTotal)} of {filteredTotal.toLocaleString('en-IN')}
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
                          <td className="invoices-table__num">
                            {formatCurrency(
                              category === 'all'
                                ? po.total
                                : Number(po.categoryAmounts[category] ?? po.total ?? 0),
                              po.currencyCode,
                            )}
                          </td>
                          <td>
                            {categoryLabel || po.categories.length ? (
                              <span className="unified-so-order-cell__badges">
                                <InvoiceCategoryBadgeList
                                  categories={po.categories}
                                  invoiceCategory={po.purchaseOrderCategory}
                                />
                              </span>
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
                    className="invoices-mobile-row invoices-mobile-row--po-stack"
                    onClick={() => openPo(po)}
                    aria-label={`View purchase order ${po.purchaseOrderNumber || po.id}`}
                  >
                    <InvoiceCategoryIcon category={po.purchaseOrderCategory} />
                    <span className="invoices-mobile-row__body">
                      <span className="invoices-mobile-row__invoice">
                        <strong className="invoices-mobile-row__company">
                          {po.vendorName ?? '—'}
                        </strong>
                        <span className="invoices-mobile-row__pair invoices-mobile-row__pair--mid">
                          <span className="invoices-mobile-row__date">
                            {formatInvoiceDate(po.date)}
                          </span>
                          <span className={poStatusClass(po.status)}>
                            {invoiceStatusLabel(po.status)}
                          </span>
                        </span>
                        <span className="invoices-mobile-row__pair">
                          <span className="invoices-mobile-row__po-num">
                            {po.purchaseOrderNumber || po.id}
                            {' • '}
                            Qty {formatInvoiceItemQuantity(po.itemQuantity)}
                          </span>
                          <strong className="invoices-mobile-row__amount-value">
                            {formatCurrency(
                              category === 'all'
                                ? po.total
                                : Number(po.categoryAmounts[category] ?? po.total ?? 0),
                              po.currencyCode,
                            )}
                          </strong>
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
                  {(page - 1) * LIST_PAGE_SIZE + 1}–{Math.min(page * LIST_PAGE_SIZE, filteredTotal)} of {filteredTotal.toLocaleString('en-IN')}
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
