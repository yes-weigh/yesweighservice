import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  AlertCircle,
  FileText,
  CalendarClock,
  LayoutGrid,
  PackageCheck,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { GoodsReceiptDocCard } from '../../components/admin/GoodsReceiptDocCard';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  countAdminGoodsReceiptsByLocation,
  countAdminGoodsReceiptsByShipment,
  EMPTY_GOODS_RECEIPT_SHIPMENT_COUNTS,
  fetchAllAdminGoodsReceiptsInRange,
  fetchAdminGoodsReceiptsPageDetailed,
  filterAdminGoodsReceipts,
  toGoodsReceiptDateKey,
  type AdminFirestoreGoodsReceipt,
  type AdminGoodsReceiptLocationCounts,
  type AdminGoodsReceiptSort,
  type GoodsReceiptLocationFilter,
  type GoodsReceiptShipmentFilter,
} from '../../lib/admin-goods-receipts';
import {
  getInvoicePeriodBounds,
  invoiceErrorMessage,
} from '../../lib/invoices';
import { useRevealScrollbarOnScroll } from '../../lib/useRevealScrollbarOnScroll';
import type { SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

const LIST_PAGE_SIZE = 25;
const DEFAULT_RANGE: SalesRangePreset = 'financial_year';
const DEFAULT_SORT: AdminGoodsReceiptSort = 'date';
const DEFAULT_LOCATION: GoodsReceiptLocationFilter = 'all';
const DEFAULT_SHIPMENT: GoodsReceiptShipmentFilter = 'all';

const LOCATION_BLOCKS: Array<{ value: GoodsReceiptLocationFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'head_office', label: 'Head office' },
  { value: 'cochin', label: 'Cochin' },
];

const SHIPMENT_BLOCKS: Array<{ value: GoodsReceiptShipmentFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'received', label: 'Received' },
];

const EMPTY_LOCATION_COUNTS: AdminGoodsReceiptLocationCounts = {
  all: 0,
  head_office: 0,
  cochin: 0,
};

const SORT_OPTIONS: Array<{ value: AdminGoodsReceiptSort; label: string }> = [
  { value: 'date', label: 'Bill date' },
  { value: 'syncedAt', label: 'Most recently updated' },
];

function ShipmentBlockIcon({ value }: { value: GoodsReceiptShipmentFilter }) {
  if (value === 'received') return <PackageCheck size={16} strokeWidth={2.2} />;
  if (value === 'scheduled') return <CalendarClock size={16} strokeWidth={2.2} />;
  return <LayoutGrid size={16} strokeWidth={2.2} />;
}

function GoodsReceiptFilterSheet({
  open,
  rangePreset,
  sort,
  location,
  locationCounts,
  countsLoading,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  sort: AdminGoodsReceiptSort;
  location: GoodsReceiptLocationFilter;
  locationCounts: AdminGoodsReceiptLocationCounts;
  countsLoading: boolean;
  onClose: () => void;
  onApply: (next: {
    rangePreset: SalesRangePreset;
    sort: AdminGoodsReceiptSort;
    location: GoodsReceiptLocationFilter;
  }) => void;
}) {
  const [draftRange, setDraftRange] = useState(rangePreset);
  const [draftSort, setDraftSort] = useState(sort);
  const [draftLocation, setDraftLocation] = useState(location);

  useEffect(() => {
    if (!open) return;
    setDraftRange(rangePreset);
    setDraftSort(sort);
    setDraftLocation(location);
  }, [open, rangePreset, sort, location]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const draftDirty =
    draftRange !== DEFAULT_RANGE || draftSort !== DEFAULT_SORT || draftLocation !== DEFAULT_LOCATION;

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
        aria-label="Filter goods receipts"
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
              <span className="catalog-spares-multi-filters__label">Location</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Location">
                {LOCATION_BLOCKS.map(option => {
                  const id = `gr-location-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="gr-location"
                        checked={draftLocation === option.value}
                        onChange={() => setDraftLocation(option.value)}
                      />
                      <span className="catalog-spares-multi-filters__option-label">{option.label}</span>
                      <span
                        className={`catalog-spares-multi-filters__option-count${
                          draftLocation === option.value ? ' is-active' : ''
                        }`}
                      >
                        {countsLoading ? '…' : locationCounts[option.value].toLocaleString('en-IN')}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="catalog-spares-multi-filters__group">
              <span className="catalog-spares-multi-filters__label">Date range</span>
              <div className="catalog-spares-multi-filters__options" role="radiogroup" aria-label="Date range">
                {SALES_RANGE_OPTIONS.map(option => {
                  const id = `gr-range-${String(option.value)}`;
                  return (
                    <label key={String(option.value)} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="gr-date-range"
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
                  const id = `gr-sort-${option.value}`;
                  return (
                    <label key={option.value} className="catalog-spares-multi-filters__option" htmlFor={id}>
                      <input
                        id={id}
                        type="radio"
                        className="catalog-spares-multi-filters__checkbox"
                        name="gr-sort"
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
                onApply({ rangePreset: draftRange, sort: draftSort, location: draftLocation });
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
                setDraftLocation(DEFAULT_LOCATION);
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

export const AdminGoodsReceiptsPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const basePath = pathname.startsWith('/staff') ? '/staff' : '/super-admin';
  const scrollRef = useRevealScrollbarOnScroll();
  const pageStartCursors = useRef<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const [pageCursorVersion, setPageCursorVersion] = useState(0);

  const [rows, setRows] = useState<AdminFirestoreGoodsReceipt[]>([]);
  const [locationCounts, setLocationCounts] = useState(EMPTY_LOCATION_COUNTS);
  const [shipmentScanRows, setShipmentScanRows] = useState<AdminFirestoreGoodsReceipt[]>([]);
  const [shipmentCounts, setShipmentCounts] = useState(EMPTY_GOODS_RECEIPT_SHIPMENT_COUNTS);
  const [loading, setLoading] = useState(true);
  const [countsLoading, setCountsLoading] = useState(true);
  const [scanLoading, setScanLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminGoodsReceiptSort>(DEFAULT_SORT);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [location, setLocationFilter] = useState<GoodsReceiptLocationFilter>(DEFAULT_LOCATION);
  const [shipment, setShipmentFilter] = useState<GoodsReceiptShipmentFilter>(DEFAULT_SHIPMENT);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);

  const bounds = getInvoicePeriodBounds(rangePreset);
  const dateStart = bounds?.start ? toGoodsReceiptDateKey(bounds.start) : null;
  const dateEnd = bounds?.end ? toGoodsReceiptDateKey(bounds.end) : null;
  const searchActive = Boolean(search.trim());
  const shipmentActive = shipment !== 'all';
  const useScan = searchActive || shipmentActive;

  useEffect(() => {
    setPage(1);
    pageStartCursors.current = [null];
    setPageCursorVersion(v => v + 1);
  }, [search, rangePreset, location, shipment, sort]);

  useEffect(() => {
    let cancelled = false;
    setCountsLoading(true);
    void countAdminGoodsReceiptsByLocation({ dateStart, dateEnd })
      .then(counts => {
        if (cancelled) return;
        setLocationCounts(counts);
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
  }, [dateStart, dateEnd]);

  useEffect(() => {
    let cancelled = false;
    setScanLoading(true);
    void fetchAllAdminGoodsReceiptsInRange({
      sort,
      location,
      dateStart,
      dateEnd,
    })
      .then(result => {
        if (cancelled) return;
        setShipmentScanRows(result.rows);
        setShipmentCounts(countAdminGoodsReceiptsByShipment(result.rows));
      })
      .catch(err => {
        if (!cancelled) setError(invoiceErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setScanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sort, location, dateStart, dateEnd]);

  useEffect(() => {
    if (useScan) return;

    let cancelled = false;
    const cursor = pageStartCursors.current[page - 1] ?? null;
    setLoading(true);
    setError('');

    void fetchAdminGoodsReceiptsPageDetailed({
      sort,
      pageSize: LIST_PAGE_SIZE,
      cursor,
      location,
      dateStart,
      dateEnd,
    })
      .then(result => {
        if (cancelled) return;
        setRows(result.rows);
        if (result.lastDoc) {
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
  }, [page, pageCursorVersion, sort, location, dateStart, dateEnd, useScan]);

  const filtered = useMemo(
    () => filterAdminGoodsReceipts(
      useScan ? shipmentScanRows : rows,
      search,
      'all',
      shipment,
    ),
    [rows, shipmentScanRows, search, shipment, useScan],
  );

  const clientPaged = useScan;
  const locationTotal = location === 'all' ? locationCounts.all : locationCounts[location];
  const filteredTotal = useScan ? filtered.length : locationTotal;
  const pageRows = useMemo(() => {
    if (clientPaged) {
      const start = (page - 1) * LIST_PAGE_SIZE;
      return filtered.slice(start, start + LIST_PAGE_SIZE);
    }
    return filtered;
  }, [clientPaged, filtered, page]);

  const totalPages = useMemo(() => {
    if (clientPaged) return Math.max(1, Math.ceil(filteredTotal / LIST_PAGE_SIZE));
    if (filteredTotal <= 0) return 1;
    return Math.ceil(filteredTotal / LIST_PAGE_SIZE);
  }, [clientPaged, filteredTotal]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const openGr = (po: AdminFirestoreGoodsReceipt) => {
    navigate(`${basePath}/goods-receipts/${po.id}`);
  };

  const hasActiveFilters =
    rangePreset !== DEFAULT_RANGE || sort !== DEFAULT_SORT || location !== DEFAULT_LOCATION;

  const headerTools = useMemo(
    () => (
      <div className="invoices-header-tools">
        <div className="catalog-search invoices-header-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search bill #, vendor…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search goods receipts"
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
          aria-label="Filter goods receipts"
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
      <section className="invoices-summary" aria-label="Goods receipt filters">
        <div
          className="unified-so-stage-blocks unified-so-stage-blocks--goods-receipt"
          role="tablist"
          aria-label="Bill shipment"
        >
          {SHIPMENT_BLOCKS.map(item => {
            const active = shipment === item.value;
            const count = shipmentCounts[item.value];
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={active}
                className={`unified-so-category-block unified-so-stage-block unified-so-stage-block--${item.value}${
                  active ? ' is-active' : ''
                }`}
                onClick={() => setShipmentFilter(item.value)}
              >
                <span className="unified-so-category-block__icon" aria-hidden>
                  <span className={`unified-so-stage-block__icon unified-so-stage-block__icon--${item.value}`}>
                    <ShipmentBlockIcon value={item.value} />
                  </span>
                </span>
                <span className="unified-so-category-block__label">{item.label}</span>
                <span className="unified-so-category-block__count">
                  {scanLoading ? '…' : count.toLocaleString('en-IN')}
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

        {(useScan ? scanLoading : loading && rows.length === 0) ? (
          <FetchingLoader label="Loading goods receipts…" />
        ) : pageRows.length === 0 ? (
          <div className="invoices-empty panel glass">
            <FileText size={40} className="text-muted" aria-hidden />
            <p>No goods receipts found for this period.</p>
          </div>
        ) : (
          <>
            {totalPages > 1 && (
              <div className="invoices-pagination invoices-pagination--top" role="navigation" aria-label="Goods receipt list pagination">
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
            <div className="invoice-doc-card-list">
              {pageRows.map(po => (
                <GoodsReceiptDocCard
                  key={po.id}
                  goodsReceipt={po}
                  onOpen={openGr}
                />
              ))}
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

      <GoodsReceiptFilterSheet
        open={filterOpen}
        rangePreset={rangePreset}
        sort={sort}
        location={location}
        locationCounts={locationCounts}
        countsLoading={countsLoading}
        onClose={() => setFilterOpen(false)}
        onApply={next => {
          setRangePreset(next.rangePreset);
          setSort(next.sort);
          setLocationFilter(next.location);
        }}
      />
    </div>
  );
};
