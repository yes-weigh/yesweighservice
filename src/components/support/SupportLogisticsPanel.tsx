import React, { useMemo } from 'react';
import { Clock, Package, Truck } from 'lucide-react';
import { FIRM_NAME } from '../../constants/brand';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { formatSupportDateTimeCompact } from '../../lib/supportRequestDisplay';
import { isProductCourierType, isSupportOpen } from '../../lib/supportStatus';
import type { User } from '../../types';
import type { DealerSupportRequest } from '../../types/dealer-support';
import { DEALER_COURIER_NOTICE } from '../../types/dealer-support';
import { SupportCourierInstructions } from './SupportCourierInstructions';

interface SupportLogisticsPanelProps {
  request: DealerSupportRequest;
  user: User | null;
  tracking: string;
  onTrackingChange: (value: string) => void;
  canDealerShip: boolean;
  statusUpdating: boolean;
  onMarkShipped: () => void;
}

function logisticsStatusLabel(request: DealerSupportRequest): string {
  if (!isProductCourierType(request.type)) return 'Not applicable';

  if (request.lifecycle === 'resolved') {
    return request.shippedAt ? 'Delivered to workshop' : 'No shipment';
  }
  if (request.lifecycle === 'cancelled') {
    return request.shippedAt ? 'Shipment recorded' : 'Not shipped';
  }

  switch (request.openStage) {
    case 'submitted':
    case 'under_review':
      return 'Awaiting approval';
    case 'awaiting_product':
      return 'Ready to ship';
    case 'in_transit':
      return 'In transit';
    case 'in_workshop':
      return 'Received at workshop';
    default:
      return 'Pending';
  }
}

function logisticsStatusDescription(request: DealerSupportRequest): string {
  if (!isProductCourierType(request.type)) {
    return 'This request type does not involve shipping a product to the workshop.';
  }

  if (request.lifecycle === 'resolved') {
    return request.shippedAt
      ? 'The product reached our workshop and this case is now closed.'
      : 'This case was resolved without a product shipment.';
  }
  if (request.lifecycle === 'cancelled') {
    return request.shippedAt
      ? 'Shipment was recorded before this request was cancelled.'
      : 'No product was shipped for this request.';
  }

  switch (request.openStage) {
    case 'submitted':
    case 'under_review':
      return `${FIRM_NAME} is reviewing your request. Courier instructions appear here after approval.`;
    case 'awaiting_product':
      return `Your request is approved. Courier the product to ${FIRM_NAME} using the address below.`;
    case 'in_transit':
      return `Your shipment is on the way to ${FIRM_NAME}. We will confirm when it arrives.`;
    case 'in_workshop':
      return 'Your product has arrived and is being repaired or inspected.';
    default:
      return DEALER_COURIER_NOTICE;
  }
}

function shouldShowCourierInstructions(
  request: DealerSupportRequest,
  user: User | null,
): boolean {
  if (!isProductCourierType(request.type)) return false;
  if (isInternalOpsUser(user)) return true;
  if (request.shippedAt) return true;
  if (!isSupportOpen(request)) return Boolean(request.shippedAt);

  return (
    request.openStage === 'awaiting_product'
    || request.openStage === 'in_transit'
    || request.openStage === 'in_workshop'
  );
}

export const SupportLogisticsPanel: React.FC<SupportLogisticsPanelProps> = ({
  request,
  user,
  tracking,
  onTrackingChange,
  canDealerShip,
  statusUpdating,
  onMarkShipped,
}) => {
  const statusLabel = useMemo(() => logisticsStatusLabel(request), [request]);
  const statusDescription = useMemo(() => logisticsStatusDescription(request), [request]);
  const showInstructions = shouldShowCourierInstructions(request, user);
  const isCourierType = isProductCourierType(request.type);

  return (
    <section className="support-logistics" aria-label="Logistics">
      <header className="support-logistics__head">
        <div className="support-logistics__title">
          <Truck size={18} aria-hidden />
          <h3>Logistics</h3>
        </div>
        <div className="support-logistics__current">
          <span className="support-logistics__current-label text-sm text-muted">Shipment status</span>
          <span className="support-logistics__current-badge">{statusLabel}</span>
        </div>
      </header>

      <div className="support-logistics__status panel glass">
        <p className="support-logistics__status-desc text-sm text-muted">{statusDescription}</p>

        {isCourierType && (request.courierTracking || request.shippedAt || request.receivedAt) && (
          <dl className="support-logistics__meta">
            {request.courierTracking && (
              <div className="support-logistics__meta-row">
                <dt>Tracking</dt>
                <dd>{request.courierTracking}</dd>
              </div>
            )}
            {request.shippedAt && (
              <div className="support-logistics__meta-row">
                <dt>Shipped</dt>
                <dd>{formatSupportDateTimeCompact(request.shippedAt)}</dd>
              </div>
            )}
            {request.receivedAt && (
              <div className="support-logistics__meta-row">
                <dt>Received</dt>
                <dd>{formatSupportDateTimeCompact(request.receivedAt)}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {isCourierType && !showInstructions && isSupportOpen(request) && (
        <div className="support-logistics__pending panel glass">
          <div className="support-logistics__pending-head">
            <Clock size={18} aria-hidden />
            <strong>Shipping not open yet</strong>
          </div>
          <p className="text-sm text-muted">{DEALER_COURIER_NOTICE}</p>
        </div>
      )}

      {showInstructions && (
        <SupportCourierInstructions requestNumber={request.requestNumber} />
      )}

      {canDealerShip && (
        <section className="support-logistics__ship panel glass">
          <div className="support-logistics__ship-head">
            <Package size={18} aria-hidden />
            <h4>Confirm shipment</h4>
          </div>
          <p className="support-logistics__ship-hint text-sm text-muted">
            After you courier the product to {FIRM_NAME}, confirm below. Add a tracking number if you have one.
          </p>
          <div className="support-logistics__ship-form">
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
              className="btn btn-primary"
              disabled={statusUpdating}
              onClick={onMarkShipped}
            >
              I&apos;ve shipped the product
            </button>
          </div>
        </section>
      )}

      {!isCourierType && (
        <div className="support-logistics__na panel glass">
          <p className="text-sm text-muted">
            Repair and replacement requests use this tab for courier address, packing steps, and tracking.
            Chat and complaint tickets do not require product shipment.
          </p>
        </div>
      )}
    </section>
  );
};
