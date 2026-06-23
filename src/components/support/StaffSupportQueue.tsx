import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, LifeBuoy, RefreshCw } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { formatInvoiceDate } from '../../lib/invoices';
import {
  fetchOpsSupportRequests,
  subscribeOpsSupportRequests,
  supportDetailPath,
} from '../../lib/dealerSupport';
import {
  filterSupportRequestsForUser,
  allowedSupportTypesForUser,
} from '../../lib/staffAccess';
import { supportStatusClass } from '../../lib/supportStatus';
import type { DealerSupportRequest, SupportRequestType } from '../../types/dealer-support';
import {
  SUPPORT_REQUEST_STATUS_LABELS,
  SUPPORT_TYPE_LABELS,
} from '../../types/dealer-support';

function typeClass(type: SupportRequestType): string {
  return `support-type-badge--${type}`;
}

export const StaffSupportQueue: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<DealerSupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const refresh = () => {
    if (!user) return;
    setLoading(true);
    void fetchOpsSupportRequests()
      .then(rows => setRequests(rows))
      .catch(err => setError(err instanceof Error ? err.message : 'Could not refresh queue.'))
      .finally(() => setLoading(false));
  };

  const filteredRequests = useMemo(
    () => filterSupportRequestsForUser(user, requests),
    [user, requests],
  );

  const allowedTypes = allowedSupportTypesForUser(user);
  const typeHint = allowedTypes === 'all'
    ? 'All warranty, replacement, and complaint tickets.'
    : allowedTypes.length === 0
      ? 'Your role does not include support queue access.'
      : `Showing ${allowedTypes.map(t => SUPPORT_TYPE_LABELS[t]).join(', ')} tickets for your team.`;

  if (!user) return null;

  return (
    <div className="staff-support-queue">
      <header className="staff-support-queue__header">
        <div>
          <h3>Dealer support queue</h3>
          <p className="text-muted text-sm">{typeHint}</p>
        </div>
        <button
          type="button"
          className="services-page__refresh"
          aria-label="Refresh"
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw size={17} className={loading ? 'spin-icon' : undefined} />
        </button>
      </header>

      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading && filteredRequests.length === 0 ? (
        <FetchingLoader label="Loading support queue…" />
      ) : filteredRequests.length === 0 ? (
        <div className="warranty-support-page__empty panel glass">
          <LifeBuoy size={36} aria-hidden />
          <p className="text-muted text-sm">No dealer support requests yet.</p>
        </div>
      ) : (
        <ul className="services-page__list">
          {filteredRequests.map(request => (
            <li key={request.id}>
              <button
                type="button"
                className="services-page__card panel glass staff-support-queue__card"
                onClick={() => navigate(supportDetailPath(user.role, request.id))}
              >
                <div className="services-page__card-head">
                  <div className="warranty-support-page__card-id">
                    <strong>{request.requestNumber}</strong>
                    <span className={`support-type-badge ${typeClass(request.type)}`}>
                      {SUPPORT_TYPE_LABELS[request.type]}
                    </span>
                  </div>
                  <span className={`service-request-status ${supportStatusClass(request.status)}`}>
                    {SUPPORT_REQUEST_STATUS_LABELS[request.status]}
                  </span>
                </div>
                <p className="services-page__card-item">
                  {request.dealerName || 'Dealer'} · {request.product?.name || request.subject || request.category}
                  {request.assignedToName && (
                    <span className="staff-support-queue__assignee text-muted text-sm">
                      {' '}· {request.assignedToName}
                    </span>
                  )}
                </p>
                <p className="services-page__card-issue text-sm text-muted">
                  {request.lastMessagePreview || request.description}
                </p>
                <div className="staff-support-queue__foot">
                  <span className="text-muted text-sm">
                    {formatInvoiceDate(request.lastMessageAt ?? request.updatedAt ?? request.createdAt)}
                  </span>
                  <ChevronRight size={18} aria-hidden />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
