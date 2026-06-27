import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { useConfirm } from '../../context/ConfirmContext';
import {
  cancelSupportRequest,
  canUserAccessSupportRequest,
  getSupportRequest,
  subscribeSupportRequest,
} from '../../lib/dealerSupport';
import type { User } from '../../types';
import type { DealerSupportRequest } from '../../types/dealer-support';
import { SupportRequestTicketInfo } from './SupportRequestTicketInfo';

export interface SupportRequestSubmittedSummaryProps {
  requestId: string;
  user: User;
  onRequestLoaded?: (request: DealerSupportRequest) => void;
  onCancelled?: () => void;
}

export const SupportRequestSubmittedSummary: React.FC<SupportRequestSubmittedSummaryProps> = ({
  requestId,
  user,
  onRequestLoaded,
  onCancelled,
}) => {
  const confirm = useConfirm();
  const [request, setRequest] = useState<DealerSupportRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getSupportRequest(requestId).then(data => {
      if (cancelled) return;
      if (!data || !canUserAccessSupportRequest(user, data)) {
        setError('Could not load ticket information.');
        setRequest(null);
      } else {
        setRequest(data);
        setError('');
        onRequestLoaded?.(data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [requestId, user, onRequestLoaded]);

  useEffect(() => {
    return subscribeSupportRequest(requestId, data => {
      if (data && canUserAccessSupportRequest(user, data)) {
        setRequest(data);
        onRequestLoaded?.(data);
      }
    });
  }, [requestId, user, onRequestLoaded]);

  const handleCancel = async () => {
    if (!request) return;
    const ok = await confirm({
      title: 'Cancel this request?',
      message: 'This will close the ticket. You can submit a new request anytime if you still need help.',
      confirmLabel: 'Cancel request',
      destructive: true,
    });
    if (!ok) return;
    setStatusUpdating(true);
    setError('');
    try {
      await cancelSupportRequest(user, requestId);
      onCancelled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel request.');
    } finally {
      setStatusUpdating(false);
    }
  };

  if (loading) {
    return <FetchingLoader label="Loading ticket information…" />;
  }

  if (!request) {
    return (
      <div className="products-inline-error panel glass">
        <AlertCircle size={18} />
        <span>{error || 'Could not load ticket information.'}</span>
      </div>
    );
  }

  return (
    <div className="support-wizard__success-ticket panel glass">
      {error && (
        <div className="products-inline-error support-wizard__success-ticket-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      <SupportRequestTicketInfo
        request={request}
        user={user}
        statusUpdating={statusUpdating}
        onCancel={() => void handleCancel()}
      />
    </div>
  );
};
