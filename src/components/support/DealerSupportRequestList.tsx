import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LifeBuoy, Plus, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { SupportRequestCard } from './SupportRequestCard';
import { useAuth } from '../../context/AuthContext';
import { fetchCatalogImagesForItemIds } from '../../lib/invoiceLineItemImages';
import { fetchAllDealerInvoices, readCachedAllDealerInvoices } from '../../lib/invoices';
import type { DealerSupportRequest } from '../../types/dealer-support';
import { SUPPORT_TYPE_LABELS } from '../../types/dealer-support';
import {
  SUPPORT_LIFECYCLE_FILTERS,
  countSupportRequestsByFilter,
  filterSupportRequests,
  sortSupportRequests,
  type SupportLifecycleFilter,
  type SupportSortOption,
  type SupportTypeFilter,
} from '../../lib/supportRequestDisplay';

interface DealerSupportRequestListProps {
  requests: DealerSupportRequest[];
  loading: boolean;
  onOpenRequest: (request: DealerSupportRequest) => void;
  onNewRequest: () => void;
  onRefresh?: () => void;
}

const TYPE_OPTIONS = ['all', 'service', 'return', 'complaint'] as const;
const DEFAULT_LIFECYCLE_FILTER: SupportLifecycleFilter = 'open';

export const DealerSupportRequestList: React.FC<DealerSupportRequestListProps> = ({
  requests,
  loading,
  onOpenRequest,
  onNewRequest,
  onRefresh,
}) => {
  const { user } = useAuth();
  const [lifecycleFilter, setLifecycleFilter] = useState<SupportLifecycleFilter>(DEFAULT_LIFECYCLE_FILTER);
  const [sort, setSort] = useState<SupportSortOption>('newest');
  const [typeFilter, setTypeFilter] = useState<SupportTypeFilter>('all');
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const [invoiceDates, setInvoiceDates] = useState<Map<string, string>>(new Map());
  const typeFilterRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => countSupportRequestsByFilter(requests), [requests]);

  const visibleRequests = useMemo(
    () => sortSupportRequests(filterSupportRequests(requests, lifecycleFilter, typeFilter), sort),
    [requests, sort, lifecycleFilter, typeFilter],
  );

  const activeFilterCount = [
    lifecycleFilter !== DEFAULT_LIFECYCLE_FILTER,
    typeFilter !== 'all',
    sort !== 'newest',
  ].filter(Boolean).length;

  const hasNonDefaultFilters = lifecycleFilter !== DEFAULT_LIFECYCLE_FILTER || typeFilter !== 'all';

  const activeSummaryParts = useMemo(() => {
    const parts: string[] = [];
    if (lifecycleFilter !== DEFAULT_LIFECYCLE_FILTER) {
      parts.push(SUPPORT_LIFECYCLE_FILTERS.find(option => option.value === lifecycleFilter)?.label ?? lifecycleFilter);
    }
    if (typeFilter !== 'all') {
      parts.push(SUPPORT_TYPE_LABELS[typeFilter]);
    }
    return parts;
  }, [lifecycleFilter, typeFilter]);

  const resetFilters = () => {
    setLifecycleFilter(DEFAULT_LIFECYCLE_FILTER);
    setTypeFilter('all');
    setSort('newest');
    setShowFilterSheet(false);
    setShowTypeFilter(false);
  };

  useEffect(() => {
    const itemIds = requests
      .map(request => request.product?.itemId)
      .filter((id): id is string => Boolean(id));
    if (!itemIds.length) {
      setImages(new Map());
      return;
    }
    let cancelled = false;
    void fetchCatalogImagesForItemIds(itemIds).then(map => {
      if (!cancelled) setImages(map);
    });
    return () => {
      cancelled = true;
    };
  }, [requests]);

  useEffect(() => {
    const invoiceIds = new Set(
      requests.map(request => request.invoiceId).filter((id): id is string => Boolean(id)),
    );
    if (!invoiceIds.size) {
      setInvoiceDates(new Map());
      return;
    }

    const buildMap = (invoices: Array<{ id: string; date: string | null }>) => {
      const map = new Map<string, string>();
      for (const invoice of invoices) {
        if (invoiceIds.has(invoice.id) && invoice.date) {
          map.set(invoice.id, invoice.date);
        }
      }
      return map;
    };

    let cancelled = false;
    const cached = readCachedAllDealerInvoices(user?.uid);
    if (cached) {
      setInvoiceDates(buildMap(cached));
    }

    void fetchAllDealerInvoices(user?.uid).then(invoices => {
      if (!cancelled) setInvoiceDates(buildMap(invoices));
    });

    return () => {
      cancelled = true;
    };
  }, [requests, user?.uid]);

  useEffect(() => {
    if (!showTypeFilter) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (typeFilterRef.current && !typeFilterRef.current.contains(event.target as Node)) {
        setShowTypeFilter(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showTypeFilter]);

  useEffect(() => {
    if (!showFilterSheet) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showFilterSheet]);

  if (loading && requests.length === 0) {
    return <FetchingLoader label="Loading support requests…" />;
  }

  return (
    <div className="support-request-list">
      <div className="support-request-list__filters">
        <div className="support-request-list__filter-head">
          <div
            className="support-request-list__lifecycle"
            role="tablist"
            aria-label="Filter by lifecycle"
          >
            {SUPPORT_LIFECYCLE_FILTERS.map(tab => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={lifecycleFilter === tab.value}
                className={`support-request-list__lifecycle-btn ${lifecycleFilter === tab.value ? 'is-active' : ''}`}
                onClick={() => setLifecycleFilter(tab.value)}
              >
                <span className="support-request-list__lifecycle-label">{tab.label}</span>
                <span className="support-request-list__lifecycle-count">{counts[tab.value]}</span>
              </button>
            ))}
          </div>

          <div className="support-request-list__filter-head-actions">
            {onRefresh && (
              <button
                type="button"
                className="support-request-list__refresh"
                aria-label="Refresh"
                disabled={loading}
                onClick={onRefresh}
              >
                <RefreshCw size={16} className={loading ? 'spin-icon' : undefined} />
              </button>
            )}

            <button
              type="button"
              className={`support-request-list__filters-mobile support-request-list__filters-mobile--head ${activeFilterCount > 0 ? 'is-active' : ''}`}
              aria-label={activeFilterCount > 0 ? `Filters (${activeFilterCount} active)` : 'Filters'}
              onClick={() => setShowFilterSheet(true)}
            >
              <SlidersHorizontal size={16} aria-hidden />
              {activeFilterCount > 0 && (
                <span className="support-request-list__filter-pill">{activeFilterCount}</span>
              )}
            </button>
          </div>
        </div>

        {activeSummaryParts.length > 0 && (
          <p className="support-request-list__summary text-muted text-sm">
            Showing: {activeSummaryParts.join(' · ')}
          </p>
        )}

        <div className="support-request-list__toolbar support-request-list__toolbar--desktop">
          <button
            type="button"
            className={`support-request-list__filters-mobile ${activeFilterCount > 0 ? 'is-active' : ''}`}
            onClick={() => setShowFilterSheet(true)}
          >
            <SlidersHorizontal size={16} aria-hidden />
            Filters
            {activeFilterCount > 0 && (
              <span className="support-request-list__filter-pill">{activeFilterCount}</span>
            )}
          </button>

          <div className="support-request-list__toolbar-desktop">
            <div className="support-request-list__filter-wrap" ref={typeFilterRef}>
              <button
                type="button"
                className={`support-request-list__filter-btn ${typeFilter !== 'all' ? 'is-active' : ''}`}
                onClick={() => setShowTypeFilter(open => !open)}
              >
                <SlidersHorizontal size={15} aria-hidden />
                Type
                {typeFilter !== 'all' && (
                  <span className="support-request-list__filter-pill">
                    {SUPPORT_TYPE_LABELS[typeFilter]}
                  </span>
                )}
              </button>
              {showTypeFilter && (
                <div className="support-request-list__filter-menu panel glass">
                  {TYPE_OPTIONS.map(value => (
                    <button
                      key={value}
                      type="button"
                      className={`support-request-list__filter-option ${typeFilter === value ? 'is-active' : ''}`}
                      onClick={() => {
                        setTypeFilter(value);
                        setShowTypeFilter(false);
                      }}
                    >
                      {value === 'all' ? 'All types' : SUPPORT_TYPE_LABELS[value]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <label className="support-request-list__sort">
              <span className="text-muted text-sm">Sort</span>
              <select
                className="catalog-select support-request-list__sort-select"
                value={sort}
                onChange={e => setSort(e.target.value as SupportSortOption)}
                aria-label="Sort requests"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {visibleRequests.length === 0 ? (
        <div className="warranty-support-page__empty panel glass">
          <LifeBuoy size={40} aria-hidden />
          <h3>No requests in this view</h3>
          <p className="text-muted text-sm">
            {!hasNonDefaultFilters
              ? 'Start a new warranty / support request when you are ready.'
              : 'No tickets match your current filters. Try a broader status or clear filters.'}
          </p>
          {hasNonDefaultFilters ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters}>
              Clear filters
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={onNewRequest}>
              <Plus size={16} />
              New request
            </button>
          )}
        </div>
      ) : (
        <ul className="support-request-list__cards">
          {visibleRequests.map(request => (
            <li key={request.id}>
              <SupportRequestCard
                request={request}
                imageUrl={request.product?.itemId ? images.get(request.product.itemId) : null}
                invoiceDate={request.invoiceId ? invoiceDates.get(request.invoiceId) ?? null : null}
                onClick={() => onOpenRequest(request)}
              />
            </li>
          ))}
        </ul>
      )}

      {showFilterSheet && (
        <>
          <button
            type="button"
            className="support-filter-sheet__backdrop"
            aria-label="Close filters"
            onClick={() => setShowFilterSheet(false)}
          />
          <div
            className="support-filter-sheet panel glass"
            role="dialog"
            aria-modal="true"
            aria-label="Filter support requests"
          >
            <header className="support-filter-sheet__header">
              <h3 className="support-filter-sheet__title">Filters</h3>
              <button
                type="button"
                className="support-filter-sheet__close"
                aria-label="Close"
                onClick={() => setShowFilterSheet(false)}
              >
                <X size={20} />
              </button>
            </header>

            <section className="support-filter-sheet__section">
              <h4 className="support-filter-sheet__section-title">Request type</h4>
              <div className="support-filter-sheet__options">
                {TYPE_OPTIONS.map(value => (
                  <button
                    key={value}
                    type="button"
                    className={`support-filter-sheet__option ${typeFilter === value ? 'is-active' : ''}`}
                    onClick={() => setTypeFilter(value)}
                  >
                    {value === 'all' ? 'All types' : SUPPORT_TYPE_LABELS[value]}
                  </button>
                ))}
              </div>
            </section>

            <section className="support-filter-sheet__section">
              <h4 className="support-filter-sheet__section-title">Sort by</h4>
              <div className="support-filter-sheet__options">
                {(['newest', 'oldest'] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    className={`support-filter-sheet__option ${sort === value ? 'is-active' : ''}`}
                    onClick={() => setSort(value)}
                  >
                    {value === 'newest' ? 'Newest first' : 'Oldest first'}
                  </button>
                ))}
              </div>
            </section>

            <footer className="support-filter-sheet__footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm support-filter-sheet__reset"
                onClick={resetFilters}
                disabled={activeFilterCount === 0}
              >
                Reset all
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowFilterSheet(false)}
              >
                Show {visibleRequests.length} result{visibleRequests.length === 1 ? '' : 's'}
              </button>
            </footer>
          </div>
        </>
      )}
    </div>
  );
};
