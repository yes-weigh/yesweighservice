import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, LifeBuoy, Plus } from 'lucide-react';
import { SupportWizard } from '../../components/support/SupportWizard';
import { useAuth } from '../../context/AuthContext';
import { useTopBarAction } from '../../context/PageHeaderContext';
import { fetchDealerSupportRequests, supportBasePath, supportDetailPath } from '../../lib/dealerSupport';
import { StaffSupportQueue } from '../../components/support/StaffSupportQueue';
import { isInternalOpsUser, canCreateSupportOnBehalf } from '../../lib/staffAccess';
import type {
  DealerSupportRequest,
  SupportProductDraft,
  SupportRequestType,
} from '../../types/dealer-support';
import { isSupportDraft } from '../../lib/supportStatus';
import { DealerSupportRequestList } from '../../components/support/DealerSupportRequestList';

interface LocationState {
  draft?: SupportProductDraft;
  intent?: SupportRequestType;
  resumeDraft?: DealerSupportRequest;
  createdRequestNumber?: string;
  createdRequestType?: SupportRequestType;
  openWizard?: boolean;
}

export const WarrantySupportPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? {};

  const isOps = isInternalOpsUser(user);
  const canCreateOnBehalf = canCreateSupportOnBehalf(user);
  const canUseSupport = user?.role === 'dealer' || user?.role === 'dealer_staff';
  const supportPath = user && canUseSupport ? supportBasePath(user.role) : '/dealer/warranty-support';

  const [requests, setRequests] = useState<DealerSupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showWizard, setShowWizard] = useState(
    Boolean(state.draft || state.intent || state.resumeDraft || state.openWizard),
  );
  const [draftMessage, setDraftMessage] = useState('');
  const [resumeDraft, setResumeDraft] = useState<DealerSupportRequest | null>(
    state.resumeDraft ?? null,
  );

  const productDraft = state.draft ?? null;
  const initialIntent = state.intent ?? (productDraft ? 'service' : null);

  const load = useCallback(async () => {
    if (!user || !canUseSupport) return;
    setLoading(true);
    setError('');
    try {
      setRequests(await fetchDealerSupportRequests(user));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load support requests.');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [user, canUseSupport]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state.draft || state.intent || state.resumeDraft || state.openWizard) {
      setShowWizard(true);
    }
    if (state.resumeDraft) {
      setResumeDraft(state.resumeDraft);
    }
  }, [state.draft, state.intent, state.resumeDraft, state.openWizard]);

  const openRequest = useCallback((request: DealerSupportRequest) => {
    if (!user) return;
    if (isSupportDraft(request)) {
      setResumeDraft(request);
      setShowWizard(true);
      setDraftMessage('');
      return;
    }
    navigate(supportDetailPath(user.role, request.id));
  }, [user, navigate]);

  const closeWizard = useCallback(() => {
    setShowWizard(false);
    setResumeDraft(null);
    navigate(supportPath, { replace: true, state: {} });
  }, [navigate, supportPath]);

  const handleDraftSaved = useCallback((requestNumber: string) => {
    setDraftMessage(`Draft ${requestNumber} saved. You can continue it anytime from your list.`);
    setShowWizard(false);
    setResumeDraft(null);
    navigate(supportPath, { replace: true, state: {} });
    void load();
  }, [load, navigate, supportPath]);

  const handleWizardSuccess = useCallback(() => {
    setShowWizard(false);
    setResumeDraft(null);
    navigate(supportPath, { replace: true, state: {} });
    void load();
  }, [load, navigate, supportPath]);

  const startNewRequest = useCallback(() => {
    setShowWizard(true);
    setDraftMessage('');
  }, []);

  const topBarNewRequest = useMemo(
    () => (
      <button
        type="button"
        className="cart-header-btn cart-header-btn--primary"
        onClick={startNewRequest}
        aria-label="New request"
        title="New request"
      >
        <Plus size={22} />
      </button>
    ),
    [startNewRequest],
  );

  useTopBarAction(topBarNewRequest, (canUseSupport || canCreateOnBehalf) && !showWizard);

  if (!canUseSupport && !isOps) {
    return (
      <div className="page-content fade-in warranty-support-page">
        <div className="warranty-support-page__empty panel glass">
          <LifeBuoy size={40} aria-hidden />
          <h3>Warranty &amp; Support</h3>
          <p className="text-muted text-sm">Available to dealer accounts.</p>
        </div>
      </div>
    );
  }

  if (isOps && user) {
    return (
      <div className="page-content fade-in warranty-support-page">
        {showWizard ? (
          <SupportWizard
            user={user}
            productDraft={null}
            opsCreateMode={canCreateOnBehalf}
            onCancel={closeWizard}
            onSuccess={handleWizardSuccess}
          />
        ) : (
          <StaffSupportQueue />
        )}
      </div>
    );
  }

  if (!canUseSupport) {
    return null;
  }

  return (
    <div className="page-content fade-in warranty-support-page">
      {draftMessage && !showWizard && (
        <div className="services-page__success panel glass">
          {draftMessage}
        </div>
      )}


      {error && (
        <div className="products-inline-error panel glass services-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {showWizard ? (
        <SupportWizard
          user={user!}
          productDraft={productDraft}
          initialIntent={initialIntent}
          resumeDraft={resumeDraft}
          onCancel={closeWizard}
          onSuccess={handleWizardSuccess}
          onDraftSaved={handleDraftSaved}
        />
      ) : (
        <DealerSupportRequestList
          requests={requests}
          loading={loading}
          onOpenRequest={openRequest}
          onRefresh={() => void load()}
        />
      )}
    </div>
  );
};
