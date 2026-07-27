import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  ClipboardList,
  IndianRupee,
  LayoutGrid,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  InvoiceCategoryBadgeList,
  InvoiceCategoryIcon,
} from '../../components/invoices/InvoiceCategoryVisual';
import { SalesOrderStageSeal } from '../../components/salesOrders/SalesOrderStageSeal';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  DealerMultiFilterPicker,
  type DealerFilterSelection,
} from '../../components/dealers/DealerMultiFilterPicker';
import {
  countAdminSalesOrdersByCategory,
  countZohoRowsByCategory,
  fetchAdminSalesOrdersForCustomers,
  fetchAdminSalesOrdersPageDetailed,
  toSalesOrderDateKey,
  type AdminFirestoreSalesOrder,
  type AdminSalesOrderCategoryCounts,
  type AdminSalesOrderSort,
} from '../../lib/admin-sales-orders';
import {
  fetchAdminCustomerLocations,
  formatAdminCustomerLocation,
} from '../../lib/admin-invoices';
import { formatCurrency } from '../../lib/catalog';
import { fetchDealerById } from '../../lib/dealers';
import { salespersonScopeForUser } from '../../lib/salespersonScope';
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
  mapZohoOrderToUnified,
  summarizeUnifiedAmounts,
  type UnifiedSalesOrderRow,
} from '../../lib/unified-sales-orders';
import type { InvoiceCategory, SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

const LIST_PAGE_SIZE = 25;
const SEARCH_FETCH_SIZE = 100;

const DEFAULT_RANGE: SalesRangePreset = 'financial_year';
const DEFAULT_SORT: AdminSalesOrderSort = 'date';
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

const SORT_OPTIONS: Array<{ value: AdminSalesOrderSort; label: string }> = [
  { value: 'date', label: 'Date' },
  { value: 'syncedAt', label: 'Most recently updated' },
];

function UnifiedFilterSheet({
  open,
  rangePreset,
  sort,
  dealers,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  sort: AdminSalesOrderSort;
  dealers: DealerFilterSelection[];
  onClose: () => void;
  onApply: (next: {
    rangePreset: SalesRangePreset;
    sort: AdminSalesOrderSort;
    dealers: DealerFilterSelection[];
  }) => void;
}) {
  const [draftRange, setDraftRange] = useState(rangePreset);
  const [draftSort, setDraftSort] = useState(sort);
  const [draftDealers, setDraftDealers] = useState<DealerFilterSelection[]>(dealers);

  useEffect(() => {
    if (!open) return;
    setDraftRange(rangePreset);
    setDraftSort(sort);
    setDraftDealers(dealers);
  }, [open, rangePreset, sort, dealers]);

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
    || draftSort !== DEFAULT_SORT
    || draftDealers.length > 0;

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
              <span className="catalog-spares-multi-filters__label">Dealers</span>
              <DealerMultiFilterPicker value={draftDealers} onChange={setDraftDealers} />
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
                  sort: draftSort,
                  dealers: draftDealers,
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
                setDraftSort(DEFAULT_SORT);
                setDraftDealers([]);
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


export const AdminUnifiedSalesOrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const dealerFilterFromUrl = searchParams.get('dealerId')?.trim() || '';
  const dealersParam = searchParams.get('dealers') || '';
  const dealersFromUrl = useMemo(
    () => dealersParam.split(',').map(id => id.trim()).filter(Boolean),
    [dealersParam],
  );
  const basePath = pathname.startsWith('/staff') ? '/staff' : '/super-admin';
  const salespersonIds = useMemo(() => salespersonScopeForUser(user), [user]);
  const salespersonScopeKey = salespersonIds?.slice().sort().join(',') ?? '';
  const scrollRef = useRevealScrollbarOnScroll();

  const [zohoOrders, setZohoOrders] = useState<AdminFirestoreSalesOrder[]>([]);
  const [zohoLoading, setZohoLoading] = useState(true);
  const [countsLoading, setCountsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminSalesOrderSort>(DEFAULT_SORT);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [category, setCategory] = useState<InvoiceCategory | 'all'>(DEFAULT_CATEGORY);
  const [selectedDealers, setSelectedDealers] = useState<DealerFilterSelection[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [zohoTotal, setZohoTotal] = useState(0);
  const [zohoCategoryCounts, setZohoCategoryCounts] = useState<AdminSalesOrderCategoryCounts>(
    EMPTY_CATEGORY_COUNTS,
  );
  const [customerLocations, setCustomerLocations] = useState(
    () => new Map<string, { district: string | null; state: string | null }>(),
  );
  const pageStartCursors = useRef<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const [pageCursorVersion, setPageCursorVersion] = useState(0);
  const urlSeedDone = useRef(false);

  const bounds = getInvoicePeriodBounds(rangePreset);
  const dateStart = bounds ? toSalesOrderDateKey(bounds.start) : null;
  const dateEnd = bounds ? toSalesOrderDateKey(bounds.end) : null;
  const searchActive = Boolean(search.trim());
  const dealerScoped = selectedDealers.length > 0;
  const selectedCustomerIds = useMemo(
    () => selectedDealers.map(d => d.id),
    [selectedDealers],
  );
  const selectedCustomerKey = selectedCustomerIds.join('|');

  // Seed selection from ?dealerId= / ?dealers=
  useEffect(() => {
    if (urlSeedDone.current) return;
    const ids = dealersFromUrl.length
      ? dealersFromUrl
      : (dealerFilterFromUrl ? [dealerFilterFromUrl] : []);
    if (!ids.length) {
      urlSeedDone.current = true;
      return;
    }
    urlSeedDone.current = true;
    let cancelled = false;
    void Promise.all(
      ids.map(id => fetchDealerById(id).catch(() => null)),
    ).then(rows => {
      if (cancelled) return;
      const next: DealerFilterSelection[] = [];
      for (let i = 0; i < ids.length; i += 1) {
        const dealer = rows[i];
        next.push({
          id: ids[i],
          label: dealer?.companyName?.trim()
            || dealer?.contactName?.trim()
            || ids[i],
          portalUserId: dealer?.portalUserId ?? null,
        });
      }
      setSelectedDealers(next);
    });
    return () => {
      cancelled = true;
    };
  }, [dealerFilterFromUrl, dealersFromUrl]);

  const syncDealerParams = useCallback((dealers: DealerFilterSelection[]) => {
    const next = new URLSearchParams(searchParams);
    next.delete('dealerId');
    if (dealers.length === 0) {
      next.delete('dealers');
    } else if (dealers.length === 1) {
      next.set('dealerId', dealers[0].id);
      next.delete('dealers');
    } else {
      next.set('dealers', dealers.map(d => d.id).join(','));
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Reset pagination whenever filters that affect the Zoho query change.
  useEffect(() => {
    setPage(1);
    pageStartCursors.current = [null];
    setPageCursorVersion(v => v + 1);
  }, [search, rangePreset, category, sort, selectedCustomerKey, salespersonScopeKey]);

  // Server category counts for Zoho (org-wide). Dealer-scoped counts come from loaded rows.
  useEffect(() => {
    let cancelled = false;
    if (dealerScoped) {
      setCountsLoading(false);
      return;
    }
    setCountsLoading(true);
    void countAdminSalesOrdersByCategory({
      dateStart,
      dateEnd,
      salespersonIds,
    })
      .then(counts => {
        if (cancelled) return;
        setZohoCategoryCounts(counts);
        setZohoTotal(category === 'all' ? counts.all : counts[category]);
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
  }, [dealerScoped, dateStart, dateEnd, category, salespersonIds, salespersonScopeKey]);

  // Dealer-scoped: load full date window for selected customers (newest-first).
  useEffect(() => {
    let cancelled = false;
    if (!dealerScoped) return;
    setZohoLoading(true);
    setError('');
    void fetchAdminSalesOrdersForCustomers({
      customerIds: selectedCustomerIds,
      dateStart,
      dateEnd,
      category: 'all',
      statusIn: null,
      sort,
      salespersonIds,
    })
      .then(rows => {
        if (cancelled) return;
        setZohoOrders(rows);
        const counts = countZohoRowsByCategory(rows);
        setZohoCategoryCounts(counts);
        setZohoTotal(category === 'all' ? counts.all : counts[category]);
      })
      .catch(err => {
        if (!cancelled) {
          setError(invoiceErrorMessage(err));
          setZohoOrders([]);
          setZohoCategoryCounts(EMPTY_CATEGORY_COUNTS);
          setZohoTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setZohoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    dealerScoped,
    selectedCustomerKey,
    sort,
    dateStart,
    dateEnd,
    salespersonIds,
    salespersonScopeKey,
  ]);

  useEffect(() => {
    if (!dealerScoped) return;
    setZohoTotal(category === 'all' ? zohoCategoryCounts.all : zohoCategoryCounts[category]);
  }, [dealerScoped, category, zohoCategoryCounts]);

  // Org-wide: server-paged Zoho feed.
  useEffect(() => {
    let cancelled = false;
    if (dealerScoped) return;

    const cursor = pageStartCursors.current[page - 1] ?? null;
    setZohoLoading(true);
    setError('');

    void fetchAdminSalesOrdersPageDetailed({
      sort,
      pageSize: searchActive ? SEARCH_FETCH_SIZE : LIST_PAGE_SIZE,
      cursor: searchActive ? null : cursor,
      category,
      dateStart,
      dateEnd,
      statusIn: null,
      salespersonIds,
    })
      .then(result => {
        if (cancelled) return;
        setZohoOrders(result.rows);
        if (!searchActive && result.lastDoc) {
          pageStartCursors.current[page] = result.lastDoc;
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(invoiceErrorMessage(err));
          setZohoOrders([]);
        }
      })
      .finally(() => {
        if (!cancelled) setZohoLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    dealerScoped,
    page,
    pageCursorVersion,
    sort,
    category,
    dateStart,
    dateEnd,
    searchActive,
    salespersonIds,
    salespersonScopeKey,
  ]);

  const loading = zohoLoading || countsLoading;

  const zohoRows = useMemo(() => {
    let rows = zohoOrders.map(order => mapZohoOrderToUnified(order, basePath));
    if (dealerScoped) {
      rows = filterUnifiedSalesOrders(rows, {
        search,
        source: 'zoho',
        statusChip: 'all',
        category,
        period: undefined,
      });
    } else if (searchActive) {
      rows = filterUnifiedSalesOrders(rows, {
        search,
        source: 'zoho',
        statusChip: 'all',
        category: 'all',
        period: undefined,
      });
    }
    // Pin actionable YesOne stages to the top (not completed/invoiced).
    const sealPriority = (kind: typeof rows[number]['sealKind']) => {
      if (kind === 'under_review') return 0;
      if (kind === 'awaiting_payment') return 1;
      return 2;
    };
    return [...rows].sort((a, b) => sealPriority(a.sealKind) - sealPriority(b.sealKind));
  }, [zohoOrders, basePath, search, searchActive, dealerScoped, category]);

  const clientPaged = searchActive || dealerScoped;

  const pageRows = useMemo(() => {
    if (searchActive || dealerScoped) {
      const start = (page - 1) * LIST_PAGE_SIZE;
      return zohoRows.slice(start, start + LIST_PAGE_SIZE);
    }
    return zohoRows;
  }, [searchActive, dealerScoped, page, zohoRows]);

  const filteredTotal = useMemo(() => {
    if (searchActive || dealerScoped) return zohoRows.length;
    return zohoTotal;
  }, [searchActive, dealerScoped, zohoRows.length, zohoTotal]);

  const totalPages = useMemo(() => {
    if (clientPaged) {
      return Math.max(1, Math.ceil(filteredTotal / LIST_PAGE_SIZE));
    }
    if (zohoTotal <= 0) return 1;
    return Math.ceil(zohoTotal / LIST_PAGE_SIZE);
  }, [clientPaged, filteredTotal, zohoTotal]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    const customerIds = pageRows
      .map(row => row.customerId)
      .filter((id): id is string => Boolean(id));
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

  const categoryCounts = useMemo(() => ({
    all: zohoCategoryCounts.all,
    product: zohoCategoryCounts.product,
    spare: zohoCategoryCounts.spare,
    software_key: zohoCategoryCounts.software_key,
    service: zohoCategoryCounts.service,
    gatc: zohoCategoryCounts.gatc,
  }), [zohoCategoryCounts]);

  const summary = useMemo(() => {
    const countSummary = { count: filteredTotal, totalAmount: 0, currencyCode: null as string | null };
    const pageSummary = summarizeUnifiedAmounts(pageRows);
    const categoryAmount = category === 'all'
      ? pageSummary.totalAmount
      : pageRows.reduce((sum, row) => sum + Number(row.categoryAmounts[category] ?? row.amount ?? 0), 0);
    return {
      count: countSummary.count,
      categoryAmount,
      totalAmount: pageSummary.totalAmount,
      currencyCode: pageSummary.currencyCode,
      amountIsPageOnly: filteredTotal > pageRows.length,
    };
  }, [filteredTotal, pageRows, category]);

  const dateRange = formatKpiPeriodRange(
    bounds?.start?.toISOString?.() ?? null,
    bounds?.end?.toISOString?.() ?? new Date().toISOString(),
  );

  const hasActiveFilters = rangePreset !== DEFAULT_RANGE
    || category !== DEFAULT_CATEGORY
    || sort !== DEFAULT_SORT
    || selectedDealers.length > 0;

  const openRow = (row: UnifiedSalesOrderRow) => {
    navigate(row.href);
  };

  const reloadZoho = useCallback(() => {
    pageStartCursors.current = [null];
    setPage(1);
    setPageCursorVersion(v => v + 1);
  }, []);

  const headerTools = useMemo(
    () => (
      <div className="invoices-header-tools">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            reloadZoho();
          }}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
        <div className="catalog-search invoices-header-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search SO #, customer…"
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
    [search, filterOpen, hasActiveFilters, reloadZoho, loading],
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
              <span className="invoices-summary__kpi-sub">
                {summary.amountIsPageOnly
                  ? 'This page'
                  : (category === 'all' ? 'Amount' : 'Category lines')}
              </span>
            </div>
          </div>
          {category !== 'all' && (
            <>
              <div className="invoices-summary__divider" aria-hidden />
              <div className="invoices-summary__kpi">
                <span className="invoices-summary__kpi-icon" aria-hidden>
                  <IndianRupee size={16} strokeWidth={2.4} />
                </span>
                <div className="invoices-summary__kpi-body">
                  <span className="invoices-summary__kpi-label">Order Amount</span>
                  <strong className="invoices-summary__kpi-value invoices-summary__kpi-value--amount">
                    {loading
                      ? '…'
                      : summary.currencyCode
                        ? formatCurrency(summary.totalAmount, summary.currencyCode)
                        : pageRows.length
                          ? 'Mixed currencies'
                          : formatCurrency(0)}
                  </strong>
                  <span className="invoices-summary__kpi-sub">This page</span>
                </div>
              </div>
            </>
          )}
        </div>

        {selectedDealers.length > 0 && (
          <p className="unified-so-dealer-filter-note text-muted text-sm">
            Filtered to {selectedDealers.length === 1
              ? selectedDealers[0].label
              : `${selectedDealers.length} dealers`}
            .
          </p>
        )}

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

        {loading && pageRows.length === 0 ? (
          <FetchingLoader label="Loading sales orders…" />
        ) : pageRows.length === 0 ? (
          <div className="invoices-empty panel glass">
            <ClipboardList size={40} className="text-muted" aria-hidden />
            <p>No sales orders match these filters.</p>
          </div>
        ) : (
          <>
            {totalPages > 1 && (
              <div className="invoices-pagination invoices-pagination--top" role="navigation" aria-label="List pagination">
                <span className="invoices-pagination__info text-muted text-sm">
                  {pageRows.length
                    ? `${(page - 1) * LIST_PAGE_SIZE + 1}–${(page - 1) * LIST_PAGE_SIZE + pageRows.length}`
                    : '0'}
                  {' of '}
                  {filteredTotal.toLocaleString('en-IN')}
                  {searchActive ? ' (search sample)' : ''}
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
                      <th className="invoices-table__num">Qty</th>
                      <th className="invoices-table__num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(row => {
                      const locationLabel = formatAdminCustomerLocation(
                        row.customerId ? customerLocations.get(row.customerId) : undefined,
                      );
                      return (
                      <tr
                        key={row.key}
                        className={[
                          'invoices-table__row--clickable',
                          row.sealKind ? 'unified-so-row--with-seal' : '',
                        ].filter(Boolean).join(' ')}
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
                              {row.sealKind ? (
                                <SalesOrderStageSeal kind={row.sealKind} size="inline" />
                              ) : null}
                              <span className={row.statusClass}>{row.statusLabel}</span>
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="unified-so-order-cell">
                            <span>{row.partyName}</span>
                            {locationLabel ? (
                              <span className="invoices-table__ref text-muted text-sm">
                                {locationLabel}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="invoices-table__num">{formatInvoiceItemQuantity(row.qty)}</td>
                        <td className="invoices-table__num">{formatCurrency(row.amount, row.currencyCode)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="invoices-mobile-list admin-invoices-mobile-list">
                <div className="invoices-mobile-list__head" aria-hidden>
                  <span>Order</span>
                  <span>Amount</span>
                </div>
                {pageRows.map(row => {
                  const locationLabel = formatAdminCustomerLocation(
                    row.customerId ? customerLocations.get(row.customerId) : undefined,
                  );
                  return (
                  <button
                    key={row.key}
                    type="button"
                    className={[
                      'invoices-mobile-row',
                      'invoices-mobile-row--po-stack',
                      'unified-so-mobile-row',
                      row.sealKind ? 'unified-so-mobile-row--with-seal' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => openRow(row)}
                    aria-label={`View ${row.primaryNumber}${row.sealKind ? `, ${row.sealKind.replace(/_/g, ' ')}` : ''}`}
                  >
                    <InvoiceCategoryIcon category={row.category} />
                    <span className="invoices-mobile-row__body">
                      <span className="invoices-mobile-row__invoice">
                        <span className="invoices-mobile-row__pair">
                          <span className="invoices-mobile-row__title">
                            <InvoiceCategoryBadgeList
                              categories={row.categories}
                              invoiceCategory={row.category}
                            />
                            <strong>{row.primaryNumber}</strong>
                            <span className="invoices-mobile-row__meta unified-so-mobile-row__date">
                              {formatInvoiceDate(row.date)}
                            </span>
                          </span>
                          <strong className="invoices-mobile-row__amount-value">
                            {formatCurrency(row.amount, row.currencyCode)}
                          </strong>
                        </span>
                        <strong className="invoices-mobile-row__company">
                          {row.partyName}
                        </strong>
                        <span className="invoices-mobile-row__pair unified-so-mobile-row__footer">
                          <span className="invoices-mobile-row__meta">
                            {locationLabel ? (
                              <>
                                {locationLabel}
                                {' • '}
                              </>
                            ) : null}
                            Qty {formatInvoiceItemQuantity(row.qty)}
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
                  );
                })}
              </div>
            </div>

            {totalPages > 1 && (
              <footer className="invoices-pagination invoices-pagination--sticky">
                <span className="invoices-pagination__info text-muted text-sm">
                  {pageRows.length
                    ? `${(page - 1) * LIST_PAGE_SIZE + 1}–${(page - 1) * LIST_PAGE_SIZE + pageRows.length}`
                    : '0'}
                  {' of '}
                  {filteredTotal.toLocaleString('en-IN')}
                  {searchActive ? ' (search sample)' : ''}
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
        sort={sort}
        dealers={selectedDealers}
        onClose={() => setFilterOpen(false)}
        onApply={next => {
          setRangePreset(next.rangePreset);
          setSort(next.sort);
          setSelectedDealers(next.dealers);
          syncDealerParams(next.dealers);
        }}
      />
    </div>
  );
};
