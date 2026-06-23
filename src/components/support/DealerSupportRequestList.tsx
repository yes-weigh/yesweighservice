import React, { useEffect, useMemo, useState } from 'react';
import { LifeBuoy, Plus, SlidersHorizontal } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { SupportRequestCard } from './SupportRequestCard';
import { fetchCatalogImagesForItemIds } from '../../lib/invoiceLineItemImages';
import type { DealerSupportRequest } from '../../types/dealer-support';
import { SUPPORT_TYPE_LABELS } from '../../types/dealer-support';
import {
  SUPPORT_STATUS_TABS,
  countSupportRequestsByTab,
  filterSupportRequests,
  sortSupportRequests,
  type SupportSortOption,
  type SupportStatusTab,
  type SupportTypeFilter,
} from '../../lib/supportRequestDisplay';

interface DealerSupportRequestListProps {
  requests: DealerSupportRequest[];
  loading: boolean;
  onOpenRequest: (request: DealerSupportRequest) => void;
  onNewRequest: () => void;
}

export const DealerSupportRequestList: React.FC<DealerSupportRequestListProps> = ({
  requests,
  loading,
  onOpenRequest,
  onNewRequest,
}) => {
  const [statusTab, setStatusTab] = useState<SupportStatusTab>('all');
  const [sort, setSort] = useState<SupportSortOption>('newest');
  const [typeFilter, setTypeFilter] = useState<SupportTypeFilter>('all');
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  const [images, setImages] = useState<Map<string, string>>(new Map());

  const counts = useMemo(() => countSupportRequestsByTab(requests), [requests]);

  const visibleRequests = useMemo(
    () => sortSupportRequests(filterSupportRequests(requests, statusTab, typeFilter), sort),
    [requests, sort, statusTab, typeFilter],
  );

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

  if (loading && requests.length === 0) {
    return <FetchingLoader label="Loading support requests…" />;
  }

  return (
    <div className="support-request-list">
      <div className="support-request-list__tabs" role="tablist" aria-label="Filter by status">
        {SUPPORT_STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={statusTab === tab.value}
            className={`support-request-list__tab ${statusTab === tab.value ? 'is-active' : ''}`}
            onClick={() => setStatusTab(tab.value)}
          >
            <span className="support-request-list__tab-label">{tab.label}</span>
            <span className="support-request-list__tab-count">{counts[tab.value]}</span>
          </button>
        ))}
      </div>

      <div className="support-request-list__toolbar">
        <div className="support-request-list__filter-wrap">
          <button
            type="button"
            className={`support-request-list__filter-btn ${typeFilter !== 'all' ? 'is-active' : ''}`}
            onClick={() => setShowTypeFilter(open => !open)}
          >
            <SlidersHorizontal size={15} aria-hidden />
            Filter
            {typeFilter !== 'all' && (
              <span className="support-request-list__filter-pill">
                {SUPPORT_TYPE_LABELS[typeFilter]}
              </span>
            )}
          </button>
          {showTypeFilter && (
            <div className="support-request-list__filter-menu panel glass">
              {(['all', 'service', 'return', 'complaint'] as const).map(value => (
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
          <span className="text-muted text-sm">Sort:</span>
          <select
            className="catalog-select support-request-list__sort-select"
            value={sort}
            onChange={e => setSort(e.target.value as SupportSortOption)}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
      </div>

      {visibleRequests.length === 0 ? (
        <div className="warranty-support-page__empty panel glass">
          <LifeBuoy size={40} aria-hidden />
          <h3>No requests in this view</h3>
          <p className="text-muted text-sm">
            Try another status tab or start a new warranty / support request.
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={onNewRequest}>
            <Plus size={16} />
            New request
          </button>
        </div>
      ) : (
        <ul className="support-request-list__cards">
          {visibleRequests.map(request => (
            <li key={request.id}>
              <SupportRequestCard
                request={request}
                imageUrl={request.product?.itemId ? images.get(request.product.itemId) : null}
                onClick={() => onOpenRequest(request)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
