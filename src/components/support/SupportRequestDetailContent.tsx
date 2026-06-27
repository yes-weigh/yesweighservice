import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { SupportChat } from './SupportChat';
import { SupportLogisticsPanel } from './SupportLogisticsPanel';
import { SupportRequestDetailPanel } from './SupportRequestDetailPanel';
import {
  SupportRequestDetailTabs,
  type SupportDetailTab,
} from './SupportRequestDetailTabs';
import { SupportTicketFlowTimeline } from './SupportTicketFlowTimeline';
import { useConfirm } from '../../context/ConfirmContext';
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
import { canManageSupportOps, isInternalOpsUser } from '../../lib/staffAccess';
import {
  canDealerCancelSupportRequest,
  isProductCourierType,
  isSupportDraft,
  isSupportOpen,
  staffStagesForRequest,
  SUPPORT_OPEN_STAGES,
} from '../../lib/supportStatus';
import type { User } from '../../types';
import type { DealerSupportRequest, SupportOpenStage } from '../../types/dealer-support';

export interface SupportRequestDetailContentProps {
  requestId: string;
  user: User;
  className?: string;
  embedded?: boolean;
  detailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
  onRequestLoaded?: (request: DealerSupportRequest) => void;
  onDeleted?: () => void;
}

export const SupportRequestDetailContent: React.FC<SupportRequestDetailContentProps> = ({
  requestId,
  user,
  className = '',
  embedded = false,
  detailsOpen: detailsOpenProp,
  onDetailsOpenChange,
  onRequestLoaded,
  onDeleted,
}) => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const base = supportBasePath(user.role);

  const [request, setRequest] = useState<DealerSupportRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [tracking, setTracking] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [detailsOpenInternal, setDetailsOpenInternal] = useState(false);
  const [activeTab, setActiveTab] = useState<SupportDetailTab>('chat');

  const detailsOpen = detailsOpenProp ?? detailsOpenInternal;
  const setDetailsOpen = onDetailsOpenChange ?? setDetailsOpenInternal;
  const closeDetails = useCallback(() => setDetailsOpen(false), [setDetailsOpen]);

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
      } else if (isSupportDraft(data) && !isInternalOpsUser(user) && !embedded) {
        navigate(supportBasePath(user.role), {
          replace: true,
          state: { resumeDraft: data },
        });
      } else {
        setRequest(data);
        setTracking(data.courierTracking ?? '');
        setError('');
        onRequestLoaded?.(data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [requestId, user, navigate, embedded, onRequestLoaded]);

  useEffect(() => {
    return subscribeSupportRequest(requestId, data => {
      if (data && canUserAccessSupportRequest(user, data)) {
        if (isSupportDraft(data) && !isInternalOpsUser(user) && !embedded) {
          navigate(supportBasePath(user.role), {
            replace: true,
            state: { resumeDraft: data },
          });
          return;
        }
        setRequest(data);
        setTracking(data.courierTracking ?? '');
        onRequestLoaded?.(data);
      }
    });
  }, [requestId, user, navigate, embedded, onRequestLoaded]);

  const runStatusAction = async (action: () => Promise<void>) => {
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
    void runStatusAction(() => updateSupportOpenStage(user, requestId, openStage));
  };

  const handleApproveCourier = () => {
    void runStatusAction(() => approveSupportRequestForCourier(user, requestId));
  };

  const handleMarkReceived = () => {
    void runStatusAction(() => markSupportProductReceived(user, requestId));
  };

  const handleResolve = () => {
    void runStatusAction(() => resolveSupportRequest(user, requestId, resolutionNote));
  };

  const handleCancel = () => {
    void runStatusAction(() => cancelSupportRequest(user, requestId));
  };

  const handleDealerCancel = async () => {
    if (!request) return;
    const ok = await confirm({
      title: 'Cancel this request?',
      message: 'This will close the ticket. You can submit a new request anytime if you still need help.',
      confirmLabel: 'Cancel request',
      destructive: true,
    });
    if (!ok) return;
    void runStatusAction(() => cancelSupportRequest(user, requestId));
  };

  const handleAdminDelete = async () => {
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
      if (onDeleted) onDeleted();
      else navigate(base, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete ticket.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleMarkShipped = () => {
    void runStatusAction(() => markSupportProductShipped(user, requestId, tracking));
  };

  if (loading) {
    return (
      <div className={`support-detail-page ${className}`.trim()}>
        <FetchingLoader label="Loading support request…" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className={`support-detail-page ${className}`.trim()}>
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error || 'Support request not found.'}</span>
        </div>
      </div>
    );
  }

  const showLogisticsTab = isProductCourierType(request.type);

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
    <div
      className={[
        'support-detail-page',
        'support-detail-page--chat',
        'support-detail-page--with-tabs',
        embedded ? 'support-detail-page--embedded' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <SupportRequestDetailTabs
        active={activeTab}
        onChange={setActiveTab}
        showLogistics={showLogisticsTab}
      />

      <SupportRequestDetailPanel
        request={request}
        user={user}
        open={detailsOpen}
        onClose={closeDetails}
        error={error}
        statusUpdating={statusUpdating}
        resolutionNote={resolutionNote}
        onResolutionNoteChange={setResolutionNote}
        staffStageOptions={staffStageOptions}
        canApproveCourier={canApproveCourier}
        canMarkReceived={canMarkReceived}
        canDealerCancel={canDealerCancel}
        onStageChange={handleStageChange}
        onApproveCourier={handleApproveCourier}
        onMarkReceived={handleMarkReceived}
        onResolve={handleResolve}
        onCancel={handleCancel}
        onDealerCancel={() => void handleDealerCancel()}
        onAdminDelete={() => void handleAdminDelete()}
      />

      {activeTab === 'chat' && (
        <div
          id="support-detail-panel-chat"
          role="tabpanel"
          aria-labelledby="support-detail-tab-chat"
          className="support-detail-page__tab-panel"
        >
          <SupportChat request={request} />
        </div>
      )}

      {activeTab === 'flow' && (
        <div
          id="support-detail-panel-flow"
          role="tabpanel"
          aria-labelledby="support-detail-tab-flow"
          className="support-detail-page__tab-panel support-detail-page__tab-panel--flow"
        >
          <SupportTicketFlowTimeline
            request={request}
            user={user}
            onContactSupport={() => setActiveTab('chat')}
          />
        </div>
      )}

      {activeTab === 'logistics' && showLogisticsTab && (
        <div
          id="support-detail-panel-logistics"
          role="tabpanel"
          aria-labelledby="support-detail-tab-logistics"
          className="support-detail-page__tab-panel support-detail-page__tab-panel--flow"
        >
          <SupportLogisticsPanel
            request={request}
            user={user}
            tracking={tracking}
            onTrackingChange={setTracking}
            canDealerShip={canDealerShip}
            statusUpdating={statusUpdating}
            onMarkShipped={handleMarkShipped}
          />
        </div>
      )}
    </div>
  );
};
