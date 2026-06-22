import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, LifeBuoy, Plus, RefreshCw } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { SupportWizard } from '../../components/support/SupportWizard';
import { SupportCourierInstructions } from '../../components/support/SupportCourierInstructions';
import { useAuth } from '../../context/AuthContext';
import { formatInvoiceDate } from '../../lib/invoices';
import { fetchDealerSupportRequests, supportBasePath, supportDetailPath } from '../../lib/dealerSupport';
import { StaffSupportQueue } from '../../components/support/StaffSupportQueue';
import { isInternalOpsUser } from '../../lib/staffAccess';
import type {
  DealerSupportRequest,
  SupportProductDraft,
  SupportRequestType,
} from '../../types/dealer-support';
import {
  SUPPORT_REQUEST_STATUS_LABELS,
  SUPPORT_TYPE_LABELS,
} from '../../types/dealer-support';

type FilterType = 'all' | SupportRequestType;

interface LocationState {
  draft?: SupportProductDraft;
  intent?: SupportRequestType;
  resumeDraft?: DealerSupportRequest;
  createdRequestNumber?: string;
  createdRequestType?: SupportRequestType;
}

function statusClass(status: DealerSupportRequest['status']): string {
  if (status === 'draft') return 'service-request-status--draft';
  if (status === 'completed') return 'service-request-status--done';
  if (status === 'in_progress') return 'service-request-status--active';
  if (status === 'cancelled') return 'service-request-status--cancelled';
  return 'service-request-status--pending';
}

function typeClass(type: SupportRequestType): string {
  return `support-type-badge--${type}`;
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
  const [filter, setFilter] = useState<FilterType>('all');
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

  const filteredRequests = useMemo(
    () => (filter === 'all' ? requests : requests.filter(r => r.type === filter)),
    [filter, requests],
  );

  const counts = useMemo(() => ({
    all: requests.length,
    service: requests.filter(r => r.type === 'service').length,
    return: requests.filter(r => r.type === 'return').length,
    complaint: requests.filter(r => r.type === 'complaint').length,
  }), [requests]);

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
          <p className="text-muted text-sm">
            Repairs, replacements, and complaints — one place for after-sales help.
            Product repair and replacement: courier to YesOne after approval.
          </p>
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
        <>
          <div className="warranty-support-page__filters" role="tablist" aria-label="Filter requests">
            {([
              ['all', 'All'],
              ['service', 'Service'],
              ['return', 'Replacements'],
              ['complaint', 'Complaints'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                className={`warranty-support-page__filter ${filter === value ? 'is-active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {label}
                <span className="warranty-support-page__filter-count">{counts[value]}</span>
              </button>
            ))}
          </div>

          {loading && requests.length === 0 ? (
            <FetchingLoader label="Loading support requests…" />
          ) : filteredRequests.length === 0 ? (
            <div className="warranty-support-page__empty panel glass">
              <LifeBuoy size={40} aria-hidden />
              <h3>No {filter === 'all' ? 'requests' : `${SUPPORT_TYPE_LABELS[filter as SupportRequestType].toLowerCase()} requests`} yet</h3>
              <p className="text-muted text-sm">
                Tap <strong>New request</strong> and we&apos;ll guide you — repair, replacement, or complaint.
              </p>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowWizard(true)}
              >
                <Plus size={16} />
                New request
              </button>
            </div>
          ) : (
            <ul className="services-page__list">
              {filteredRequests.map(request => (
                <li key={request.id}>
                  <button
                    type="button"
                    className="services-page__card panel glass warranty-support-page__card-btn"
                    onClick={() => {
                      if (!user) return;
                      if (request.status === 'draft') {
                        setResumeDraft(request);
                        setShowWizard(true);
                        setSuccessMessage('');
                        setDraftMessage('');
                        return;
                      }
                      navigate(supportDetailPath(user.role, request.id));
                    }}
                  >
                    <div className="services-page__card-head">
                    <div className="warranty-support-page__card-id">
                      <strong>{request.requestNumber}</strong>
                      <span className={`support-type-badge ${typeClass(request.type)}`}>
                        {SUPPORT_TYPE_LABELS[request.type]}
                      </span>
                    </div>
                    <span className={`service-request-status ${statusClass(request.status)}`}>
                      {SUPPORT_REQUEST_STATUS_LABELS[request.status]}
                    </span>
                  </div>
                  {request.product && (
                    <p className="services-page__card-item">{request.product.name}</p>
                  )}
                  {request.subject && (
                    <p className="services-page__card-item">{request.subject}</p>
                  )}
                  <div className="services-page__card-meta text-muted text-sm">
                    {request.invoiceNumber && <span>Invoice {request.invoiceNumber}</span>}
                    {request.salesOrderNumber && <span>SO {request.salesOrderNumber}</span>}
                    <span>{formatInvoiceDate(request.createdAt)}</span>
                  </div>
                  <p className="services-page__card-issue text-sm">
                    {request.status === 'draft'
                      ? (request.description || 'Draft — tap to continue and submit')
                      : (
                        <>
                          {request.lastMessagePreview || request.category}
                          {!request.lastMessagePreview && request.description
                            ? ` — ${request.description}`
                            : ''}
                        </>
                      )}
                  </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
