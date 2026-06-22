import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { formatInvoiceDate } from '../../lib/invoices';
import {
  fetchSupportRequestsForInvoice,
  supportDetailPath,
} from '../../lib/dealerSupport';
import type { DealerSupportRequest } from '../../types/dealer-support';
import {
  SUPPORT_REQUEST_STATUS_LABELS,
  SUPPORT_TYPE_LABELS,
} from '../../types/dealer-support';

interface RelatedSupportRequestsProps {
  dealerId: string;
  invoiceId: string;
  invoiceNumber?: string | null;
}

export const RelatedSupportRequests: React.FC<RelatedSupportRequestsProps> = ({
  dealerId,
  invoiceId,
  invoiceNumber,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<DealerSupportRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchSupportRequestsForInvoice(dealerId, invoiceId)
      .then(rows => {
        if (!cancelled) setRequests(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dealerId, invoiceId]);

  if (loading) {
    return (
      <section className="related-support panel glass">
        <FetchingLoader label="Loading related support requests…" />
      </section>
    );
  }

  if (!requests.length) return null;

  return (
    <section className="related-support panel glass">
      <header className="related-support__head">
        <LifeBuoy size={18} aria-hidden />
        <div>
          <h3>Related support requests</h3>
          {invoiceNumber && (
            <p className="text-muted text-sm">For invoice {invoiceNumber}</p>
          )}
        </div>
      </header>
      <ul className="related-support__list">
        {requests.map(request => (
          <li key={request.id}>
            <button
              type="button"
              className="related-support__item"
              onClick={() => user && navigate(supportDetailPath(user.role, request.id))}
            >
              <div>
                <strong>{request.requestNumber}</strong>
                <span className="text-muted text-sm">
                  {' '}
                  · {SUPPORT_TYPE_LABELS[request.type]}
                </span>
              </div>
              <div className="related-support__meta text-sm text-muted">
                <span>{SUPPORT_REQUEST_STATUS_LABELS[request.status]}</span>
                <span>{formatInvoiceDate(request.updatedAt)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
