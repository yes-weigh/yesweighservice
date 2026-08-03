import React from 'react';
import { Package, UserRound } from 'lucide-react';
import { SupportChatLogo } from './SupportChatLogo';
import {
  complaintCategoryEmoji,
  SUPPORT_TYPE_LABELS,
  type DealerSupportRequest,
} from '../../types/dealer-support';
import {
  formatSupportInvoiceListDate,
  formatSupportSubmittedDate,
  formatSupportSubmittedTime,
  formatSupportBookedToClosedDaysLabel,
  supportRequestCardAsideBottom,
  supportRequestCardTitle,
  supportRequestIssueSummary,
  supportRequestStageSubtitle,
  supportRequestStatusLabel,
  supportRequestStatusTone,
} from '../../lib/supportRequestDisplay';
import { supportDisplayLabel } from '../../lib/supportStatus';

interface SupportRequestCardProps {
  request: DealerSupportRequest;
  imageUrl?: string | null;
  invoiceDate?: string | null;
  onClick: () => void;
  /** Ops queue: staff-facing status labels (default dealer). */
  statusAudience?: 'dealer' | 'staff';
  /** Ops queue: dealer name shown above the product title. */
  dealerName?: string | null;
  /** Ops queue: type label + assignee under the ref line. */
  showOpsMeta?: boolean;
}

export const SupportRequestCard: React.FC<SupportRequestCardProps> = ({
  request,
  imageUrl,
  invoiceDate,
  onClick,
  statusAudience = 'dealer',
  dealerName,
  showOpsMeta = false,
}) => {
  const statusTone = supportRequestStatusTone(request);
  const stageSubtitle = supportRequestStageSubtitle(request);
  const title = supportRequestCardTitle(request);
  const asideBottom = supportRequestCardAsideBottom(request);
  const statusLabel = statusAudience === 'staff'
    ? supportDisplayLabel(request, 'staff')
    : supportRequestStatusLabel(request);
  const issueSummary = supportRequestIssueSummary(request);
  const closedAt = request.lifecycle === 'resolved' || request.lifecycle === 'cancelled'
    ? (request.resolvedAt || request.updatedAt)
    : null;
  const bookedToClosedDays = closedAt
    ? formatSupportBookedToClosedDaysLabel(request.createdAt, closedAt)
    : null;
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
            imageUrl ? 'support-ticket-card__thumb--photo' : '',
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
        <span className={`support-ticket-card__status support-ticket-card__status--${statusTone}`}>
          {statusLabel}
        </span>
      </div>

      <div className="support-ticket-card__content">
        {dealerName && (
          <p className="support-ticket-card__dealer">{dealerName}</p>
        )}

        <div className="support-ticket-card__headline">
          <div className="support-ticket-card__headline-main">
            <p className="support-ticket-card__title">{title}</p>
            {stageSubtitle && (
              <p className="support-ticket-card__stage">{stageSubtitle}</p>
            )}
          </div>
        </div>

        {(request.invoiceNumber || issueSummary) && (
          <div className="support-ticket-card__details">
            {request.invoiceNumber && (
              <p className="support-ticket-card__invoice">
                <span className="support-ticket-card__invoice-number">
                  Inv {request.invoiceNumber}
                </span>
                {invoiceDate && (
                  <span className="support-ticket-card__invoice-date">
                    {formatSupportInvoiceListDate(invoiceDate)}
                  </span>
                )}
              </p>
            )}
            {issueSummary && issueSummary !== title && (
              <p className="support-ticket-card__issue">{issueSummary}</p>
            )}
          </div>
        )}

        <div className="support-ticket-card__footer">
          <span className="support-ticket-card__ref">Ref {request.requestNumber}</span>
          {showOpsMeta && (
            <>
              <span className="support-ticket-card__footer-dot" aria-hidden>·</span>
              <span className="support-ticket-card__type-label">
                {SUPPORT_TYPE_LABELS[request.type]}
              </span>
              {request.assignedToName && (
                <>
                  <span className="support-ticket-card__footer-dot" aria-hidden>·</span>
                  <span className="support-ticket-card__assignee">
                    <UserRound size={11} aria-hidden />
                    {request.assignedToName}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="support-ticket-card__aside">
        <div className="support-ticket-card__when support-ticket-card__when--booked">
          <span className="support-ticket-card__when-label">Booked</span>
          <strong className="support-ticket-card__when-date">
            {formatSupportSubmittedDate(request.createdAt)}
          </strong>
          <span className="support-ticket-card__when-time">
            {formatSupportSubmittedTime(request.createdAt)}
          </span>
        </div>

        {bookedToClosedDays && (
          <span className="support-ticket-card__duration">{bookedToClosedDays}</span>
        )}

        {asideBottom && (
          <div
            className={[
              'support-ticket-card__when',
              `support-ticket-card__when--${asideBottom.kind}`,
            ].join(' ')}
          >
            {asideBottom.kind === 'waiting' ? (
              <span className="support-ticket-card__when-ago">{asideBottom.waitingLabel}</span>
            ) : (
              <>
                <span className="support-ticket-card__when-label">
                  {asideBottom.kind === 'resolved' ? 'Resolved' : 'Cancelled'}
                </span>
                <strong className="support-ticket-card__when-date">{asideBottom.date}</strong>
                {asideBottom.time && (
                  <span className="support-ticket-card__when-time">{asideBottom.time}</span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </button>
  );
};
