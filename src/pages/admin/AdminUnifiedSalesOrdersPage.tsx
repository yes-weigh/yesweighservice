import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  InvoiceCategoryBadge,
  InvoiceCategoryIcon,
} from '../../components/invoices/InvoiceCategoryVisual';
import { OrderStatusBadge } from '../../components/orders/OrderStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  countAdminSalesOrdersByUnifiedStages,
  fetchAdminSalesOrdersPageDetailed,
  toSalesOrderDateKey,
  ZOHO_DONE_STATUSES,
  ZOHO_OPEN_STATUSES,
  ZOHO_REJECTED_STATUSES,
  type AdminFirestoreSalesOrder,
  type AdminSalesOrderSort,
} from '../../lib/admin-sales-orders';
import {
  fetchAdminCustomerLocations,
  formatAdminCustomerLocation,
} from '../../lib/admin-invoices';
import { formatCurrency } from '../../lib/catalog';
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
  filterUnifiedSalesOrders,
  getUnifiedStage,
  mapPortalOrderToUnified,
  mapZohoOrderToUnified,
  summarizeUnifiedAmounts,
  UNIFIED_STATUS_CHIPS,
  type UnifiedSalesOrderRow,
  type UnifiedSalesOrderSource,
  type UnifiedStatusChip,
} from '../../lib/unified-sales-orders';
import type { DealerOrder } from '../../types/dealer-orders';
import type { InvoiceCategory, SalesRangePreset } from '../../types/invoices';
import { INVOICE_CATEGORY_FILTER_OPTIONS, SALES_RANGE_OPTIONS } from '../../types/invoices';

const LIST_PAGE_SIZE = 25;
const SEARCH_FETCH_SIZE = 100;

function zohoStatusesForChip(chip: UnifiedStatusChip): readonly string[] | null {
  if (chip === 'so') return ZOHO_OPEN_STATUSES;
  if (chip === 'done') return ZOHO_DONE_STATUSES;
  if (chip === 'rejected') return ZOHO_REJECTED_STATUSES;
  return null;
}

function includeZohoForFilters(
  source: UnifiedSalesOrderSource | 'all',
  chip: UnifiedStatusChip,
): boolean {
  if (source === 'portal') return false;
  if (chip === 'review' || chip === 'pay' || chip === 'verify') return false;
  return true;
}

function includePortalForFilters(source: UnifiedSalesOrderSource | 'all'): boolean {
  return source !== 'zoho';
}
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
  const [countsLoading, setCountsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminSalesOrderSort>(DEFAULT_SORT);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [category, setCategory] = useState<InvoiceCategory | 'all'>(DEFAULT_CATEGORY);
  const [source, setSource] = useState<UnifiedSalesOrderSource | 'all'>(DEFAULT_SOURCE);
  const [statusChip, setStatusChip] = useState<UnifiedStatusChip>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [zohoTotal, setZohoTotal] = useState(0);
  const [zohoStageCounts, setZohoStageCounts] = useState({
    all: 0,
    so: 0,
    done: 0,
    rejected: 0,
  });
  const [customerLocations, setCustomerLocations] = useState(
    () => new Map<string, { district: string | null; state: string | null }>(),
  );
  const pageStartCursors = useRef<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const [pageCursorVersion, setPageCursorVersion] = useState(0);

  const bounds = getInvoicePeriodBounds(rangePreset);
  const dateStart = bounds ? toSalesOrderDateKey(bounds.start) : null;
  const dateEnd = bounds ? toSalesOrderDateKey(bounds.end) : null;
  const searchActive = Boolean(search.trim());
  const wantZoho = includeZohoForFilters(source, statusChip);
  const wantPortal = includePortalForFilters(source);

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

  // Reset pagination whenever filters that affect the Zoho query change.
  useEffect(() => {
    setPage(1);
    pageStartCursors.current = [null];
    setPageCursorVersion(v => v + 1);
  }, [search, rangePreset, category, sort, source, statusChip, dealerFilter]);

  // Server counts for Zoho (actual Firestore totals for the date/category window).
  useEffect(() => {
    let cancelled = false;
    if (!wantZoho) {
      setZohoStageCounts({ all: 0, so: 0, done: 0, rejected: 0 });
      setZohoTotal(0);
      setCountsLoading(false);
      return;
    }
    setCountsLoading(true);
    void countAdminSalesOrdersByUnifiedStages({
      category,
      dateStart,
      dateEnd,
    })
      .then(counts => {
        if (cancelled) return;
        setZohoStageCounts(counts);
        if (statusChip === 'all') setZohoTotal(counts.all);
        else if (statusChip === 'so') setZohoTotal(counts.so);
        else if (statusChip === 'done') setZohoTotal(counts.done);
        else if (statusChip === 'rejected') setZohoTotal(counts.rejected);
        else setZohoTotal(0);
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
  }, [wantZoho, category, dateStart, dateEnd, statusChip]);

  // Fetch the current Zoho page from Firestore.
  useEffect(() => {
    let cancelled = false;
    if (!wantZoho) {
      setZohoOrders([]);
      setZohoLoading(false);
      return;
    }

    const cursor = pageStartCursors.current[page - 1] ?? null;
    const statusIn = zohoStatusesForChip(statusChip);
    setZohoLoading(true);
    setError('');

    void fetchAdminSalesOrdersPageDetailed({
      sort,
      pageSize: searchActive ? SEARCH_FETCH_SIZE : LIST_PAGE_SIZE,
      cursor: searchActive ? null : cursor,
      category,
      dateStart,
      dateEnd,
      statusIn,
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
    wantZoho,
    page,
    pageCursorVersion,
    sort,
    category,
    dateStart,
    dateEnd,
    statusChip,
    searchActive,
  ]);

  const loading = portalLoading || zohoLoading || countsLoading;

  const portalRows = useMemo(() => {
    if (!wantPortal) return [] as UnifiedSalesOrderRow[];
    const mapped = portalOrders.map(order => mapPortalOrderToUnified(order, basePath));
    return filterUnifiedSalesOrders(mapped, {
      search,
      source: 'portal',
      statusChip,
      category,
      period: rangePreset,
    });
  }, [wantPortal, portalOrders, basePath, search, statusChip, category, rangePreset]);

  const zohoRows = useMemo(() => {
    if (!wantZoho) return [] as UnifiedSalesOrderRow[];
    let rows = zohoOrders.map(order => mapZohoOrderToUnified(order, basePath));
    if (searchActive) {
      rows = filterUnifiedSalesOrders(rows, {
        search,
        source: 'zoho',
        statusChip: 'all',
        category: 'all',
        period: undefined,
      });
    }
    return rows;
  }, [wantZoho, zohoOrders, basePath, search, searchActive]);

  const pageRows = useMemo(() => {
    if (!wantZoho) {
      const start = (page - 1) * LIST_PAGE_SIZE;
      return portalRows.slice(start, start + LIST_PAGE_SIZE);
    }
    if (searchActive) {
      const merged = [...portalRows, ...zohoRows].sort((a, b) => b.sortAt - a.sortAt);
      const start = (page - 1) * LIST_PAGE_SIZE;
      return merged.slice(start, start + LIST_PAGE_SIZE);
    }
    // Page 1: portal matches (small) + current Zoho page. Later pages: Zoho only.
    if (page === 1 && portalRows.length) {
      return [...portalRows, ...zohoRows].sort((a, b) => b.sortAt - a.sortAt);
    }
    return zohoRows;
  }, [wantZoho, searchActive, page, portalRows, zohoRows]);

  const filteredTotal = useMemo(() => {
    if (!wantZoho) return portalRows.length;
    if (searchActive) return portalRows.length + zohoRows.length;
    return portalRows.length + zohoTotal;
  }, [wantZoho, searchActive, portalRows.length, zohoRows.length, zohoTotal]);

  const totalPages = useMemo(() => {
    if (!wantZoho) return Math.max(1, Math.ceil(portalRows.length / LIST_PAGE_SIZE));
    if (searchActive) return Math.max(1, Math.ceil((portalRows.length + zohoRows.length) / LIST_PAGE_SIZE));
    if (zohoTotal <= 0) return 1;
    return Math.ceil(zohoTotal / LIST_PAGE_SIZE);
  }, [wantZoho, searchActive, portalRows.length, zohoRows.length, zohoTotal]);

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

  const stageCounts = useMemo(() => {
    const portalByStage: Record<string, number> = {
      all: 0,
      review: 0,
      so: 0,
      pay: 0,
      verify: 0,
      done: 0,
      rejected: 0,
    };
    if (wantPortal) {
      const mapped = portalOrders.map(order => mapPortalOrderToUnified(order, basePath));
      const inPeriod = filterUnifiedSalesOrders(mapped, {
        search: '',
        source: 'portal',
        statusChip: 'all',
        category,
        period: rangePreset,
      });
      portalByStage.all = inPeriod.length;
      for (const row of inPeriod) {
        const stage = getUnifiedStage(row);
        portalByStage[stage] = (portalByStage[stage] || 0) + 1;
      }
    }

    const zohoAll = wantZoho ? zohoStageCounts.all : 0;
    const zohoSo = wantZoho ? zohoStageCounts.so : 0;
    const zohoDone = wantZoho ? zohoStageCounts.done : 0;
    const zohoRejected = wantZoho ? zohoStageCounts.rejected : 0;

    return {
      all: portalByStage.all + zohoAll,
      review: portalByStage.review,
      so: portalByStage.so + zohoSo,
      pay: portalByStage.pay,
      verify: portalByStage.verify,
      done: portalByStage.done + zohoDone,
      rejected: portalByStage.rejected + zohoRejected,
    };
  }, [
    wantPortal,
    wantZoho,
    portalOrders,
    basePath,
    category,
    rangePreset,
    zohoStageCounts,
  ]);

  const summary = useMemo(() => {
    const countSummary = { count: filteredTotal, totalAmount: 0, currencyCode: null as string | null };
    const pageSummary = summarizeUnifiedAmounts(pageRows);
    return {
      count: countSummary.count,
      totalAmount: pageSummary.totalAmount,
      currencyCode: pageSummary.currencyCode,
      amountIsPageOnly: filteredTotal > pageRows.length,
    };
  }, [filteredTotal, pageRows]);

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

  const reloadZoho = useCallback(() => {
    pageStartCursors.current = [null];
    setPage(1);
    setPageCursorVersion(v => v + 1);
  }, []);

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
          onClick={() => {
            loadPortal();
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
    [search, filterOpen, hasActiveFilters, canSync, basePath, loadPortal, reloadZoho, loading],
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
                    : pageRows.length
                      ? 'Mixed currencies'
                      : formatCurrency(0)}
              </strong>
              <span className="invoices-summary__kpi-sub">
                {summary.amountIsPageOnly ? 'This page' : 'Amount'}
              </span>
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
                ? (stageCounts.all ?? 0)
                : (stageCounts[item.id as keyof typeof stageCounts] ?? 0)}
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
        ) : pageRows.length === 0 ? (
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
                {pageRows.map(row => {
                  const locationLabel = formatAdminCustomerLocation(
                    row.customerId ? customerLocations.get(row.customerId) : undefined,
                  );
                  return (
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
                        {locationLabel ? (
                          <span className="invoices-table__ref text-muted text-sm">
                            {locationLabel}
                          </span>
                        ) : null}
                        <span className="unified-so-mobile-row__status">
                          {row.source === 'portal' ? (
                            <OrderStatusBadge status={row.statusRaw} />
                          ) : (
                            <span className={row.statusClass}>{row.statusLabel}</span>
                          )}
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
