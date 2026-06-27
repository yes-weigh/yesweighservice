import React from 'react';
import { ChevronRight, Package } from 'lucide-react';
import { SupportChatLogo } from './SupportChatLogo';
import { complaintCategoryEmoji, type DealerSupportRequest } from '../../types/dealer-support';
import {
  formatSupportDaysAgo,
  formatSupportInvoiceListDate,
  formatSupportSubmittedDate,
  formatSupportSubmittedTime,
  supportRequestCardTitle,
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
  const stageSubtitle = supportRequestStageSubtitle(request);
  const title = supportRequestCardTitle(request);
  const daysAgo = formatSupportDaysAgo(request.createdAt);
  const categoryEmoji = request.type === 'complaint'
    ? complaintCategoryEmoji(request.category) ?? complaintCategoryEmoji(request.subject)
    : null;

  return (
    <button type="button" className="support-ticket-card panel glass" onClick={onClick}>
      <div className="support-ticket-card__media">
        <div
          className={[
            'support-ticket-card__thumb',
            request.type === 'chat' ? 'support-ticket-card__thumb--chat' : '',
            categoryEmoji ? 'support-ticket-card__thumb--complaint' : '',
          ].filter(Boolean).join(' ')}
        >
          {request.type === 'chat' ? (
            <SupportChatLogo size={38} />
          ) : imageUrl ? (
            <img src={imageUrl} alt="" className="support-ticket-card__image" loading="lazy" decoding="async" />
          ) : categoryEmoji ? (
            <span className="support-ticket-card__category-emoji" aria-hidden>
              {categoryEmoji}
            </span>
          ) : (
            <span className="support-ticket-card__placeholder" aria-hidden>
              <Package size={22} />
            </span>
          )}
        </div>
      </div>

      <div className="support-ticket-card__content">
        <div className="support-ticket-card__headline">
          <p className="support-ticket-card__title">{title}</p>
          <div className="support-ticket-card__status-stack">
            <span className={`support-ticket-card__status support-ticket-card__status--${statusTone}`}>
              {supportRequestStatusLabel(request)}
            </span>
            {stageSubtitle && (
              <span className="support-ticket-card__stage">{stageSubtitle}</span>
            )}
          </div>
        </div>

        {request.invoiceNumber && (
          <p className="support-ticket-card__invoice text-sm">
            Inv {request.invoiceNumber}
            {invoiceDate && <> · {formatSupportInvoiceListDate(invoiceDate)}</>}
          </p>
        )}

        <p className="support-ticket-card__issue text-sm">{supportRequestIssueSummary(request)}</p>

        <span className="support-ticket-card__ref">Ref {request.requestNumber}</span>
      </div>

      <div className="support-ticket-card__aside">
        <div className="support-ticket-card__when">
          <strong className="support-ticket-card__when-date">
            {formatSupportSubmittedDate(request.createdAt)}
          </strong>
          <span className="support-ticket-card__when-time">
            {formatSupportSubmittedTime(request.createdAt)}
          </span>
          {daysAgo && (
            <span className="support-ticket-card__when-ago">{daysAgo}</span>
          )}
        </div>
        <ChevronRight size={18} className="support-ticket-card__chevron" aria-hidden />
      </div>
    </button>
  );
};
