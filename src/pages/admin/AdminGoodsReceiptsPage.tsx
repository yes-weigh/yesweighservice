import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  AlertCircle,
  Building2,
  ChevronRight,
  FileText,
  LayoutGrid,
  Search,
  SlidersHorizontal,
  Warehouse,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useCatalogPageHeader, usePageHeaderSlot } from '../../context/PageHeaderContext';
import {
  countAdminGoodsReceiptsByLocation,
  fetchAdminGoodsReceiptsPageDetailed,
  filterAdminGoodsReceipts,
  goodsReceiptLocationLabel,
  goodsReceiptStatusLabel,
  toGoodsReceiptDateKey,
  type AdminFirestoreGoodsReceipt,
  type AdminGoodsReceiptLocationCounts,
  type AdminGoodsReceiptSort,
  type GoodsReceiptLocationFilter,
} from '../../lib/admin-goods-receipts';
import {
  formatInvoiceDate,
  formatInvoiceItemQuantity,
  getInvoicePeriodBounds,
  invoiceErrorMessage,
} from '../../lib/invoices';
import { useRevealScrollbarOnScroll } from '../../lib/useRevealScrollbarOnScroll';
import type { SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

const LIST_PAGE_SIZE = 25;
const SEARCH_FETCH_SIZE = 100;
const DEFAULT_RANGE: SalesRangePreset = 'financial_year';
const DEFAULT_SORT: AdminGoodsReceiptSort = 'date';
const DEFAULT_LOCATION: GoodsReceiptLocationFilter = 'all';

const LOCATION_BLOCKS: Array<{ value: GoodsReceiptLocationFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'head_office', label: 'Head office' },
  { value: 'cochin', label: 'Cochin' },
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

function poStatusClass(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return `invoices-status invoices-status--${key}`;
}

function LocationBlockIcon({ value }: { value: GoodsReceiptLocationFilter }) {
  if (value === 'head_office') return <Building2 size={18} strokeWidth={2.2} />;
  if (value === 'cochin') return <Warehouse size={18} strokeWidth={2.2} />;
  return <LayoutGrid size={18} strokeWidth={2.2} />;
}

function GoodsReceiptFilterSheet({
  open,
  rangePreset,
  sort,
  onClose,
  onApply,
}: {
  open: boolean;
  rangePreset: SalesRangePreset;
  sort: AdminGoodsReceiptSort;
  onClose: () => void;
  onApply: (next: {
    rangePreset: SalesRangePreset;
    sort: AdminGoodsReceiptSort;
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

export const AdminGoodsReceiptsPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const basePath = pathname.startsWith('/staff') ? '/staff' : '/super-admin';
  const scrollRef = useRevealScrollbarOnScroll();
  const pageStartCursors = useRef<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const [pageCursorVersion, setPageCursorVersion] = useState(0);

  const [rows, setRows] = useState<AdminFirestoreGoodsReceipt[]>([]);
  const [locationCounts, setLocationCounts] = useState(EMPTY_LOCATION_COUNTS);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [countsLoading, setCountsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminGoodsReceiptSort>(DEFAULT_SORT);
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>(DEFAULT_RANGE);
  const [location, setLocationFilter] = useState<GoodsReceiptLocationFilter>(DEFAULT_LOCATION);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);

  const bounds = getInvoicePeriodBounds(rangePreset);
  const dateStart = bounds?.start ? toGoodsReceiptDateKey(bounds.start) : null;
  const dateEnd = bounds?.end ? toGoodsReceiptDateKey(bounds.end) : null;
  const searchActive = Boolean(search.trim());

  useEffect(() => {
    setPage(1);
    pageStartCursors.current = [null];
    setPageCursorVersion(v => v + 1);
  }, [search, rangePreset, location, sort]);

  useEffect(() => {
    let cancelled = false;
    setCountsLoading(true);
    void countAdminGoodsReceiptsByLocation({ dateStart, dateEnd })
      .then(counts => {
        if (cancelled) return;
        setLocationCounts(counts);
        setTotalCount(location === 'all' ? counts.all : counts[location]);
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
  }, [dateStart, dateEnd, location]);

  useEffect(() => {
    let cancelled = false;
    const cursor = pageStartCursors.current[page - 1] ?? null;
    setLoading(true);
    setError('');

    void fetchAdminGoodsReceiptsPageDetailed({
      sort,
      pageSize: searchActive ? SEARCH_FETCH_SIZE : LIST_PAGE_SIZE,
      cursor: searchActive ? null : cursor,
      location: searchActive ? 'all' : location,
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
  }, [page, pageCursorVersion, sort, location, dateStart, dateEnd, searchActive]);

  const filtered = useMemo(
    () => filterAdminGoodsReceipts(rows, search, searchActive ? location : 'all'),
    [rows, search, location, searchActive],
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

  const openGr = (po: AdminFirestoreGoodsReceipt) => {
    navigate(`${basePath}/goods-receipts/${po.id}`);
  };

  const hasActiveFilters = rangePreset !== DEFAULT_RANGE || sort !== DEFAULT_SORT;
  const busy = loading || countsLoading;

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
      <section className="invoices-summary" aria-label="Goods receipt locations">
        <div className="unified-so-category-blocks" role="tablist" aria-label="Bill location">
          {LOCATION_BLOCKS.map(item => {
            const active = location === item.value;
            const count = locationCounts[item.value];
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={active}
                className={`unified-so-category-block${active ? ' is-active' : ''}`}
                onClick={() => setLocationFilter(item.value)}
              >
                <span className="unified-so-category-block__icon" aria-hidden>
                  <LocationBlockIcon value={item.value} />
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
            <div className="panel glass invoices-table-panel admin-invoices-table-panel">
              <div className="invoices-table-wrap invoices-table-wrap--desktop">
                <table className="invoices-table">
                  <thead>
                    <tr>
                      <th>Bill number</th>
                      <th>Vendor</th>
                      <th>Location</th>
                      <th>Date</th>
                      <th className="invoices-table__num">Qty</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(po => (
                        <tr
                          key={po.id}
                          className="invoices-table__row--clickable"
                          onClick={() => openGr(po)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openGr(po);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`View goods receipt ${po.billNumber || po.id}`}
                        >
                          <td>
                            <strong>{po.billNumber || po.id}</strong>
                            {po.referenceNumber && (
                              <div className="invoices-table__ref text-muted text-sm">
                                Ref {po.referenceNumber}
                              </div>
                            )}
                          </td>
                          <td>{po.vendorName ?? '—'}</td>
                          <td>{goodsReceiptLocationLabel(po.inventorySite)}</td>
                          <td>{formatInvoiceDate(po.date)}</td>
                          <td className="invoices-table__num">{formatInvoiceItemQuantity(po.itemQuantity)}</td>
                          <td>
                            <span className={poStatusClass(po.status)}>
                              {goodsReceiptStatusLabel(po.status)}
                            </span>
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="invoices-mobile-list admin-invoices-mobile-list">
                <div className="invoices-mobile-list__head" aria-hidden>
                  <span>Bill number</span>
                  <span>Qty</span>
                </div>
                {pageRows.map(po => (
                  <button
                    key={po.id}
                    type="button"
                    className="invoices-mobile-row invoices-mobile-row--po-stack"
                    onClick={() => openGr(po)}
                    aria-label={`View goods receipt ${po.billNumber || po.id}`}
                  >
                    <span className="invoices-mobile-row__body">
                      <span className="invoices-mobile-row__invoice">
                        <strong className="invoices-mobile-row__company">
                          {po.vendorName ?? '—'}
                        </strong>
                        <span className="invoices-mobile-row__pair invoices-mobile-row__pair--mid">
                          <span className="invoices-mobile-row__date">
                            {formatInvoiceDate(po.date)}
                            {' · '}
                            {goodsReceiptLocationLabel(po.inventorySite)}
                          </span>
                          <span className={poStatusClass(po.status)}>
                            {goodsReceiptStatusLabel(po.status)}
                          </span>
                        </span>
                        <span className="invoices-mobile-row__pair">
                          <span className="invoices-mobile-row__po-num">
                            {po.billNumber || po.id}
                          </span>
                          <strong className="invoices-mobile-row__amount-value">
                            Qty {formatInvoiceItemQuantity(po.itemQuantity)}
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

      <GoodsReceiptFilterSheet
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
