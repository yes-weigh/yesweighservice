import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  ClipboardList,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { SalesOrderStageSeal } from '../../components/salesOrders/SalesOrderStageSeal';
import {
  EMPTY_STAGE_COUNTS,
  SalesOrderStageFilterBlocks,
} from '../../components/salesOrders/SalesOrderStageFilterBlocks';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  InvoiceCategoryBadgeList,
  SalesOrderTileLeadIcon,
} from '../../components/invoices/InvoiceCategoryVisual';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import type {
  AdminFirestoreSalesOrder,
  AdminSalesOrderSort,
} from '../../lib/admin-sales-orders';
import { toSalesOrderDateKey } from '../../lib/admin-sales-orders';
import { formatCurrency } from '../../lib/catalog';
import { listDealerSalesOrders } from '../../lib/dealer-sales-orders';
import { dealerStaffOwnsSalesOrder, hideDealerStaffCommercials } from '../../lib/dealerAccess';
import {
  FROM_SALES_ORDER_LIST_STATE,
  clearSalesOrderListOpenedRow,
  peekSalesOrderListReturn,
  rememberSalesOrderListReturn,
} from '../../lib/salesOrderListReturnFocus';
import {
  formatInvoiceDateTime,
  formatInvoiceItemQuantity,
  getInvoicePeriodBounds,
  invoiceErrorMessage,
} from '../../lib/invoices';
import { useRevealScrollbarOnScroll } from '../../lib/useRevealScrollbarOnScroll';
import { preventMouseFocusScroll } from '../../lib/preventMouseFocusScroll';
import {
  compareSalesOrderNumberDesc,
  countYesOneStages,
  filterUnifiedSalesOrders,
  mergeUnifiedSalesOrders,
  type UnifiedSalesOrderRow,
} from '../../lib/unified-sales-orders';
import { homePathForRole } from '../../types';
import type { InvoiceCategory, SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';
import type { YesOneStageFilter } from '../../lib/salesOrderWorkflow';

const LIST_PAGE_SIZE = 25;
const DEFAULT_RANGE: SalesRangePreset = 'financial_year';
const DEFAULT_CATEGORY: InvoiceCategory | 'all' = 'all';
const DEFAULT_SORT: AdminSalesOrderSort = 'latest';
const SORT_OPTIONS: Array<{ value: AdminSalesOrderSort; label: string }> = [
  { value: 'latest', label: 'Latest first' },
  { value: 'oldest', label: 'Oldest first' },
];

function DealerFilterSheet({
  open,
  rangePreset,
  sort,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  sort: AdminSalesOrderSort;
  onClose: () => void;
  onApply: (next: { rangePreset: SalesRangePreset; sort: AdminSalesOrderSort }) => void;
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

            <div className="catalog-spares-multi-filters__group">
              <span className="catalog-spares-multi-filters__label">Sorting</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Sorting">
                {SORT_OPTIONS.map(option => {
                  const id = `dealer-so-sort-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="dealer-so-sort"
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

export const DealerSalesOrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const hideCommercials = hideDealerStaffCommercials(user);
  const basePath = user ? homePathForRole(user.role) : '/dealer';
  const listKey = basePath;
  const pendingReturnRef = useRef(peekSalesOrderListReturn(listKey));
  const returnFocusAppliedRef = useRef(false);
  const restored = pendingReturnRef.current;
  const prevFilterKeyRef = useRef<string | null>(null);
  const scrollRef = useRevealScrollbarOnScroll();

  const [zohoOrders, setZohoOrders] = useState<AdminFirestoreSalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(() => restored?.search ?? '');
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(
    restored?.rangePreset ?? DEFAULT_RANGE,
  );
  const category = DEFAULT_CATEGORY;
  const [stageFilter, setStageFilter] = useState<YesOneStageFilter | 'all'>(
    restored?.stageFilter ?? 'all',
  );
  const [sort, setSort] = useState<AdminSalesOrderSort>(restored?.sort ?? DEFAULT_SORT);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(() => restored?.page ?? 1);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(
    () => restored?.openedOrderId ?? null,
  );

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const bounds = getInvoicePeriodBounds(rangePreset);
    const dateStart = bounds ? toSalesOrderDateKey(bounds.start) : null;
    const dateEnd = bounds ? toSalesOrderDateKey(bounds.end) : null;
    // Zoho-only list — portal dealerOrders are no longer merged.
    void listDealerSalesOrders({ limit: 2500, dateStart, dateEnd })
      .then(rows => {
        setZohoOrders(rows.filter(row => dealerStaffOwnsSalesOrder(user, row)));
        setError('');
      })
      .catch(err => {
        setZohoOrders([]);
        setError(invoiceErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [rangePreset, user]);

  useEffect(() => {
    load();
  }, [load]);

  const merged = useMemo(
    () => mergeUnifiedSalesOrders([], zohoOrders, basePath, {
      includePortalDuplicates: false,
      audience: 'dealer',
    }),
    [zohoOrders, basePath],
  );

  const baseFiltered = useMemo(
    () => filterUnifiedSalesOrders(merged, {
      search,
      source: 'zoho',
      statusChip: 'all',
      category,
      period: rangePreset,
    }),
    [merged, search, category, rangePreset],
  );

  const stageCounts = useMemo(
    () => (baseFiltered.length ? countYesOneStages(baseFiltered) : EMPTY_STAGE_COUNTS),
    [baseFiltered],
  );

  const filtered = useMemo(() => {
    const staged = stageFilter === 'all'
      ? baseFiltered
      : filterUnifiedSalesOrders(baseFiltered, { yesOneStage: stageFilter });
    const oldest = sort === 'oldest';
    return [...staged].sort((a, b) => {
      const byDate = oldest ? a.sortAt - b.sortAt : b.sortAt - a.sortAt;
      if (byDate) return byDate;
      const byNumber = compareSalesOrderNumberDesc(a.primaryNumber, b.primaryNumber);
      return oldest ? -byNumber : byNumber;
    });
  }, [baseFiltered, stageFilter, sort]);

  useEffect(() => {
    const currentKey = `${search}\0${rangePreset}\0${stageFilter}\0${sort}`;
    const prev = prevFilterKeyRef.current;
    prevFilterKeyRef.current = currentKey;
    if (prev === null || prev === currentKey) return;
    setPage(1);
  }, [search, rangePreset, stageFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * LIST_PAGE_SIZE;
    return filtered.slice(start, start + LIST_PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    if (loading) return;
    if (page > totalPages) setPage(totalPages);
  }, [loading, page, totalPages]);

  useEffect(() => {
    if (returnFocusAppliedRef.current || loading) return;
    const focus = pendingReturnRef.current;
    if (!focus) return;
    returnFocusAppliedRef.current = true;

    const openedId = focus.openedOrderId?.trim() || '';
    if (openedId) {
      setHighlightedOrderId(openedId);
      window.setTimeout(() => {
        setHighlightedOrderId(null);
        clearSalesOrderListOpenedRow(listKey);
      }, 4500);
    }

    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (openedId) {
          const el = document.querySelector(
            `[data-so-id="${CSS.escape(openedId)}"]`,
          ) as HTMLElement | null;
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            return;
          }
        }
        if (scrollRef.current && Number.isFinite(focus.scrollTop) && focus.scrollTop > 0) {
          scrollRef.current.scrollTop = focus.scrollTop;
        }
      }, 80);
    });
  }, [loading, pageRows, listKey]);

  const hasActiveFilters = rangePreset !== DEFAULT_RANGE
    || stageFilter !== 'all'
    || sort !== DEFAULT_SORT;

  const openRow = (row: UnifiedSalesOrderRow) => {
    rememberSalesOrderListReturn(listKey, {
      search,
      stageFilter,
      category: 'all',
      rangePreset,
      sort,
      dealers: [],
      aggregate: false,
      page,
      pageCursorIds: [null],
      scrollTop: scrollRef.current?.scrollTop ?? 0,
      openedOrderId: row.id,
    });
    navigate(row.href, { state: FROM_SALES_ORDER_LIST_STATE });
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
        <SalesOrderStageFilterBlocks
          audience="dealer"
          value={stageFilter}
          counts={stageCounts}
          loading={loading}
          onChange={setStageFilter}
        />
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
              {user?.role === 'dealer_staff'
                ? 'Sales orders you submit will appear here after your dealer approves them.'
                : 'Zoho sales orders for your account will appear here after you submit a cart.'}
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
                      {hideCommercials ? null : (
                        <th className="invoices-table__num">Total</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(row => (
                      <tr
                        key={row.key}
                        data-so-id={row.id}
                        className={[
                          'invoices-table__row--clickable',
                          row.sealKind ? 'unified-so-row--with-seal' : '',
                          highlightedOrderId === row.id ? 'invoices-table__row--return-focus' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => openRow(row)}
                        onMouseDown={preventMouseFocusScroll}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openRow(row);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`View ${row.primaryNumber}${row.sealKind ? `, ${row.statusLabel}` : ''}`}
                      >
                        <td>
                          <div className="unified-so-order-cell">
                            <strong>{row.primaryNumber}</strong>
                            <span className="invoices-table__ref text-muted text-sm">
                              {formatInvoiceDateTime(row.date, row.createdTime)}
                            </span>
                            <span className="unified-so-order-cell__badges">
                              <InvoiceCategoryBadgeList
                                categories={row.categories}
                                invoiceCategory={row.category}
                              />
                              {row.priceCustomized && !hideCommercials ? (
                                <span className="unified-so-price-badge" title="Custom prices on this order">
                                  Custom price
                                </span>
                              ) : null}
                              {row.sealKind ? (
                                <SalesOrderStageSeal kind={row.sealKind} size="inline" />
                              ) : null}
                              <span className={row.statusClass}>{row.statusLabel}</span>
                            </span>
                          </div>
                        </td>
                        <td className="invoices-table__num">
                          {formatInvoiceItemQuantity(row.qty)}
                        </td>
                        {hideCommercials ? null : (
                          <td className="invoices-table__num">
                            {formatCurrency(
                              category === 'all'
                                ? row.amount
                                : Number(row.categoryAmounts[category] ?? row.amount ?? 0),
                              row.currencyCode,
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="invoices-mobile-list admin-invoices-mobile-list">
                <div className="invoices-mobile-list__head" aria-hidden>
                  <span>Order</span>
                  {hideCommercials ? <span>Qty</span> : <span>Amount</span>}
                </div>
                {pageRows.map(row => (
                  <button
                    key={row.key}
                    type="button"
                    data-so-id={row.id}
                    className={[
                      'invoices-mobile-row invoices-mobile-row--po-stack unified-so-mobile-row',
                      row.sealKind ? 'unified-so-mobile-row--with-seal' : '',
                      highlightedOrderId === row.id ? 'invoices-mobile-row--return-focus' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => openRow(row)}
                    onMouseDown={preventMouseFocusScroll}
                    aria-label={`View ${row.primaryNumber}${row.sealKind ? `, ${row.statusLabel}` : ''}`}
                  >
                    <SalesOrderTileLeadIcon
                      category={row.category}
                      categories={row.categories}
                      freightSku={row.freightSku}
                    />
                    <span className="invoices-mobile-row__body">
                      <span className="invoices-mobile-row__invoice">
                        <span className="invoices-mobile-row__pair">
                          {hideCommercials ? (
                            <strong className="invoices-mobile-row__amount-value">
                              Qty {formatInvoiceItemQuantity(row.qty)}
                            </strong>
                          ) : (
                            <strong className="invoices-mobile-row__amount-value">
                              {formatCurrency(
                                category === 'all'
                                  ? row.amount
                                  : Number(row.categoryAmounts[category] ?? row.amount ?? 0),
                                row.currencyCode,
                              )}
                            </strong>
                          )}
                        </span>
                        <strong className="invoices-mobile-row__company unified-so-mobile-row__number">
                          {row.primaryNumber}
                        </strong>
                        <span className="invoices-mobile-row__pair unified-so-mobile-row__footer">
                          <span className="invoices-mobile-row__meta">
                            {formatInvoiceDateTime(row.date, row.createdTime)}
                            {hideCommercials
                              ? null
                              : ` • Qty ${formatInvoiceItemQuantity(row.qty)}`}
                          </span>
                          <span className={row.statusClass}>{row.statusLabel}</span>
                        </span>
                      </span>
                    </span>
                    {row.sealKind ? (
                      <SalesOrderStageSeal kind={row.sealKind} size="tile" />
                    ) : null}
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
