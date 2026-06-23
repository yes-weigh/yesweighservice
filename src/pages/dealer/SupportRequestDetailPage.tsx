import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, PackageCheck, Truck } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { SupportChat } from '../../components/support/SupportChat';
import { SupportCourierInstructions } from '../../components/support/SupportCourierInstructions';
import { SupportAssigneeSelect } from '../../components/support/SupportAssigneeSelect';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
import { formatInvoiceDate } from '../../lib/invoices';
import {
  approveSupportRequestForCourier,
  cancelSupportRequest,
  canUserAccessSupportRequest,
  deleteSupportRequest,
  getSupportRequest,
  markSupportProductReceived,
  markSupportProductShipped,
  resolveSupportRequest,
  subscribeSupportRequest,
  supportBasePath,
  updateSupportOpenStage,
} from '../../lib/dealerSupport';
import { useConfirm } from '../../context/ConfirmContext';
import { navigateBack } from '../../lib/navigation';
import { canManageSupportOps, isInternalOpsUser } from '../../lib/staffAccess';
import {
  canDealerCancelSupportRequest,
  isProductCourierType,
  isSupportDraft,
  isSupportOpen,
  staffStagesForRequest,
  supportDisplayLabel,
  supportStatusClass,
  SUPPORT_OPEN_STAGES,
} from '../../lib/supportStatus';
import { supportRequestStageSubtitle } from '../../lib/supportRequestDisplay';
import type { DealerSupportRequest, SupportOpenStage } from '../../types/dealer-support';
import { SUPPORT_OPEN_STAGE_LABELS, SUPPORT_TYPE_LABELS } from '../../types/dealer-support';

export const SupportRequestDetailPage: React.FC = () => {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const base = user ? supportBasePath(user.role) : '/dealer/warranty-support';

  const [request, setRequest] = useState<DealerSupportRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [tracking, setTracking] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');

  const handleBack = useCallback(() => navigateBack(navigate, base), [navigate, base]);

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
      } else if (isSupportDraft(data) && !isInternalOpsUser(user)) {
        navigate(supportBasePath(user.role), {
          replace: true,
          state: { resumeDraft: data },
        });
      } else {
        setRequest(data);
        setTracking(data.courierTracking ?? '');
        setError('');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [requestId, user, navigate]);

  useEffect(() => {
    if (!requestId || !user) return undefined;
    return subscribeSupportRequest(requestId, data => {
      if (data && canUserAccessSupportRequest(user, data)) {
        if (isSupportDraft(data) && !isInternalOpsUser(user)) {
          navigate(supportBasePath(user.role), {
            replace: true,
            state: { resumeDraft: data },
          });
          return;
        }
        setRequest(data);
        setTracking(data.courierTracking ?? '');
      }
    });
  }, [requestId, user, navigate]);

  const runStatusAction = async (action: () => Promise<void>) => {
    if (!user || !requestId) return;
    setStatusUpdating(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleStageChange = (openStage: SupportOpenStage) => {
    void runStatusAction(() => updateSupportOpenStage(user!, requestId!, openStage));
  };

  const handleApproveCourier = () => {
    void runStatusAction(() => approveSupportRequestForCourier(user!, requestId!));
  };

  const handleMarkReceived = () => {
    void runStatusAction(() => markSupportProductReceived(user!, requestId!));
  };

  const handleResolve = () => {
    void runStatusAction(() => resolveSupportRequest(user!, requestId!, resolutionNote));
  };

  const handleCancel = () => {
    void runStatusAction(() => cancelSupportRequest(user!, requestId!));
  };

  const handleDealerCancel = async () => {
    if (!user || !request) return;
    const ok = await confirm({
      title: 'Cancel this request?',
      message: 'This will close the ticket. You can submit a new request anytime if you still need help.',
      confirmLabel: 'Cancel request',
      destructive: true,
    });
    if (!ok) return;
    void runStatusAction(() => cancelSupportRequest(user, requestId!));
  };

  const handleAdminDelete = async () => {
    if (!user || !requestId) return;
    const ok = await confirm({
      title: 'Delete ticket permanently?',
      message: `Remove ${request?.requestNumber ?? 'this ticket'} and all messages. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setStatusUpdating(true);
    setError('');
    try {
      await deleteSupportRequest(user, requestId);
      navigate(base, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete ticket.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleMarkShipped = () => {
    void runStatusAction(() => markSupportProductShipped(user!, requestId!, tracking));
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

  const showCourier =
    isProductCourierType(request.type)
    && (
      isInternalOpsUser(user)
      || request.openStage === 'awaiting_product'
      || request.openStage === 'in_transit'
      || request.openStage === 'in_workshop'
    );

  const staffStageOptions = (() => {
    if (!isSupportOpen(request) || !request.openStage) return [];
    const allowed = new Set(staffStagesForRequest(request));
    allowed.add(request.openStage);
    return SUPPORT_OPEN_STAGES.filter(stage => allowed.has(stage));
  })();

  const canApproveCourier =
    canManageSupportOps(user)
    && isSupportOpen(request)
    && (request.openStage === 'submitted' || request.openStage === 'under_review')
    && isProductCourierType(request.type);

  const canMarkReceived =
    canManageSupportOps(user)
    && isSupportOpen(request)
    && request.openStage === 'in_transit';

  const canDealerShip =
    !isInternalOpsUser(user)
    && isSupportOpen(request)
    && request.openStage === 'awaiting_product';

  const canDealerCancel =
    !isInternalOpsUser(user)
    && canDealerCancelSupportRequest(request);

  const stageSubtitle = supportRequestStageSubtitle(request);

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
            {stageSubtitle && (
              <p className="support-detail-summary__stage text-sm">{stageSubtitle}</p>
            )}
          </div>
          {canManageSupportOps(user) && isSupportOpen(request) ? (
            <div className="support-detail-summary__controls">
              {canApproveCourier && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={statusUpdating}
                  onClick={handleApproveCourier}
                >
                  Approve for courier
                </button>
              )}
              {canMarkReceived && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={statusUpdating}
                  onClick={handleMarkReceived}
                >
                  <PackageCheck size={15} />
                  Product received
                </button>
              )}
              <select
                className="catalog-select support-detail-summary__status"
                value={request.openStage ?? ''}
                disabled={statusUpdating}
                onChange={e => handleStageChange(e.target.value as SupportOpenStage)}
              >
                {staffStageOptions.map(stage => (
                  <option key={stage} value={stage}>
                    {SUPPORT_OPEN_STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
              <SupportAssigneeSelect user={user!} request={request} />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={statusUpdating}
                onClick={handleResolve}
              >
                Resolve
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={statusUpdating}
                onClick={handleCancel}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="support-detail-summary__dealer-actions">
              <span className={`service-request-status ${supportStatusClass(request)} support-detail-summary__badge`}>
                {supportDisplayLabel(request, isInternalOpsUser(user) ? 'staff' : 'dealer')}
              </span>
              {canDealerCancel && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={statusUpdating}
                  onClick={() => void handleDealerCancel()}
                >
                  Cancel request
                </button>
              )}
            </div>
          )}
        </div>

        <div className="support-detail-summary__meta text-sm">
          {request.product && <span>{request.product.name}</span>}
          {request.invoiceNumber && <span>Invoice {request.invoiceNumber}</span>}
          {request.salesOrderNumber && <span>SO {request.salesOrderNumber}</span>}
          <span>{request.category}</span>
          {request.courierTracking && <span>Tracking {request.courierTracking}</span>}
        </div>
        {request.subject && <p className="support-detail-summary__subject">{request.subject}</p>}

        {request.lifecycle === 'resolved' && request.resolutionSummary && (
          <p className="support-detail-summary__resolution text-sm">
            <strong>Resolution:</strong> {request.resolutionSummary}
          </p>
        )}

        {canManageSupportOps(user) && isSupportOpen(request) && (
          <label className="support-detail-summary__resolve-note text-sm">
            <span className="text-muted">Resolution note (optional)</span>
            <input
              type="text"
              className="catalog-input"
              value={resolutionNote}
              onChange={e => setResolutionNote(e.target.value)}
              placeholder="Brief summary for internal records"
            />
            </label>
        )}

        {user?.role === 'super_admin' && (
          <div className="support-detail-summary__admin-actions">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={statusUpdating}
              onClick={() => void handleAdminDelete()}
            >
              Delete ticket
            </button>
          </div>
        )}
      </section>

      {canDealerShip && (
        <section className="support-detail-ship panel glass">
          <h3>
            <Truck size={18} aria-hidden />
            Mark product as shipped
          </h3>
          <p className="text-muted text-sm">
            After you courier the product to YesOne, confirm shipment below. Add a tracking number if you have one.
          </p>
          <div className="support-detail-ship__form">
            <input
              type="text"
              className="catalog-input"
              value={tracking}
              onChange={e => setTracking(e.target.value)}
              placeholder="Courier tracking number (optional)"
              disabled={statusUpdating}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={statusUpdating}
              onClick={handleMarkShipped}
            >
              I&apos;ve shipped the product
            </button>
          </div>
        </section>
      )}

      <SupportChat request={request} />

      {!isInternalOpsUser(user)
        && isProductCourierType(request.type)
        && isSupportOpen(request)
        && (request.openStage === 'submitted' || request.openStage === 'under_review') && (
        <p className="support-detail-page__notice panel glass text-sm text-muted">
          Your request is under review. Shipping instructions will appear here once YesOne approves courier.
        </p>
      )}

      {showCourier && (
        <SupportCourierInstructions requestNumber={request.requestNumber} compact />
      )}
    </div>
  );
};
