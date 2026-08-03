import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Inbox,
  MessageSquare,
  Package,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { SupportLifecycleFilterBlocks } from './SupportLifecycleFilterBlocks';
import { useAuth } from '../../context/AuthContext';
import {
  subscribeOpsSupportRequests,
  supportDetailPath,
} from '../../lib/dealerSupport';
import { filterSupportRequestsForUser } from '../../lib/staffAccess';
import {
  SUPPORT_STAGE_FILTERS,
  combineStatusFilter,
  countSupportRequestsByFilter,
  filterSupportRequests,
  formatSupportSubmittedDate,
  formatSupportSubmittedTime,
  sortSupportRequests,
  supportRequestIssueSummary,
  type SupportLifecycleFilter,
} from '../../lib/supportRequestDisplay';
import { supportDisplayLabel, supportStatusClass } from '../../lib/supportStatus';
import type {
  DealerSupportRequest,
  SupportOpenStage,
  SupportRequestType,
} from '../../types/dealer-support';
import { SUPPORT_TYPE_LABELS } from '../../types/dealer-support';

const DEFAULT_LIFECYCLE_FILTER: SupportLifecycleFilter = 'all';

function typeIcon(type: SupportRequestType) {
  if (type === 'return') return <RotateCcw size={16} strokeWidth={2.2} />;
  if (type === 'complaint') return <AlertCircle size={16} strokeWidth={2.2} />;
  if (type === 'chat') return <MessageSquare size={16} strokeWidth={2.2} />;
  return <Package size={16} strokeWidth={2.2} />;
}

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
        <ul className="staff-support-queue__list">
          {filteredRequests.map(request => {
            const when = request.lastMessageAt ?? request.updatedAt ?? request.createdAt;
            const productLabel = request.product?.name || request.subject || request.category || 'Support request';
            return (
              <li key={request.id}>
                <button
                  type="button"
                  className={`staff-support-queue__ticket staff-support-queue__ticket--${request.type}`}
                  onClick={() => navigate(supportDetailPath(user.role, request.id))}
                >
                  <span className="staff-support-queue__ticket-icon" aria-hidden>
                    {typeIcon(request.type)}
                  </span>

                  <div className="staff-support-queue__ticket-main">
                    <div className="staff-support-queue__ticket-top">
                      <div className="staff-support-queue__ticket-titles">
                        <strong className="staff-support-queue__dealer">
                          {request.dealerName || 'Dealer'}
                        </strong>
                        <span className="staff-support-queue__product">{productLabel}</span>
                      </div>
                      <span className={`service-request-status ${supportStatusClass(request)}`}>
                        {supportDisplayLabel(request, 'staff')}
                      </span>
                    </div>

                    <p className="staff-support-queue__preview">
                      {request.lastMessagePreview || supportRequestIssueSummary(request)}
                    </p>

                    <div className="staff-support-queue__ticket-meta">
                      <span className="staff-support-queue__ref">{request.requestNumber}</span>
                      <span className="staff-support-queue__type-label">
                        {SUPPORT_TYPE_LABELS[request.type]}
                      </span>
                      {request.assignedToName && (
                        <span className="staff-support-queue__assignee">
                          <UserRound size={12} aria-hidden />
                          {request.assignedToName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="staff-support-queue__ticket-when">
                    <strong>{formatSupportSubmittedDate(when)}</strong>
                    <span>{formatSupportSubmittedTime(when)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
