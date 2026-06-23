import React from 'react';
import { Calendar, ChevronRight, Package } from 'lucide-react';
import type { DealerSupportRequest } from '../../types/dealer-support';
import {
  formatSupportDateTime,
  formatSupportDueCountdown,
  supportRequestDueDate,
  supportRequestIssueSummary,
  supportRequestStatusLabel,
  supportRequestStatusTone,
} from '../../lib/supportRequestDisplay';

interface SupportRequestCardProps {
  request: DealerSupportRequest;
  imageUrl?: string | null;
  onClick: () => void;
}

export const SupportRequestCard: React.FC<SupportRequestCardProps> = ({
  request,
  imageUrl,
  onClick,
}) => {
  const statusTone = supportRequestStatusTone(request);
  const dueDate = supportRequestDueDate(request);
  const due = dueDate ? formatSupportDueCountdown(dueDate) : null;

  return (
    <button type="button" className="support-ticket-card panel glass" onClick={onClick}>
      <div className="support-ticket-card__thumb">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="support-ticket-card__image" loading="lazy" decoding="async" />
        ) : (
          <span className="support-ticket-card__placeholder" aria-hidden>
            <Package size={22} />
          </span>
        )}
      </div>

      <div className="support-ticket-card__body">
        <div className="support-ticket-card__head">
          <strong className="support-ticket-card__id">{request.requestNumber}</strong>
          <span className={`support-ticket-card__status support-ticket-card__status--${statusTone}`}>
            {supportRequestStatusLabel(request)}
          </span>
        </div>

        {request.product?.name && (
          <p className="support-ticket-card__product">{request.product.name}</p>
        )}
        {request.subject && !request.product?.name && (
          <p className="support-ticket-card__product">{request.subject}</p>
        )}

        <div className="support-ticket-card__meta text-muted text-sm">
          {request.invoiceNumber && <span>Invoice {request.invoiceNumber}</span>}
          {request.salesOrderNumber && <span>SO {request.salesOrderNumber}</span>}
        </div>

        <p className="support-ticket-card__datetime text-sm">
          <Calendar size={13} aria-hidden />
          {formatSupportDateTime(request.createdAt)}
        </p>

        <p className="support-ticket-card__issue text-sm">{supportRequestIssueSummary(request)}</p>
      </div>

      <div className="support-ticket-card__aside">
        {due && dueDate && (
          <>
            <div className={`support-ticket-card__due support-ticket-card__due--${due.tone}`}>
              <span className="support-ticket-card__due-prefix">{due.prefix}</span>
              <strong className="support-ticket-card__due-value">{due.value}</strong>
            </div>
            <p className="support-ticket-card__due-date text-muted text-sm">
              <Calendar size={12} aria-hidden />
              {dueDate.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          </>
        )}
        <ChevronRight size={18} className="support-ticket-card__chevron" aria-hidden />
      </div>
    </button>
  );
};
