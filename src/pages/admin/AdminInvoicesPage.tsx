import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  FileText,
  IndianRupee,
  LayoutGrid,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { salespersonScopeForUser } from '../../lib/salespersonScope';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  DealerMultiFilterPicker,
  type DealerFilterSelection,
} from '../../components/dealers/DealerMultiFilterPicker';
import {
  InvoiceCategoryBadgeList,
  InvoiceCategoryIcon,
} from '../../components/invoices/InvoiceCategoryVisual';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  aggregateAdminInvoicesByDealer,
  countInvoiceRowsByCategory,
  fetchAdminCustomerLocations,
  fetchAdminDealerLifetimeAggregates,
  fetchAdminInvoicesForCustomers,
  fetchAdminInvoicesPageResult,
  fetchAdminPortalStampingInvoices,
  fetchAllAdminInvoicesInRange,
  filterAdminInvoices,
  formatAdminCustomerLocation,
  loadAdminInvoiceKpis,
  toInvoiceDateKey,
  type AdminFirestoreInvoice,
  type AdminInvoiceCategoryCounts,
  type AdminInvoiceSort,
} from '../../lib/admin-invoices';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { formatCurrency } from '../../lib/catalog';
import { fetchDealerById } from '../../lib/dealers';
import {
  formatInvoiceDate,
  formatInvoiceItemQuantity,
  formatKpiPeriodRange,
  getInvoicePeriodBounds,
  invoiceAmountExclGst,
  invoiceCategoryAmount,
  invoiceCategoryLabel,
  invoiceStatusLabel,
} from '../../lib/invoices';
import { invoiceListLogisticsStatus } from '../../lib/logisticsBooking';
import { findLogisticsBookingsForInvoices } from '../../lib/logisticsBookings';
import { useRevealScrollbarOnScroll } from '../../lib/useRevealScrollbarOnScroll';
import type { LogisticsBooking } from '../../types/logistics-dispatch';
import type { InvoiceCategory, SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

const LIST_PAGE_SIZE = 25;
const DEFAULT_RANGE: SalesRangePreset = 'current_month';
const DEFAULT_SORT: AdminInvoiceSort = 'date';
const DEFAULT_CATEGORY: InvoiceCategory | 'all' = 'all';

const CATEGORY_BLOCKS: Array<{ value: InvoiceCategory | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'product', label: 'Product' },
  { value: 'spare', label: 'Spares' },
  { value: 'software_key', label: 'Software' },
  { value: 'service', label: 'Service' },
  { value: 'gatc', label: 'Stamping' },
];

const EMPTY_CATEGORY_COUNTS: AdminInvoiceCategoryCounts = {
  all: 0,
  product: 0,
  spare: 0,
  software_key: 0,
  service: 0,
  gatc: 0,
};

const SORT_OPTIONS: Array<{ value: AdminInvoiceSort; label: string }> = [
  { value: 'date', label: 'Invoice date' },
  { value: 'syncedAt', label: 'Most recently updated' },
];

function invoiceStatusClass(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return `invoices-status invoices-status--${key}`;
}

/** Prefer logistics status past Booked; otherwise Zoho invoice payment status. */
function invoiceRowStatusDisplay(
  invoiceStatus: string,
  booking: LogisticsBooking | undefined,
): { label: string; className: string } {
  const logistics = invoiceListLogisticsStatus(booking);
  if (logistics) {
    const tone = logistics.status === 'in_transit'
      ? 'sent'
      : logistics.status === 'delivered'
        ? 'delivered'
        : logistics.status === 'cancelled'
          ? 'void'
          : 'overdue';
    return {
      label: logistics.label,
      className: invoiceStatusClass(tone),
    };
  }
  return {
    label: invoiceStatusLabel(invoiceStatus),
    className: invoiceStatusClass(invoiceStatus),
  };
}

function AdminFilterSheet({
  open,
  rangePreset,
  sort,
  dealers,
  aggregate,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  sort: AdminInvoiceSort;
  dealers: DealerFilterSelection[];
  aggregate: boolean;
  onClose: () => void;
  onApply: (next: {
    rangePreset: SalesRangePreset;
    sort: AdminInvoiceSort;
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
        aria-label="Filter invoices"
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

            <label className="logistics-filter-supermode">
              <span className="logistics-filter-supermode__copy">
                <strong>Aggregate</strong>
                <em>
                  Club invoices into one row per dealer
                  {draftRange === 'lifetime'
                    ? ' (Lifetime uses precomputed dealer totals)'
                    : ''}
                </em>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={draftAggregate}
                aria-label="Aggregate invoices by dealer"
                className={[
                  'logistics-filter-supermode__switch',
                  draftAggregate ? 'logistics-filter-supermode__switch--on' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  setDraftAggregate(prev => !prev);
                }}
              >
                <span className="logistics-filter-supermode__knob" />
              </button>
            </label>

            <div className="catalog-spares-multi-filters__group">
              <span className="catalog-spares-multi-filters__label">Date range</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Date range">
                {SALES_RANGE_OPTIONS.map(option => {
                  const checked = draftRange === option.value;
                  const id = `admin-invoice-range-${String(option.value)}`;
                  return (
                    <label key={String(option.value)} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="admin-invoice-date-range"
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
              <span className="catalog-spares-multi-filters__label">Sort by</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Sort by">
                {SORT_OPTIONS.map(option => {
                  const checked = draftSort === option.value;
                  const id = `admin-invoice-sort-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="admin-invoice-sort"
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
                  sort: draftSort,
                  dealers: draftDealers,
                  aggregate: draftAggregate,
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

export const AdminInvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const basePath = pathname.startsWith('/staff') ? '/staff' : '/super-admin';
  const salespersonIds = useMemo(() => salespersonScopeForUser(user), [user]);
  const salespersonScopeKey = salespersonIds?.slice().sort().join(',') ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const scrollRef = useRevealScrollbarOnScroll();
  const [rows, setRows] = useState<AdminFirestoreInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminInvoiceSort>(DEFAULT_SORT);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [category, setCategory] = useState<InvoiceCategory | 'all'>(DEFAULT_CATEGORY);
  const [aggregate, setAggregate] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedDealers, setSelectedDealers] = useState<DealerFilterSelection[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<AdminInvoiceCategoryCounts>(EMPTY_CATEGORY_COUNTS);
  const [kpiCategoryAmount, setKpiCategoryAmount] = useState(0);
  const [kpiDocumentAmount, setKpiDocumentAmount] = useState(0);
  const [kpiCount, setKpiCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pageCursors, setPageCursors] = useState<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const [customerLocations, setCustomerLocations] = useState(
    () => new Map<string, { district: string | null; state: string | null }>(),
  );
  const [logisticsByInvoiceId, setLogisticsByInvoiceId] = useState(
    () => new Map<string, LogisticsBooking>(),
  );

  const dealerFilterFromUrl = searchParams.get('dealerId')?.trim() || '';
  const dealersParam = searchParams.get('dealers') || '';
  const dealersFromUrl = useMemo(
    () => dealersParam.split(',').map(id => id.trim()).filter(Boolean),
    [dealersParam],
  );
  const selectedCustomerIds = useMemo(
    () => selectedDealers.map(d => d.id).filter(Boolean),
    [selectedDealers],
  );
  const dealerScoped = selectedCustomerIds.length > 0;
  const selectedCustomerKey = selectedCustomerIds.slice().sort().join(',');

  const bounds = getInvoicePeriodBounds(rangePreset);
  const dateStart = bounds ? toInvoiceDateKey(bounds.start) : null;
  const dateEnd = bounds ? toInvoiceDateKey(bounds.end) : null;
  const orgWide = salespersonIds == null;
  const lifetimeAggregateAllowed = rangePreset === 'lifetime' && orgWide;
  const aggregateAllowed = Boolean(dateStart && dateEnd) || dealerScoped || lifetimeAggregateAllowed;
  const useAggregate = aggregate && aggregateAllowed;
  const useLifetimeDealerRollups = useAggregate && lifetimeAggregateAllowed && !dealerScoped;

  useEffect(() => {
    if (aggregate && !aggregateAllowed) setAggregate(false);
  }, [aggregate, aggregateAllowed]);

  useEffect(() => {
    const ids = dealerFilterFromUrl
      ? [dealerFilterFromUrl]
      : dealersFromUrl;
    if (!ids.length) {
      setSelectedDealers([]);
      return;
    }
    let cancelled = false;
    void Promise.all(ids.map(async id => {
      try {
        const dealer = await fetchDealerById(id);
        return {
          id,
          label: dealer.companyName || dealer.contactName || id,
          portalUserId: dealer.portalUserId ?? null,
        } satisfies DealerFilterSelection;
      } catch {
        return { id, label: id, portalUserId: null } satisfies DealerFilterSelection;
      }
    })).then(list => {
      if (!cancelled) setSelectedDealers(list);
    });
    return () => {
      cancelled = true;
    };
  }, [dealerFilterFromUrl, dealersFromUrl]);

  const syncDealerParams = useCallback((dealers: DealerFilterSelection[]) => {
    const next = new URLSearchParams(searchParams);
    next.delete('dealerId');
    if (!dealers.length) {
      next.delete('dealers');
    } else {
      next.set('dealers', dealers.map(d => d.id).join(','));
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // KPI + category counts (rollups when available, else cheap count/sum queries).
  useEffect(() => {
    if (dealerScoped) return;
    let cancelled = false;
    void loadAdminInvoiceKpis({
      dateStart,
      dateEnd,
      category: 'all',
      salespersonIds: salespersonIds,
    })
      .then(kpi => {
        if (cancelled) return;
        setCategoryCounts(kpi.categoryCounts);
        setKpiCategoryAmount(kpi.categoryAmount);
        setKpiDocumentAmount(kpi.documentAmount);
        setKpiCount(kpi.categoryCounts.all);
      })
      .catch(() => {
        if (!cancelled) {
          setCategoryCounts(EMPTY_CATEGORY_COUNTS);
          setKpiCategoryAmount(0);
          setKpiDocumentAmount(0);
          setKpiCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dateStart, dateEnd, salespersonIds, salespersonScopeKey, dealerScoped]);

  // Refresh amount when category tab changes (rollup path already has by-category amounts).
  useEffect(() => {
    if (dealerScoped) return;
    let cancelled = false;
    void loadAdminInvoiceKpis({
      dateStart,
      dateEnd,
      category,
      salespersonIds: salespersonIds,
    })
      .then(kpi => {
        if (cancelled) return;
        setKpiCategoryAmount(kpi.categoryAmount);
        setKpiDocumentAmount(kpi.documentAmount);
        setKpiCount(category === 'all' ? kpi.categoryCounts.all : kpi.categoryCounts[category]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [category, dateStart, dateEnd, salespersonIds, salespersonScopeKey, dealerScoped]);

  // Org-wide: cursor-paginated list (or bounded aggregate scan).
  useEffect(() => {
    if (dealerScoped) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setTruncated(false);

    if (useAggregate) {
      const load = useLifetimeDealerRollups
        ? fetchAdminDealerLifetimeAggregates().then(next => ({ rows: next, truncated: false }))
        : category === 'gatc'
          ? fetchAdminPortalStampingInvoices({
            sort,
            dateStart,
            dateEnd,
            salespersonIds,
          }).then(next => ({ rows: next.rows, truncated: false }))
          : fetchAllAdminInvoicesInRange({
            sort,
            category: 'all',
            dateStart,
            dateEnd,
            salespersonIds,
          });

      void load
        .then(({ rows: next, truncated: wasTruncated }) => {
          if (cancelled) return;
          setRows(next);
          setTruncated(wasTruncated);
          setHasMore(false);
          setPageCursors([null]);
        })
        .catch(err => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Could not load invoices.');
            setRows([]);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    // Stamping = portal GATC Billwise set; load full window and page client-side.
    if (category === 'gatc') {
      void fetchAdminPortalStampingInvoices({
        sort,
        dateStart,
        dateEnd,
        salespersonIds,
      })
        .then(({ rows: next }) => {
          if (cancelled) return;
          setRows(next);
          setHasMore(false);
          setPageCursors([null]);
        })
        .catch(err => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Could not load invoices.');
            setRows([]);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    const cursor = pageCursors[page - 1] ?? null;
    void fetchAdminInvoicesPageResult({
      sort,
      pageSize: LIST_PAGE_SIZE,
      cursor,
      category,
      dateStart,
      dateEnd,
      salespersonIds,
    })
      .then(({ rows: next, lastDoc, hasMore: more }) => {
        if (cancelled) return;
        setRows(next);
        setHasMore(more);
        if (more && lastDoc) {
          setPageCursors(prev => {
            const copy = prev.slice(0, page);
            copy[page] = lastDoc;
            return copy;
          });
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load invoices.');
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  // pageCursors intentionally omitted — page index drives cursor lookup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sort,
    dealerScoped,
    dateStart,
    dateEnd,
    salespersonIds,
    salespersonScopeKey,
    useAggregate,
    useLifetimeDealerRollups,
    category,
    page,
  ]);

  // Reset cursor stack when filters change.
  useEffect(() => {
    setPage(1);
    setPageCursors([null]);
  }, [search, rangePreset, category, sort, selectedCustomerKey, useAggregate, salespersonScopeKey]);

  // Dealer-scoped: fetch invoices for selected customers in the date window.
  useEffect(() => {
    if (!dealerScoped) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setTruncated(false);
    void Promise.all([
      fetchAdminInvoicesForCustomers({
        customerIds: selectedCustomerIds,
        dateStart,
        dateEnd,
        category: 'all',
        sort,
        // Dealer drill-down: any ops staff may see that dealer's full invoice history.
        salespersonIds: null,
      }),
      fetchAdminPortalStampingInvoices({
        customerIds: selectedCustomerIds,
        dateStart,
        dateEnd,
        sort,
        salespersonIds: null,
      }),
    ])
      .then(([allRows, portal]) => {
        if (cancelled) return;
        const counts = countInvoiceRowsByCategory(allRows);
        counts.gatc = portal.rows.length;
        setCategoryCounts(counts);
        setKpiCount(allRows.length);
        setKpiDocumentAmount(allRows.reduce((sum, row) => sum + invoiceAmountExclGst(row), 0));
        if (category === 'gatc') {
          setRows(portal.rows);
          setKpiCategoryAmount(portal.gatcFeeTotal);
        } else {
          setRows(allRows);
          setKpiCategoryAmount(
            category === 'all'
              ? allRows.reduce((sum, row) => sum + invoiceAmountExclGst(row), 0)
              : allRows.reduce((sum, row) => sum + invoiceCategoryAmount(row, category), 0),
          );
        }
        setHasMore(false);
        setPageCursors([null]);
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load invoices.');
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    dealerScoped,
    selectedCustomerKey,
    dateStart,
    dateEnd,
    sort,
    selectedCustomerIds,
    category,
  ]);

  const filtered = useMemo(
    () => filterAdminInvoices(
      rows,
      search,
      // Portal stamping rows are pre-filtered; avoid HSN re-filter dropping them.
      category === 'gatc'
        ? 'all'
        : (useAggregate || dealerScoped ? category : 'all'),
    ),
    [rows, search, category, useAggregate, dealerScoped],
  );

  const displayRows = useMemo(
    () => (useAggregate
      ? (useLifetimeDealerRollups
        ? filtered
        : aggregateAdminInvoicesByDealer(filtered, sort))
      : filtered),
    [useAggregate, useLifetimeDealerRollups, filtered, sort],
  );

  // Client-side pagination for aggregate / dealer-scoped / portal stamping dumps.
  const clientPaged = useAggregate || dealerScoped || category === 'gatc';
  const totalCount = clientPaged
    ? displayRows.length
    : (search.trim()
      ? displayRows.length
      : (category === 'all' ? categoryCounts.all : categoryCounts[category]));
  const totalPages = clientPaged
    ? Math.max(1, Math.ceil(displayRows.length / LIST_PAGE_SIZE))
    : Math.max(1, Math.ceil(totalCount / LIST_PAGE_SIZE) || 1);

  const pageRows = useMemo(() => {
    if (!clientPaged) return displayRows;
    const start = (page - 1) * LIST_PAGE_SIZE;
    return displayRows.slice(start, start + LIST_PAGE_SIZE);
  }, [displayRows, page, clientPaged]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    const customerIds = pageRows.map(invoice => invoice.customerId);
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

  useEffect(() => {
    const invoiceIds = pageRows
      .filter(invoice => (invoice.aggregateInvoiceCount ?? 0) <= 1)
      .map(invoice => invoice.id);
    if (!invoiceIds.length) {
      setLogisticsByInvoiceId(new Map());
      return;
    }

    let cancelled = false;
    void findLogisticsBookingsForInvoices(invoiceIds)
      .then(map => {
        if (!cancelled) setLogisticsByInvoiceId(map);
      })
      .catch(() => {
        if (!cancelled) setLogisticsByInvoiceId(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, [pageRows]);

  const openInvoice = (invoice: AdminFirestoreInvoice) => {
    navigate(`${basePath}/invoices/${invoice.customerId}/${invoice.id}/invoice`);
  };

  const openAggregatedDealer = useCallback((invoice: AdminFirestoreInvoice) => {
    if (!invoice.customerId) return;
    const dealer: DealerFilterSelection = {
      id: invoice.customerId,
      label: invoice.customerName?.trim() || invoice.customerId,
      portalUserId: null,
    };
    setAggregate(false);
    setSelectedDealers([dealer]);
    syncDealerParams([dealer]);
  }, [syncDealerParams]);

  const openRow = (invoice: AdminFirestoreInvoice) => {
    if ((invoice.aggregateInvoiceCount ?? 0) > 1) {
      openAggregatedDealer(invoice);
      return;
    }
    openInvoice(invoice);
  };

  const summary = useMemo(() => {
    const boundsForRange = getInvoicePeriodBounds(rangePreset);
    const countFromTabs = !search.trim()
      ? (category === 'all' ? categoryCounts.all : categoryCounts[category])
      : displayRows.length;
    return {
      invoiceCount: dealerScoped
        ? (search.trim() ? displayRows.length : filtered.length)
        : (countFromTabs || kpiCount),
      categorySales: dealerScoped
        ? (category === 'all'
          ? filtered.reduce((sum, row) => sum + invoiceAmountExclGst(row), 0)
          : filtered.reduce((sum, row) => sum + invoiceCategoryAmount(row, category), 0))
        : kpiCategoryAmount,
      documentSales: dealerScoped
        ? filtered.reduce((sum, row) => sum + invoiceAmountExclGst(row), 0)
        : kpiDocumentAmount,
      periodStart: boundsForRange?.start?.toISOString() ?? null,
      periodEnd: boundsForRange?.end?.toISOString() ?? new Date().toISOString(),
    };
  }, [
    rangePreset,
    search,
    category,
    categoryCounts,
    displayRows.length,
    dealerScoped,
    filtered,
    kpiCount,
    kpiCategoryAmount,
    kpiDocumentAmount,
  ]);

  const dateRange = formatKpiPeriodRange(summary.periodStart, summary.periodEnd);
  const hasActiveFilters = rangePreset !== DEFAULT_RANGE
    || sort !== DEFAULT_SORT
    || selectedDealers.length > 0
    || aggregate;

  const canGoNext = clientPaged ? page < totalPages : (hasMore || page < totalPages);
  const rangeLabelStart = clientPaged
    ? (page - 1) * LIST_PAGE_SIZE + 1
    : (page - 1) * LIST_PAGE_SIZE + 1;
  const rangeLabelEnd = clientPaged
    ? Math.min(page * LIST_PAGE_SIZE, displayRows.length)
    : Math.min(page * LIST_PAGE_SIZE, (page - 1) * LIST_PAGE_SIZE + pageRows.length);
  const rangeLabelTotal = clientPaged ? displayRows.length : totalCount;

  const headerTools = useMemo(
    () => (
      <div className="invoices-header-tools">
        <div className="catalog-search invoices-header-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search invoice #, customer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search invoices"
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
          aria-label="Filter invoices"
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
    <div className="page-content fade-in admin-invoices-page invoices-page unified-sales-orders-page">
      <section className="invoices-summary" aria-label="Invoice summary">
        <div className="invoices-summary__kpis">
          <div className="invoices-summary__kpi">
            <span className="invoices-summary__kpi-icon" aria-hidden>
              <FileText size={16} strokeWidth={2.4} />
            </span>
            <div className="invoices-summary__kpi-body">
              <span className="invoices-summary__kpi-label">Total Invoices</span>
              <strong className="invoices-summary__kpi-value">
                {loading ? '…' : summary.invoiceCount.toLocaleString('en-IN')}
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
                {loading ? '…' : formatCurrency(summary.categorySales)}
              </strong>
              <span className="invoices-summary__kpi-sub">
                {category === 'all' ? 'Amount' : `${invoiceCategoryLabel(category)} lines`}
              </span>
            </div>
          </div>
        </div>

        {(selectedDealers.length > 0 || useAggregate || truncated) && (
          <p className="unified-so-dealer-filter-note text-muted text-sm">
            {[
              selectedDealers.length > 0
                ? `Filtered to ${selectedDealers.length === 1
                  ? selectedDealers[0].label
                  : `${selectedDealers.length} dealers`}`
                : null,
              useAggregate ? 'Showing one row per dealer' : null,
              truncated ? 'Aggregate capped for performance — narrow the date range for a full club' : null,
            ].filter(Boolean).join(' · ')}
            .
          </p>
        )}

        <div className="unified-so-category-blocks" role="tablist" aria-label="Invoice category">
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

      {loading && rows.length === 0 ? (
        <FetchingLoader label="Loading invoices…" />
      ) : displayRows.length === 0 ? (
        <div className="invoices-empty panel glass">
          <FileText size={40} className="text-muted" aria-hidden />
          <p>No invoices found for this period.</p>
        </div>
      ) : (
        <>
          {(totalPages > 1 || hasMore || page > 1) && (
            <div className="invoices-pagination invoices-pagination--top" role="navigation" aria-label="Invoice list pagination">
              <span className="invoices-pagination__info text-muted text-sm">
                {rangeLabelStart}–{rangeLabelEnd} of {rangeLabelTotal.toLocaleString('en-IN')}
                {search.trim() && !clientPaged ? ' (this page)' : ''}
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
                  {page}{clientPaged ? ` / ${totalPages}` : ''}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!canGoNext || loading}
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
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th className="invoices-table__num">Qty</th>
                  <th className="invoices-table__num">Total</th>
                  <th>Category</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(invoice => {
                  const locationLabel = formatAdminCustomerLocation(
                    customerLocations.get(invoice.customerId),
                  );
                  const categoryLabel = invoiceCategoryLabel(invoice.invoiceCategory);
                  const isAggregateRow = (invoice.aggregateInvoiceCount ?? 0) > 1;
                  const rowStatus = isAggregateRow
                    ? null
                    : invoiceRowStatusDisplay(
                      invoice.status,
                      logisticsByInvoiceId.get(invoice.id),
                    );
                  return (
                    <tr
                      key={`${invoice.customerId}-${invoice.id}`}
                      className="invoices-table__row--clickable"
                      onClick={() => openRow(invoice)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openRow(invoice);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        isAggregateRow
                          ? `View invoices for ${invoice.customerName ?? 'dealer'}`
                          : `View invoice ${invoice.invoiceNumber || invoice.id}`
                      }
                    >
                      <td>
                        <strong>{invoice.invoiceNumber || invoice.id}</strong>
                        {isAggregateRow ? (
                          <div className="invoices-table__ref text-muted text-sm">
                            {invoice.customerName ?? 'Dealer total'}
                          </div>
                        ) : invoice.referenceNumber ? (
                          <div className="invoices-table__ref text-muted text-sm">
                            Order {invoice.referenceNumber}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div>{invoice.customerName ?? '—'}</div>
                        {locationLabel && (
                          <div className="invoices-table__ref text-muted text-sm">{locationLabel}</div>
                        )}
                      </td>
                      <td>{formatInvoiceDate(invoice.date)}</td>
                      <td className="invoices-table__num">{formatInvoiceItemQuantity(invoice.itemQuantity)}</td>
                      <td className="invoices-table__num">
                        {formatCurrency(
                          category === 'all'
                            ? invoiceAmountExclGst(invoice)
                            : invoiceCategoryAmount(invoice, category),
                        )}
                      </td>
                      <td>
                        {categoryLabel ? (
                          <span className="unified-so-order-cell__badges">
                            <InvoiceCategoryBadgeList
                              categories={invoice.categories}
                              invoiceCategory={invoice.invoiceCategory}
                            />
                          </span>
                        ) : (
                          <span className="text-muted">{isAggregateRow ? 'Mixed' : '—'}</span>
                        )}
                      </td>
                      <td>
                        {isAggregateRow || !rowStatus ? (
                          <span className="text-muted text-sm">
                            {invoice.aggregateInvoiceCount} invoices
                          </span>
                        ) : (
                          <span className={rowStatus.className}>{rowStatus.label}</span>
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
              <span>Invoice</span>
              <span>Amount</span>
            </div>
            {pageRows.map(invoice => {
              const locationLabel = formatAdminCustomerLocation(
                customerLocations.get(invoice.customerId),
              );
              const isAggregateRow = (invoice.aggregateInvoiceCount ?? 0) > 1;
              const rowStatus = isAggregateRow
                ? null
                : invoiceRowStatusDisplay(
                  invoice.status,
                  logisticsByInvoiceId.get(invoice.id),
                );
              return (
                <button
                  key={`${invoice.customerId}-${invoice.id}`}
                  type="button"
                  className="invoices-mobile-row"
                  onClick={() => openRow(invoice)}
                  aria-label={
                    isAggregateRow
                      ? `View invoices for ${invoice.customerName ?? 'dealer'}`
                      : `View invoice ${invoice.invoiceNumber || invoice.id}`
                  }
                >
                  <InvoiceCategoryIcon category={invoice.invoiceCategory} />
                  <span className="invoices-mobile-row__body">
                    <span className="invoices-mobile-row__invoice">
                      <span className="invoices-mobile-row__title">
                        <strong>
                          {isAggregateRow
                            ? (invoice.customerName ?? 'Dealer')
                            : (invoice.invoiceNumber || invoice.id)}
                        </strong>
                      </span>
                      <span className="invoices-mobile-row__so">
                        {isAggregateRow
                          ? `${invoice.aggregateInvoiceCount} invoices`
                          : (invoice.customerName ?? locationLabel ?? '—')}
                      </span>
                      <span className="invoices-mobile-row__meta">
                        {formatInvoiceDate(invoice.date)}
                        {' • '}
                        Qty {formatInvoiceItemQuantity(invoice.itemQuantity)}
                      </span>
                    </span>
                    <span className="invoices-mobile-row__amount">
                      <strong>
                        {formatCurrency(
                          category === 'all'
                            ? invoiceAmountExclGst(invoice)
                            : invoiceCategoryAmount(invoice, category),
                        )}
                      </strong>
                      {isAggregateRow || !rowStatus ? (
                        <span className="text-muted text-sm">Aggregated</span>
                      ) : (
                        <span className={rowStatus.className}>{rowStatus.label}</span>
                      )}
                    </span>
                  </span>
                  <span className="invoices-mobile-row__chevron" aria-hidden>
                    <ChevronRight size={18} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
          {(totalPages > 1 || hasMore || page > 1) && (
            <footer className="invoices-pagination invoices-pagination--sticky">
              <span className="invoices-pagination__info text-muted text-sm">
                {rangeLabelStart}–{rangeLabelEnd} of {rangeLabelTotal.toLocaleString('en-IN')}
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
                  {page}{clientPaged ? ` / ${totalPages}` : ''}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!canGoNext || loading}
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

      <AdminFilterSheet
        open={filterOpen}
        rangePreset={rangePreset}
        sort={sort}
        dealers={selectedDealers}
        aggregate={aggregate}
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
