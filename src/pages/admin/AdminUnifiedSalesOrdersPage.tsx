import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  ClipboardList,
  Plus,
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
import {
  EMPTY_STAGE_COUNTS,
  SalesOrderStageFilterBlocks,
} from '../../components/salesOrders/SalesOrderStageFilterBlocks';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  DealerMultiFilterPicker,
  type DealerFilterSelection,
} from '../../components/dealers/DealerMultiFilterPicker';
import { hasStaffPermission } from '../../lib/staffAccess';
import {
  aggregateAdminSalesOrdersByDealer,
  countZohoRowsByCategory,
  fetchAdminSalesOrderDealerLifetimeAggregates,
  fetchAdminSalesOrdersForCustomers,
  fetchAdminSalesOrdersPageDetailed,
  fetchAllAdminSalesOrdersInRange,
  filterAdminSalesOrders,
  loadAdminSalesOrderKpis,
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
  getInvoicePeriodBounds,
  invoiceErrorMessage,
} from '../../lib/invoices';
import { useRevealScrollbarOnScroll } from '../../lib/useRevealScrollbarOnScroll';
import {
  compareSalesOrderNumberDesc,
  filterUnifiedSalesOrders,
  mapZohoOrderToUnified,
  countYesOneStages,
  type UnifiedSalesOrderRow,
} from '../../lib/unified-sales-orders';
import type { InvoiceCategory, SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';
import type { YesOneStageFilter } from '../../lib/salesOrderWorkflow';

const LIST_PAGE_SIZE = 25;
const SEARCH_FETCH_SIZE = 100;

const DEFAULT_RANGE: SalesRangePreset = 'financial_year';
const DEFAULT_SORT: AdminSalesOrderSort = 'date';
const DEFAULT_CATEGORY: InvoiceCategory | 'all' = 'all';

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
  aggregate,
  aggregateAllowed,
  lifetimeAggregateAllowed,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  sort: AdminSalesOrderSort;
  dealers: DealerFilterSelection[];
  aggregate: boolean;
  aggregateAllowed: boolean;
  lifetimeAggregateAllowed: boolean;
  onClose: () => void;
  onApply: (next: {
    rangePreset: SalesRangePreset;
    sort: AdminSalesOrderSort;
    dealers: DealerFilterSelection[];
    aggregate: boolean;
  }) => void;
}) {
  const [draftRange, setDraftRange] = useState(rangePreset);
  const [draftSort, setDraftSort] = useState(sort);
  const [draftDealers, setDraftDealers] = useState<DealerFilterSelection[]>(dealers);
  const [draftAggregate, setDraftAggregate] = useState(aggregate);

  useEffect(() => {
    if (!open) return;
    setDraftRange(rangePreset);
    setDraftSort(sort);
    setDraftDealers(dealers);
    setDraftAggregate(aggregate);
  }, [open, rangePreset, sort, dealers, aggregate]);

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
    || draftDealers.length > 0
    || draftAggregate;

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

            <div className="catalog-spares-multi-filters__group">
              <div className="logistics-filter-supermode">
                <div className="logistics-filter-supermode__copy">
                  <strong>Aggregate</strong>
                  <span className="text-muted text-sm">
                    {aggregateAllowed
                      ? (lifetimeAggregateAllowed
                        ? 'One row per dealer — Lifetime uses precomputed dealer totals'
                        : 'One row per dealer for the selected period')
                      : 'Pick a date range (or dealers) to enable'}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draftAggregate}
                  aria-label="Aggregate sales orders by dealer"
                  disabled={!aggregateAllowed && !draftAggregate}
                  className={[
                    'logistics-filter-supermode__switch',
                    draftAggregate ? 'logistics-filter-supermode__switch--on' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    if (!aggregateAllowed && !draftAggregate) return;
                    setDraftAggregate(prev => !prev);
                  }}
                >
                  <span className="logistics-filter-supermode__knob" />
                </button>
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
                  aggregate: draftAggregate && aggregateAllowed,
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
                setDraftAggregate(false);
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
  const isStaffList = basePath === '/staff';
  const canCreateStaffOrder = isStaffList && hasStaffPermission(user, 'orders.manage');
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
  const category = DEFAULT_CATEGORY;
  const [stageFilter, setStageFilter] = useState<YesOneStageFilter | 'all'>('all');
  const [selectedDealers, setSelectedDealers] = useState<DealerFilterSelection[]>([]);
  const [aggregate, setAggregate] = useState(false);
  const [truncated, setTruncated] = useState(false);
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
  const orgWide = salespersonIds == null;
  const lifetimeAggregateAllowed = rangePreset === 'lifetime' && orgWide && !dealerScoped;
  const aggregateAllowed = Boolean(dateStart && dateEnd) || dealerScoped || lifetimeAggregateAllowed;
  const useAggregate = aggregate && aggregateAllowed;
  const useLifetimeDealerRollups = useAggregate && lifetimeAggregateAllowed;
  const selectedCustomerIds = useMemo(
    () => selectedDealers.map(d => d.id),
    [selectedDealers],
  );
  const selectedCustomerKey = selectedCustomerIds.join('|');

  useEffect(() => {
    if (aggregate && !aggregateAllowed) setAggregate(false);
  }, [aggregate, aggregateAllowed]);

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
  }, [search, rangePreset, category, stageFilter, sort, selectedCustomerKey, useAggregate, salespersonScopeKey]);

  // Server category counts (org-wide rollups when available).
  useEffect(() => {
    let cancelled = false;
    if (dealerScoped) {
      setCountsLoading(false);
      return;
    }
    setCountsLoading(true);
    void loadAdminSalesOrderKpis({
      dateStart,
      dateEnd,
      category,
      salespersonIds,
    })
      .then(kpi => {
        if (cancelled) return;
        setZohoCategoryCounts(kpi.categoryCounts);
        setZohoTotal(kpi.orderCount);
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

  // Org-wide: server-paged Zoho feed (or bounded aggregate scan).
  useEffect(() => {
    let cancelled = false;
    if (dealerScoped) return;

    setZohoLoading(true);
    setError('');
    setTruncated(false);

    if (useAggregate) {
      const load = useLifetimeDealerRollups
        ? fetchAdminSalesOrderDealerLifetimeAggregates().then(rows => ({
          rows,
          truncated: false,
        }))
        : fetchAllAdminSalesOrdersInRange({
          sort,
          category: 'all',
          dateStart,
          dateEnd,
          statusIn: null,
          salespersonIds,
        });

      void load
        .then(({ rows, truncated: wasTruncated }) => {
          if (cancelled) return;
          setZohoOrders(rows);
          setTruncated(wasTruncated);
          if (!useLifetimeDealerRollups) {
            setZohoCategoryCounts(countZohoRowsByCategory(rows));
            setZohoTotal(rows.length);
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
    }

    const cursor = pageStartCursors.current[page - 1] ?? null;

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
    useAggregate,
    useLifetimeDealerRollups,
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

  const mappedRows = useMemo(() => {
    let source = zohoOrders;
    if (useAggregate && !dealerScoped && !useLifetimeDealerRollups) {
      const prefiltered = filterAdminSalesOrders(zohoOrders, search, category);
      source = aggregateAdminSalesOrdersByDealer(prefiltered, sort);
    } else if (useAggregate && useLifetimeDealerRollups && (search.trim() || category !== 'all')) {
      source = filterAdminSalesOrders(zohoOrders, search, category);
    }

    let rows = source.map(order => mapZohoOrderToUnified(order, basePath, 'admin'));
    if (dealerScoped) {
      rows = filterUnifiedSalesOrders(rows, {
        search,
        source: 'zoho',
        statusChip: 'all',
        category,
        period: undefined,
      });
    } else if (searchActive && !useAggregate) {
      rows = filterUnifiedSalesOrders(rows, {
        search,
        source: 'zoho',
        statusChip: 'all',
        category: 'all',
        period: undefined,
      });
    }
    // Pin actionable YesOne stages to the top (not completed/invoiced),
    // then highest SO number within each group.
    const sealPriority = (kind: typeof rows[number]['sealKind']) => {
      if (kind === 'under_review') return 0;
      if (kind === 'awaiting_payment') return 1;
      return 2;
    };
    return [...rows].sort((a, b) => {
      const bySeal = sealPriority(a.sealKind) - sealPriority(b.sealKind);
      if (bySeal) return bySeal;
      return compareSalesOrderNumberDesc(a.primaryNumber, b.primaryNumber);
    });
  }, [
    zohoOrders,
    basePath,
    search,
    searchActive,
    dealerScoped,
    category,
    useAggregate,
    useLifetimeDealerRollups,
    sort,
  ]);

  const stageCounts = useMemo(
    () => (mappedRows.length ? countYesOneStages(mappedRows) : EMPTY_STAGE_COUNTS),
    [mappedRows],
  );

  const zohoRows = useMemo(() => {
    if (stageFilter === 'all') return mappedRows;
    return filterUnifiedSalesOrders(mappedRows, { yesOneStage: stageFilter });
  }, [mappedRows, stageFilter]);

  const clientPaged = searchActive || dealerScoped || useAggregate || stageFilter !== 'all';

  const pageRows = useMemo(() => {
    if (clientPaged) {
      const start = (page - 1) * LIST_PAGE_SIZE;
      return zohoRows.slice(start, start + LIST_PAGE_SIZE);
    }
    return zohoRows;
  }, [clientPaged, page, zohoRows]);

  const filteredTotal = useMemo(() => {
    if (clientPaged) return zohoRows.length;
    return zohoTotal;
  }, [clientPaged, zohoRows.length, zohoTotal]);

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

  const hasActiveFilters = rangePreset !== DEFAULT_RANGE
    || stageFilter !== 'all'
    || sort !== DEFAULT_SORT
    || selectedDealers.length > 0
    || aggregate;

  const openAggregatedDealer = useCallback((row: UnifiedSalesOrderRow) => {
    if (!row.customerId) return;
    const dealer: DealerFilterSelection = {
      id: row.customerId,
      label: row.partyName || row.customerId,
      portalUserId: null,
    };
    setAggregate(false);
    setSelectedDealers([dealer]);
    syncDealerParams([dealer]);
  }, [syncDealerParams]);

  const openRow = (row: UnifiedSalesOrderRow) => {
    if (useAggregate && row.customerId && String(row.id).startsWith('agg-')) {
      openAggregatedDealer(row);
      return;
    }
    navigate(row.href);
  };

  const headerTools = useMemo(
    () => (
      <div className="invoices-header-tools">
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
        {canCreateStaffOrder ? (
          <button
            type="button"
            className="catalog-header-filter-btn unified-so-create-header-btn"
            onClick={() => navigate(`${basePath}/sales-orders/new`)}
            aria-label="Create sales order"
            title="Create sales order"
          >
            <Plus size={20} strokeWidth={2.25} />
          </button>
        ) : null}
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
    [search, filterOpen, hasActiveFilters, canCreateStaffOrder, navigate, basePath],
  );

  useCatalogPageHeader({ mobileCompactHeader: true, title: 'Sales orders' }, true);
  usePageHeaderSlot(headerTools);

  return (
    <div className="page-content fade-in admin-invoices-page invoices-page unified-sales-orders-page">
      {canCreateStaffOrder ? (
        <div className="unified-so-create-bar">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => navigate(`${basePath}/sales-orders/new`)}
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden />
            New sales order
          </button>
        </div>
      ) : null}
      {canCreateStaffOrder ? (
        <button
          type="button"
          className="unified-so-create-fab"
          onClick={() => navigate(`${basePath}/sales-orders/new`)}
          aria-label="Create sales order"
          title="Create sales order"
        >
          <Plus size={24} strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
      <section className="invoices-summary" aria-label="Sales order summary">
        {(selectedDealers.length > 0 || useAggregate || truncated) && (
          <p className="unified-so-dealer-filter-note text-muted text-sm">
            {[
              selectedDealers.length > 0
                ? `Filtered to ${selectedDealers.length === 1
                  ? selectedDealers[0].label
                  : `${selectedDealers.length} dealers`}`
                : null,
              useAggregate ? 'Showing one row per dealer' : null,
              truncated ? 'Amount scan truncated at cap' : null,
            ].filter(Boolean).join(' · ')}.
          </p>
        )}

        <SalesOrderStageFilterBlocks
          audience="admin"
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
                              {row.priceCustomized ? (
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
                        <td className="invoices-table__num">
                          {formatCurrency(
                            category === 'all'
                              ? row.amount
                              : Number(row.categoryAmounts[category] ?? row.amount ?? 0),
                            row.currencyCode,
                          )}
                        </td>
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
                            <strong>{row.primaryNumber}</strong>
                            <span className="invoices-mobile-row__meta unified-so-mobile-row__date">
                              {formatInvoiceDate(row.date)}
                            </span>
                          </span>
                          <strong className="invoices-mobile-row__amount-value">
                            {formatCurrency(
                              category === 'all'
                                ? row.amount
                                : Number(row.categoryAmounts[category] ?? row.amount ?? 0),
                              row.currencyCode,
                            )}
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
        aggregate={aggregate}
        aggregateAllowed={aggregateAllowed}
        lifetimeAggregateAllowed={lifetimeAggregateAllowed}
        onClose={() => setFilterOpen(false)}
        onApply={next => {
          setRangePreset(next.rangePreset);
          setSort(next.sort);
          setSelectedDealers(next.dealers);
          setAggregate(next.aggregate);
          syncDealerParams(next.dealers);
        }}
      />
    </div>
  );
};
