import React from 'react';
import { AlertCircle, PackageCheck, Truck } from 'lucide-react';
import { FIRM_NAME } from '../../constants/brand';
import { formatInvoiceDate } from '../../lib/invoices';
import { canManageSupportOps, isInternalOpsUser } from '../../lib/staffAccess';
import {
  isSupportOpen,
  supportDisplayLabel,
  supportStatusClass,
} from '../../lib/supportStatus';
import { supportRequestStageSubtitle } from '../../lib/supportRequestDisplay';
import type { User } from '../../types';
import type { DealerSupportRequest, SupportOpenStage } from '../../types/dealer-support';
import {
  SUPPORT_OPEN_STAGE_LABELS,
  SUPPORT_TYPE_LABELS,
} from '../../types/dealer-support';
import { SupportAssigneeSelect } from './SupportAssigneeSelect';

export interface SupportRequestDetailPanelProps {
  request: DealerSupportRequest;
  user: User | null;
  open: boolean;
  onClose: () => void;
  error?: string;
  statusUpdating: boolean;
  tracking: string;
  onTrackingChange: (value: string) => void;
  resolutionNote: string;
  onResolutionNoteChange: (value: string) => void;
  staffStageOptions: SupportOpenStage[];
  canApproveCourier: boolean;
  canMarkReceived: boolean;
  canDealerShip: boolean;
  canDealerCancel: boolean;
  onStageChange: (stage: SupportOpenStage) => void;
  onApproveCourier: () => void;
  onMarkReceived: () => void;
  onResolve: () => void;
  onCancel: () => void;
  onDealerCancel: () => void;
  onMarkShipped: () => void;
  onAdminDelete: () => void;
}

export const SupportRequestDetailPanel: React.FC<SupportRequestDetailPanelProps> = ({
  request,
  user,
  open,
  onClose,
  error,
  statusUpdating,
  tracking,
  onTrackingChange,
  resolutionNote,
  onResolutionNoteChange,
  staffStageOptions,
  canApproveCourier,
  canMarkReceived,
  canDealerShip,
  canDealerCancel,
  onStageChange,
  onApproveCourier,
  onMarkReceived,
  onResolve,
  onCancel,
  onDealerCancel,
  onMarkShipped,
  onAdminDelete,
}) => {
  if (!open) return null;

  const stageSubtitle = supportRequestStageSubtitle(request);
  const isStaff = canManageSupportOps(user);

  return (
    <>
      <button
        type="button"
        className="support-detail-panel__backdrop"
        aria-label="Close request details"
        onClick={onClose}
      />
      <div
        className="support-detail-panel"
        role="region"
        aria-label="Request details"
      >
        {error && (
          <div className="products-inline-error panel glass support-detail-page__error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <section className="support-detail-summary panel glass">
          <div className="support-detail-summary__head">
            <div>
              <p className="text-muted text-sm support-detail-summary__type-line">
                {SUPPORT_TYPE_LABELS[request.type]}
                {request.dealerName && isInternalOpsUser(user) && (
                  <span> · {request.dealerName}</span>
                )}
                · Opened {formatInvoiceDate(request.createdAt)}
              </p>
              {stageSubtitle && (
                <p className="support-detail-summary__stage text-sm">{stageSubtitle}</p>
              )}
            </div>
            {isStaff && isSupportOpen(request) ? (
              <div className="support-detail-summary__controls">
                {canApproveCourier && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={statusUpdating}
                    onClick={onApproveCourier}
                  >
                    Approve for courier
                  </button>
                )}
                {canMarkReceived && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={statusUpdating}
                    onClick={onMarkReceived}
                  >
                    <PackageCheck size={15} />
                    Product received
                  </button>
                )}
                <select
                  className="catalog-select support-detail-summary__status"
                  value={request.openStage ?? ''}
                  disabled={statusUpdating}
                  onChange={e => onStageChange(e.target.value as SupportOpenStage)}
                >
                  {staffStageOptions.map(stage => (
                    <option key={stage} value={stage}>
                      {SUPPORT_OPEN_STAGE_LABELS[stage]}
                    </option>
                  ))}
                </select>
                <SupportAssigneeSelect user={user!} request={request} />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={statusUpdating}
                  onClick={onResolve}
                >
                  Resolve
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={statusUpdating}
                  onClick={onCancel}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="support-detail-summary__dealer-actions">
                <span className={`service-request-status ${supportStatusClass(request)} support-detail-summary__badge`}>
                  {supportDisplayLabel(request, isInternalOpsUser(user) ? 'staff' : 'dealer')}
                </span>
                {canDealerCancel && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={statusUpdating}
                    onClick={onDealerCancel}
                  >
                    Cancel request
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="support-detail-summary__meta text-sm">
            {request.product && <span>{request.product.name}</span>}
            {request.invoiceNumber && <span>Invoice {request.invoiceNumber}</span>}
            {request.salesOrderNumber && <span>SO {request.salesOrderNumber}</span>}
            <span>{request.category}</span>
            {request.courierTracking && <span>Tracking {request.courierTracking}</span>}
          </div>
          {request.subject && <p className="support-detail-summary__subject">{request.subject}</p>}

          {request.lifecycle === 'resolved' && request.resolutionSummary && (
            <p className="support-detail-summary__resolution text-sm">
              <strong>Resolution:</strong> {request.resolutionSummary}
            </p>
          )}

          {isStaff && isSupportOpen(request) && (
            <label className="support-detail-summary__resolve-note text-sm">
              <span className="text-muted">Resolution note (optional)</span>
              <input
                type="text"
                className="catalog-input"
                value={resolutionNote}
                onChange={e => onResolutionNoteChange(e.target.value)}
                placeholder="Brief summary for internal records"
              />
            </label>
          )}

          {user?.role === 'super_admin' && (
            <div className="support-detail-summary__admin-actions">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={statusUpdating}
                onClick={onAdminDelete}
              >
                Delete ticket
              </button>
            </div>
          )}
        </section>

        {canDealerShip && (
          <section className="support-detail-ship panel glass">
            <h3>
              <Truck size={18} aria-hidden />
              Mark product as shipped
            </h3>
            <p className="text-muted text-sm">
              After you courier the product to {FIRM_NAME}, confirm shipment below. Add a tracking number if you have one.
            </p>
            <div className="support-detail-ship__form">
              <input
                type="text"
                className="catalog-input"
                value={tracking}
                onChange={e => onTrackingChange(e.target.value)}
                placeholder="Courier tracking number (optional)"
                disabled={statusUpdating}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={statusUpdating}
                onClick={onMarkShipped}
              >
                I&apos;ve shipped the product
              </button>
            </div>
          </section>
        )}
      </div>
    </>
  );
};
