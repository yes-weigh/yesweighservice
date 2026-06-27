import React, { useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  FileText,
  LayoutGrid,
  MessageSquare,
  Package,
  Truck,
  Wrench,
} from 'lucide-react';
import { readCachedAllDealerInvoices, fetchAllDealerInvoices, formatInvoiceDate } from '../../lib/invoices';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { canDealerCancelSupportRequest } from '../../lib/supportStatus';
import { formatSupportDetailOpenedOn, supportDetailStatusBadge } from '../../lib/supportRequestDisplay';
import type { User } from '../../types';
import type { DealerSupportRequest } from '../../types/dealer-support';
import { SUPPORT_TYPE_LABELS } from '../../types/dealer-support';

export interface SupportRequestTicketInfoProps {
  request: DealerSupportRequest;
  user: User;
  className?: string;
  showCancel?: boolean;
  statusUpdating?: boolean;
  onCancel?: () => void;
}

function InfoRow({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  tone: 'purple' | 'blue' | 'green' | 'orange' | 'amber' | 'sky' | 'yellow' | 'violet';
  label: string;
  value: string;
}) {
  return (
    <div className="support-detail-info-row">
      <span className={`support-detail-info-row__icon support-detail-info-row__icon--${tone}`} aria-hidden>
        {icon}
      </span>
      <span className="support-detail-info-row__label">{label}</span>
      <span className="support-detail-info-row__value">{value}</span>
    </div>
  );
}

export const SupportRequestTicketInfo: React.FC<SupportRequestTicketInfoProps> = ({
  request,
  user,
  className = '',
  showCancel = true,
  statusUpdating = false,
  onCancel,
}) => {
  const [invoiceDate, setInvoiceDate] = useState<string | null>(null);
  const audience = isInternalOpsUser(user) ? 'staff' : 'dealer';
  const canDealerCancel = showCancel
    && !isInternalOpsUser(user)
    && canDealerCancelSupportRequest(request);

  useEffect(() => {
    if (!request.invoiceId) {
      setInvoiceDate(null);
      return undefined;
    }

    let cancelled = false;
    const invoiceId = request.invoiceId;

    const fromList = readCachedAllDealerInvoices(user.uid)?.find(inv => inv.id === invoiceId)?.date ?? null;
    if (fromList) setInvoiceDate(fromList);

    void fetchAllDealerInvoices(user.uid).then(invoices => {
      if (cancelled) return;
      const match = invoices.find(inv => inv.id === invoiceId);
      setInvoiceDate(match?.date ?? fromList);
    });

    return () => {
      cancelled = true;
    };
  }, [request.invoiceId, user.uid]);

  const statusBadge = supportDetailStatusBadge(request, audience);

  return (
    <section
      className={[
        'support-detail-card',
        'support-detail-card--ticket-info',
        'support-request-ticket-info',
        className,
      ].filter(Boolean).join(' ')}
    >
      <h3 className="support-detail-card__section-title">Ticket Information</h3>
      <div className="support-detail-card__divider" aria-hidden />

      <div className="support-detail-info-list">
        <InfoRow
          icon={<LayoutGrid size={16} strokeWidth={2} />}
          tone="purple"
          label="Category"
          value={SUPPORT_TYPE_LABELS[request.type]}
        />
        <InfoRow
          icon={<Calendar size={16} strokeWidth={2} />}
          tone="blue"
          label="Opened on"
          value={formatSupportDetailOpenedOn(request.createdAt)}
        />
        <InfoRow
          icon={<CheckCircle2 size={16} strokeWidth={2} />}
          tone="yellow"
          label="Status"
          value={statusBadge}
        />
        {request.product?.name && (
          <InfoRow
            icon={<Package size={16} strokeWidth={2} />}
            tone="violet"
            label="Product"
            value={request.product.name}
          />
        )}
        {request.invoiceNumber && (
          <InfoRow
            icon={<FileText size={16} strokeWidth={2} />}
            tone="sky"
            label="Invoice"
            value={request.invoiceNumber}
          />
        )}
        {invoiceDate && (
          <InfoRow
            icon={<Calendar size={16} strokeWidth={2} />}
            tone="blue"
            label="Invoice date"
            value={formatInvoiceDate(invoiceDate)}
          />
        )}
        {request.category && request.type !== 'chat' && (
          <InfoRow
            icon={<Wrench size={16} strokeWidth={2} />}
            tone="orange"
            label="Issue"
            value={request.category}
          />
        )}
        {request.subject && (
          <InfoRow
            icon={<MessageSquare size={16} strokeWidth={2} />}
            tone="purple"
            label="Subject"
            value={request.subject}
          />
        )}
        {request.courierTracking && (
          <InfoRow
            icon={<Truck size={16} strokeWidth={2} />}
            tone="green"
            label="Tracking"
            value={request.courierTracking}
          />
        )}
        {request.lifecycle === 'resolved' && request.resolutionSummary && (
          <InfoRow
            icon={<CheckCircle2 size={16} strokeWidth={2} />}
            tone="green"
            label="Resolution"
            value={request.resolutionSummary}
          />
        )}
      </div>

      {canDealerCancel && onCancel && (
        <div className="support-detail-card__footer">
          <button
            type="button"
            className="support-detail-card__cancel-btn"
            disabled={statusUpdating}
            onClick={onCancel}
          >
            Cancel request
          </button>
        </div>
      )}
    </section>
  );
};
