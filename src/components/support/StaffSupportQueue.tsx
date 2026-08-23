import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Inbox } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { SupportLifecycleFilterBlocks } from './SupportLifecycleFilterBlocks';
import { SupportRequestCard } from './SupportRequestCard';
import { useAuth } from '../../context/AuthContext';
import { fetchSupportInvoiceDatesForTickets } from '../../lib/supportInvoiceDates';
import {
  subscribeOpsSupportRequests,
  supportDetailPath,
} from '../../lib/dealerSupport';
import { fetchCatalogImagesForItemIds } from '../../lib/invoiceLineItemImages';
import { filterSupportRequestsForUser } from '../../lib/staffAccess';
import {
  SUPPORT_STAGE_FILTERS,
  combineStatusFilter,
  countSupportRequestsByFilter,
  filterSupportRequests,
  sortSupportRequests,
  type SupportLifecycleFilter,
} from '../../lib/supportRequestDisplay';
import type { DealerSupportRequest, SupportOpenStage } from '../../types/dealer-support';

const DEFAULT_LIFECYCLE_FILTER: SupportLifecycleFilter = 'open';

export const StaffSupportQueue: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<DealerSupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState<SupportLifecycleFilter>(
    DEFAULT_LIFECYCLE_FILTER,
  );
  const [openStageFilter, setOpenStageFilter] = useState<SupportOpenStage | null>(null);
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const [invoiceDates, setInvoiceDates] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!user) return undefined;
    setLoading(true);
    setError('');

    const unsub = subscribeOpsSupportRequests(
      rows => {
        setRequests(rows);
        setLoading(false);
      },
      err => {
        setError(err.message);
        setLoading(false);
      },
    );

    return unsub;
  }, [user]);

  const scopedRequests = useMemo(
    () => filterSupportRequestsForUser(user, requests),
    [user, requests],
  );

  useEffect(() => {
    const itemIds = scopedRequests
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
  }, [scopedRequests]);

  useEffect(() => {
    const tickets = scopedRequests
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
  }, [scopedRequests]);

  const counts = useMemo(() => countSupportRequestsByFilter(scopedRequests), [scopedRequests]);

  const statusFilter = useMemo(
    () => combineStatusFilter(
      lifecycleFilter,
      lifecycleFilter === 'open' ? openStageFilter : null,
    ),
    [lifecycleFilter, openStageFilter],
  );

  const filteredRequests = useMemo(
    () => sortSupportRequests(
      filterSupportRequests(scopedRequests, statusFilter, 'all'),
      'newest',
    ),
    [scopedRequests, statusFilter],
  );

  const handleLifecycleChange = (next: SupportLifecycleFilter) => {
    setLifecycleFilter(next);
    if (next !== 'open') setOpenStageFilter(null);
  };

  if (!user) return null;

  const emptyCopy = lifecycleFilter === 'open'
    ? (openStageFilter
      ? 'No open tickets in this stage.'
      : 'No open tickets right now.')
    : lifecycleFilter === 'resolved'
      ? 'No resolved tickets in this view.'
      : lifecycleFilter === 'cancelled'
        ? 'No cancelled tickets in this view.'
        : 'No dealer support tickets yet.';

  return (
    <div className="staff-support-queue">
      <div className="staff-support-queue__filters">
        <SupportLifecycleFilterBlocks
          value={lifecycleFilter}
          counts={counts}
          loading={loading && scopedRequests.length === 0}
          onChange={handleLifecycleChange}
        />

        {lifecycleFilter === 'open' && (
          <div className="staff-support-queue__stage-rail" role="tablist" aria-label="Filter open stages">
            <button
              type="button"
              role="tab"
              aria-selected={openStageFilter === null}
              className={`staff-support-queue__stage${openStageFilter === null ? ' is-active' : ''}`}
              onClick={() => setOpenStageFilter(null)}
            >
              <span>All</span>
              <span className="staff-support-queue__stage-count">
                {counts.open.toLocaleString('en-IN')}
              </span>
            </button>
            {SUPPORT_STAGE_FILTERS.map(stage => (
              <button
                key={stage.value}
                type="button"
                role="tab"
                aria-selected={openStageFilter === stage.value}
                className={`staff-support-queue__stage${
                  openStageFilter === stage.value ? ' is-active' : ''
                }`}
                onClick={() => setOpenStageFilter(
                  openStageFilter === stage.value ? null : stage.value,
                )}
              >
                <span>{stage.shortLabel}</span>
                <span className="staff-support-queue__stage-count">
                  {(counts[stage.value] ?? 0).toLocaleString('en-IN')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading && filteredRequests.length === 0 ? (
        <FetchingLoader label="Loading support queue…" />
      ) : filteredRequests.length === 0 ? (
        <div className="staff-support-queue__empty">
          <span className="staff-support-queue__empty-icon" aria-hidden>
            <Inbox size={28} strokeWidth={1.8} />
          </span>
          <p className="staff-support-queue__empty-title">{emptyCopy}</p>
          <p className="staff-support-queue__empty-copy text-muted text-sm">
            Switch filters or refresh to check for new dealer tickets.
          </p>
        </div>
      ) : (
        <ul className="support-request-list__cards">
          {filteredRequests.map(request => (
            <li key={request.id}>
              <SupportRequestCard
                request={request}
                imageUrl={request.product?.itemId ? images.get(request.product.itemId) : null}
                invoiceDate={request.invoiceId ? invoiceDates.get(request.invoiceId) ?? null : null}
                statusAudience="staff"
                dealerName={request.dealerName || 'Dealer'}
                showOpsMeta
                onClick={() => navigate(supportDetailPath(user.role, request.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
