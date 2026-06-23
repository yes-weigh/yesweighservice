import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, LifeBuoy, Plus, RefreshCw } from 'lucide-react';
import { SupportWizard } from '../../components/support/SupportWizard';
import { SupportCourierInstructions } from '../../components/support/SupportCourierInstructions';
import { useAuth } from '../../context/AuthContext';
import { fetchDealerSupportRequests, supportBasePath, supportDetailPath } from '../../lib/dealerSupport';
import { StaffSupportQueue } from '../../components/support/StaffSupportQueue';
import { isInternalOpsUser } from '../../lib/staffAccess';
import type {
  DealerSupportRequest,
  SupportProductDraft,
  SupportRequestType,
} from '../../types/dealer-support';
import { DealerSupportRequestList } from '../../components/support/DealerSupportRequestList';

interface LocationState {
  draft?: SupportProductDraft;
  intent?: SupportRequestType;
  resumeDraft?: DealerSupportRequest;
  createdRequestNumber?: string;
  createdRequestType?: SupportRequestType;
}

export const WarrantySupportPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? {};

  const isOps = isInternalOpsUser(user);
  const canUseSupport = user?.role === 'dealer' || user?.role === 'dealer_staff';
  const supportPath = user && canUseSupport ? supportBasePath(user.role) : '/dealer/warranty-support';

  const [requests, setRequests] = useState<DealerSupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showWizard, setShowWizard] = useState(
    Boolean(state.draft || state.intent || state.resumeDraft),
  );
  const [successMessage, setSuccessMessage] = useState(state.createdRequestNumber ?? '');
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
    if (state.draft || state.intent || state.resumeDraft) {
      setShowWizard(true);
    }
    if (state.resumeDraft) {
      setResumeDraft(state.resumeDraft);
    }
  }, [state.draft, state.intent, state.resumeDraft]);

  const openRequest = (request: DealerSupportRequest) => {
    if (!user) return;
    if (request.status === 'draft') {
      setResumeDraft(request);
      setShowWizard(true);
      setSuccessMessage('');
      setDraftMessage('');
      return;
    }
    navigate(supportDetailPath(user.role, request.id));
  };

  const closeWizard = () => {
    setShowWizard(false);
    setResumeDraft(null);
    navigate(supportPath, { replace: true, state: {} });
  };

  const handleDraftSaved = (requestNumber: string) => {
    setDraftMessage(`Draft ${requestNumber} saved. You can continue it anytime from your list.`);
    setShowWizard(false);
    setResumeDraft(null);
    navigate(supportPath, { replace: true, state: {} });
    void load();
  };

  const handleWizardSuccess = (requestNumber: string, type: SupportRequestType, requestId: string) => {
    setSuccessMessage(requestNumber);
    setShowWizard(false);
    if (user) {
      navigate(supportDetailPath(user.role, requestId), {
        replace: true,
        state: { createdRequestNumber: requestNumber, createdRequestType: type },
      });
    }
    void load();
  };

  const showCourierAfterSubmit =
    Boolean(successMessage)
    && (state.createdRequestType === 'service' || state.createdRequestType === 'return');

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
        <header className="warranty-support-page__header">
          <div>
            <h2 className="warranty-support-page__title">Warranty &amp; Support</h2>
            <p className="text-muted text-sm">
              Review dealer tickets, chat with attachments, and update status.
            </p>
          </div>
        </header>
        <StaffSupportQueue />
      </div>
    );
  }

  if (!canUseSupport) {
    return null;
  }

  return (
    <div className="page-content fade-in warranty-support-page">
      <header className="warranty-support-page__header">
        <div>
          <h2 className="warranty-support-page__title">Warranty &amp; Support</h2>
        </div>
        {!showWizard && (
          <div className="warranty-support-page__actions">
            <button
              type="button"
              className="services-page__refresh"
              aria-label="Refresh"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={17} className={loading ? 'spin-icon' : undefined} />
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setShowWizard(true);
                setSuccessMessage('');
                setDraftMessage('');
              }}
            >
              <Plus size={16} />
              New request
            </button>
          </div>
        )}
      </header>

      {draftMessage && !showWizard && (
        <div className="services-page__success panel glass">
          {draftMessage}
        </div>
      )}

      {successMessage && !showWizard && (
        <>
          <div className="services-page__success panel glass">
            Request <strong>{successMessage}</strong> submitted. Our support team will follow up.
          </div>
          {showCourierAfterSubmit && (
            <SupportCourierInstructions requestNumber={successMessage} compact />
          )}
        </>
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
          onNewRequest={() => {
            setShowWizard(true);
            setSuccessMessage('');
            setDraftMessage('');
          }}
        />
      )}
    </div>
  );
};
