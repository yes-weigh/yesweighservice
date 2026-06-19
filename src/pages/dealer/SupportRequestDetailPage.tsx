import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { SupportChat } from '../../components/support/SupportChat';
import { SupportCourierInstructions } from '../../components/support/SupportCourierInstructions';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
import { formatInvoiceDate } from '../../lib/invoices';
import {
  canUserAccessSupportRequest,
  getSupportRequest,
  subscribeSupportRequest,
  supportBasePath,
  updateSupportRequestStatus,
} from '../../lib/dealerSupport';
import { canManageSupportOps, isInternalOpsUser } from '../../lib/staffAccess';
import type { DealerSupportRequest, SupportRequestStatus } from '../../types/dealer-support';
import {
  SUPPORT_REQUEST_STATUS_LABELS,
  SUPPORT_TYPE_LABELS,
} from '../../types/dealer-support';

export const SupportRequestDetailPage: React.FC = () => {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = user ? supportBasePath(user.role) : '/dealer/warranty-support';

  const [request, setRequest] = useState<DealerSupportRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);

  const handleBack = useCallback(() => navigate(base), [navigate, base]);

  useCatalogPageHeader({
    title: request?.requestNumber ?? 'Support request',
    showBack: true,
    onBack: handleBack,
  });

  useEffect(() => {
    if (!requestId || !user) return;
    let cancelled = false;
    setLoading(true);
    void getSupportRequest(requestId).then(data => {
      if (cancelled) return;
      if (!data) {
        setError('Support request not found.');
        setRequest(null);
      } else if (!canUserAccessSupportRequest(user, data)) {
        setError('You do not have access to this request.');
        setRequest(null);
      } else {
        setRequest(data);
        setError('');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [requestId, user]);

  useEffect(() => {
    if (!requestId || !user) return undefined;
    return subscribeSupportRequest(requestId, data => {
      if (data && canUserAccessSupportRequest(user, data)) {
        setRequest(data);
      }
    });
  }, [requestId, user]);

  const handleStatusChange = async (status: SupportRequestStatus) => {
    if (!user || !requestId || !request) return;
    setStatusUpdating(true);
    setError('');
    try {
      await updateSupportRequestStatus(user, requestId, status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.');
    } finally {
      setStatusUpdating(false);
    }
  };

  if (!requestId) return null;

  if (loading) {
    return (
      <div className="page-content fade-in support-detail-page">
        <FetchingLoader label="Loading support request…" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="page-content fade-in support-detail-page">
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error || 'Support request not found.'}</span>
        </div>
      </div>
    );
  }

  const showCourier = request.type === 'service' || request.type === 'return';

  return (
    <div className="page-content fade-in support-detail-page">
      {error && (
        <div className="products-inline-error panel glass support-detail-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="support-detail-summary panel glass">
        <div className="support-detail-summary__head">
          <div>
            <h2>{request.requestNumber}</h2>
            <p className="text-muted text-sm">
              {SUPPORT_TYPE_LABELS[request.type]}
              {request.dealerName && isInternalOpsUser(user) && (
                <span> · {request.dealerName}</span>
              )}
              · Opened {formatInvoiceDate(request.createdAt)}
            </p>
          </div>
          {canManageSupportOps(user) ? (
            <select
              className="catalog-select support-detail-summary__status"
              value={request.status}
              disabled={statusUpdating}
              onChange={e => void handleStatusChange(e.target.value as SupportRequestStatus)}
            >
              {(Object.keys(SUPPORT_REQUEST_STATUS_LABELS) as SupportRequestStatus[]).map(status => (
                <option key={status} value={status}>
                  {SUPPORT_REQUEST_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          ) : (
            <span className={`service-request-status support-detail-summary__badge support-detail-summary__badge--${request.status}`}>
              {SUPPORT_REQUEST_STATUS_LABELS[request.status]}
            </span>
          )}
        </div>

        <div className="support-detail-summary__meta text-sm">
          {request.product && <span>{request.product.name}</span>}
          {request.invoiceNumber && <span>Invoice {request.invoiceNumber}</span>}
          {request.salesOrderNumber && <span>SO {request.salesOrderNumber}</span>}
          <span>{request.category}</span>
        </div>
        {request.subject && <p className="support-detail-summary__subject">{request.subject}</p>}
      </section>

      <SupportChat request={request} />

      {showCourier && (
        <SupportCourierInstructions requestNumber={request.requestNumber} compact />
      )}
    </div>
  );
};
