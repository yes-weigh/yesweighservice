import React from 'react';
import { Calendar, ChevronRight, Package } from 'lucide-react';
import type { DealerSupportRequest } from '../../types/dealer-support';
import {
  formatSupportDateTimeCompact,
  formatSupportDaysSinceSubmission,
  formatSupportInvoiceDateCompact,
  supportRequestIssueSummary,
  supportRequestStageSubtitle,
  supportRequestStatusLabel,
  supportRequestStatusTone,
} from '../../lib/supportRequestDisplay';

interface SupportRequestCardProps {
  request: DealerSupportRequest;
  imageUrl?: string | null;
  invoiceDate?: string | null;
  onClick: () => void;
}

export const SupportRequestCard: React.FC<SupportRequestCardProps> = ({
  request,
  imageUrl,
  invoiceDate,
  onClick,
}) => {
  const statusTone = supportRequestStatusTone(request);
  const daysSinceSubmission = formatSupportDaysSinceSubmission(request.createdAt);

  return (
    <button type="button" className="support-ticket-card panel glass" onClick={onClick}>
      <div className="support-ticket-card__media">
        <div className="support-ticket-card__thumb">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="support-ticket-card__image" loading="lazy" decoding="async" />
          ) : (
            <span className="support-ticket-card__placeholder" aria-hidden>
              <Package size={22} />
            </span>
          )}
        </div>

        <p className="support-ticket-card__datetime text-sm">
          <Calendar size={12} aria-hidden />
          {formatSupportInvoiceDateCompact(invoiceDate)}
        </p>
      </div>

      <div className="support-ticket-card__body">
        <div className="support-ticket-card__head">
          <strong className="support-ticket-card__id">{request.requestNumber}</strong>
          <span className={`support-ticket-card__status support-ticket-card__status--${statusTone}`}>
            {supportRequestStatusLabel(request)}
          </span>
        </div>

        {supportRequestStageSubtitle(request) && (
          <p className="support-ticket-card__stage text-sm text-muted">
            {supportRequestStageSubtitle(request)}
          </p>
        )}

        {request.product?.name && (
          <p className="support-ticket-card__product">{request.product.name}</p>
        )}
        {request.subject && !request.product?.name && (
          <p className="support-ticket-card__product">{request.subject}</p>
        )}

        <div className="support-ticket-card__meta text-muted text-sm">
          {request.invoiceNumber && <span>Invoice: {request.invoiceNumber}</span>}
          {request.salesOrderNumber && <span>SO: {request.salesOrderNumber}</span>}
        </div>
      </div>

      <div className="support-ticket-card__aside">
        <div className="support-ticket-card__age">
          <strong className="support-ticket-card__age-value">{daysSinceSubmission}</strong>
          <span className="support-ticket-card__submitted">
            {formatSupportDateTimeCompact(request.createdAt)}
          </span>
        </div>
        <ChevronRight size={18} className="support-ticket-card__chevron" aria-hidden />
      </div>

      <p className="support-ticket-card__issue text-sm">{supportRequestIssueSummary(request)}</p>
    </button>
  );
};
