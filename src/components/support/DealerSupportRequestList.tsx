import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { useTopBarAction } from '../../context/PageHeaderContext';
import { SupportLifecycleFilterBlocks } from './SupportLifecycleFilterBlocks';
import { SupportRequestCard } from './SupportRequestCard';
import { fetchCatalogImagesForItemIds } from '../../lib/invoiceLineItemImages';
import { fetchSupportInvoiceDatesForTickets } from '../../lib/supportInvoiceDates';
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
  onRefresh?: () => void;
  trailingAction?: React.ReactNode;
}

const TYPE_OPTIONS = ['all', 'service', 'return', 'complaint', 'chat'] as const;
const DEFAULT_LIFECYCLE_FILTER: SupportLifecycleFilter = 'open';

export const DealerSupportRequestList: React.FC<DealerSupportRequestListProps> = ({
  requests,
  loading,
  onOpenRequest,
  onRefresh,
  trailingAction,
}) => {
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
    const tickets = requests
      .filter(request => request.invoiceId)
      .map(request => ({
        invoiceId: request.invoiceId as string,
        invoiceNumber: request.invoiceNumber,
        zohoCustomerId: request.zohoCustomerId,
        dealerId: request.dealerId,
      }));
    if (!tickets.length) {
      setInvoiceDates(new Map());
      return;
    }

    let cancelled = false;
    void fetchSupportInvoiceDatesForTickets(tickets).then(map => {
      if (!cancelled) setInvoiceDates(map);
    });

    return () => {
      cancelled = true;
    };
  }, [requests]);

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

  const headerActions = useMemo(
    () => (
      <div className="catalog-header-actions">
        {onRefresh && (
          <button
            type="button"
            className="catalog-header-filter-btn"
            aria-label="Refresh"
            title="Refresh"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw size={18} className={loading ? 'spin-icon' : undefined} />
          </button>
        )}
        <button
          type="button"
          className={[
            'catalog-header-filter-btn',
            showFilterSheet ? 'catalog-header-filter-btn--open' : '',
            activeFilterCount > 0 ? 'catalog-header-filter-btn--active' : '',
          ].filter(Boolean).join(' ')}
          aria-label={activeFilterCount > 0 ? `Filters (${activeFilterCount} active)` : 'Filters'}
          title="Filters"
          aria-expanded={showFilterSheet}
          aria-haspopup="dialog"
          onClick={() => setShowFilterSheet(open => !open)}
        >
          <SlidersHorizontal size={18} aria-hidden />
          {activeFilterCount > 0 && (
            <span className="support-request-list__filter-pill">{activeFilterCount}</span>
          )}
        </button>
        {trailingAction}
      </div>
    ),
    [activeFilterCount, loading, onRefresh, showFilterSheet, trailingAction],
  );

  useTopBarAction(headerActions, true);

  const filterSheet = showFilterSheet ? (
        <>
          <button
            type="button"
            className="support-filter-sheet__backdrop"
            aria-label="Close filters"
            onClick={() => setShowFilterSheet(false)}
          />
          <div
            className="support-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Filter support requests"
          >
            <header className="support-filter-sheet__header">
              <h3 className="support-filter-sheet__title">Filters</h3>
              <div className="support-filter-sheet__header-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm support-filter-sheet__reset"
                  onClick={resetFilters}
                  disabled={activeFilterCount === 0}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm support-filter-sheet__apply"
                  onClick={() => setShowFilterSheet(false)}
                >
                  Show {visibleRequests.length}
                </button>
                <button
                  type="button"
                  className="support-filter-sheet__close"
                  aria-label="Close"
                  onClick={() => setShowFilterSheet(false)}
                >
                  <X size={18} />
                </button>
              </div>
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
          </div>
        </>
  ) : null;

  if (loading && requests.length === 0) {
    return (
      <>
        <FetchingLoader label="Loading support requests…" />
        {filterSheet}
      </>
    );
  }

  return (
    <div className="support-request-list">
      <div className="support-request-list__filters">
        <div className="support-request-list__filter-head support-request-list__filter-head--blocks">
          <SupportLifecycleFilterBlocks
            value={lifecycleFilter}
            counts={counts}
            loading={loading && requests.length === 0}
            onChange={setLifecycleFilter}
          />
        </div>

        {activeSummaryParts.length > 0 && (
          <p className="support-request-list__summary text-muted text-sm">
            Showing: {activeSummaryParts.join(' · ')}
          </p>
        )}

        <div className="support-request-list__toolbar support-request-list__toolbar--desktop">
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
        hasNonDefaultFilters ? (
          <div className="warranty-support-page__empty panel glass">
            <p className="text-muted text-sm">
              No tickets match your current filters. Try a broader status or clear filters.
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters}>
              Clear filters
            </button>
          </div>
        ) : null
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

      {filterSheet}
    </div>
  );
};
