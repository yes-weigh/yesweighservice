import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { SupportChat } from '../../components/support/SupportChat';
import { SupportCourierInstructions } from '../../components/support/SupportCourierInstructions';
import { SupportRequestDetailPanel } from '../../components/support/SupportRequestDetailPanel';
import {
  SupportRequestDetailTabs,
  type SupportDetailTab,
} from '../../components/support/SupportRequestDetailTabs';
import { SupportTicketFlowTimeline } from '../../components/support/SupportTicketFlowTimeline';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
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
  SUPPORT_OPEN_STAGES,
} from '../../lib/supportStatus';
import { supportRequestStageSubtitle } from '../../lib/supportRequestDisplay';
import type { DealerSupportRequest, SupportOpenStage } from '../../types/dealer-support';

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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SupportDetailTab>('chat');

  const handleBack = useCallback(() => navigateBack(navigate, base), [navigate, base]);
  const toggleDetails = useCallback(() => setDetailsOpen(open => !open), []);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);

  useCatalogPageHeader({
    title: request?.requestNumber ?? 'Support request',
    subtitle: request
      ? (supportRequestStageSubtitle(request)
        || supportDisplayLabel(request, isInternalOpsUser(user) ? 'staff' : 'dealer'))
      : null,
    showBack: true,
    onBack: handleBack,
    onTitleClick: request ? toggleDetails : null,
    titleExpanded: detailsOpen,
  });

  useEffect(() => {
    if (!detailsOpen) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetails();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [detailsOpen, closeDetails]);

  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('.top-bar');
    if (!bar) return undefined;

    const syncTop = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--support-detail-tabs-top', `${height}px`);
    };

    syncTop();
    const observer = new ResizeObserver(syncTop);
    observer.observe(bar);
    window.addEventListener('resize', syncTop);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncTop);
      document.documentElement.style.removeProperty('--support-detail-tabs-top');
    };
  }, []);

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

  return (
    <div className="page-content fade-in support-detail-page support-detail-page--chat support-detail-page--with-tabs">
      <SupportRequestDetailTabs active={activeTab} onChange={setActiveTab} />

      <SupportRequestDetailPanel
        request={request}
        user={user}
        open={detailsOpen}
        onClose={closeDetails}
        error={error}
        statusUpdating={statusUpdating}
        tracking={tracking}
        onTrackingChange={setTracking}
        resolutionNote={resolutionNote}
        onResolutionNoteChange={setResolutionNote}
        staffStageOptions={staffStageOptions}
        canApproveCourier={canApproveCourier}
        canMarkReceived={canMarkReceived}
        canDealerShip={canDealerShip}
        canDealerCancel={canDealerCancel}
        onStageChange={handleStageChange}
        onApproveCourier={handleApproveCourier}
        onMarkReceived={handleMarkReceived}
        onResolve={handleResolve}
        onCancel={handleCancel}
        onDealerCancel={() => void handleDealerCancel()}
        onMarkShipped={handleMarkShipped}
        onAdminDelete={() => void handleAdminDelete()}
      />

      {activeTab === 'chat' ? (
        <div
          id="support-detail-panel-chat"
          role="tabpanel"
          aria-labelledby="support-detail-tab-chat"
          className="support-detail-page__tab-panel"
        >
          <SupportChat request={request} />
          {showCourier && (
            <SupportCourierInstructions requestNumber={request.requestNumber} compact />
          )}
        </div>
      ) : (
        <div
          id="support-detail-panel-flow"
          role="tabpanel"
          aria-labelledby="support-detail-tab-flow"
          className="support-detail-page__tab-panel support-detail-page__tab-panel--flow"
        >
          <SupportTicketFlowTimeline request={request} user={user} />
          {showCourier && (
            <SupportCourierInstructions requestNumber={request.requestNumber} compact />
          )}
        </div>
      )}
    </div>
  );
};
