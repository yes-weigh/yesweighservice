import type { DealerSupportRequest, SupportRequestStatus, SupportRequestType } from '../types/dealer-support';

export const SUPPORT_PIPELINE_STATUSES: SupportRequestStatus[] = [
  'draft',
  'pending',
  'awaiting_product',
  'in_progress',
  'completed',
  'cancelled',
];

export const SUPPORT_STAFF_STATUS_LABELS: Record<SupportRequestStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  awaiting_product: 'Awaiting product',
  in_progress: 'In progress',
  completed: 'Resolved',
  cancelled: 'Closed',
};

export const SUPPORT_DEALER_STATUS_LABELS: Record<SupportRequestStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  awaiting_product: 'Awaiting product',
  in_progress: 'In progress',
  completed: 'Resolved',
  cancelled: 'Closed',
};

export function supportStatusLabel(
  status: SupportRequestStatus,
  audience: 'staff' | 'dealer' = 'dealer',
): string {
  return audience === 'staff'
    ? SUPPORT_STAFF_STATUS_LABELS[status]
    : SUPPORT_DEALER_STATUS_LABELS[status];
}

export function isProductCourierType(type: SupportRequestType): boolean {
  return type === 'service' || type === 'return';
}

export function validateSupportStatusTransition(
  request: Pick<DealerSupportRequest, 'type' | 'status'>,
  nextStatus: SupportRequestStatus,
): string | null {
  if (request.status === nextStatus) return null;

  if (request.status === 'completed' || request.status === 'cancelled') {
    return 'This request is already closed.';
  }

  const { type, status } = request;

  switch (nextStatus) {
    case 'draft':
      return 'Cannot move an active request back to draft.';
    case 'pending':
      return status === 'draft' ? null : 'Cannot reopen to pending.';
    case 'awaiting_product':
      if (!isProductCourierType(type)) {
        return 'Only repair and replacement requests can await product shipment.';
      }
      if (status !== 'pending') {
        return 'Approve for courier from pending review first.';
      }
      return null;
    case 'in_progress':
      if (status === 'awaiting_product') return null;
      if (status === 'in_progress') return null;
      if (status === 'pending' && !isProductCourierType(type)) return null;
      if (status === 'pending' && isProductCourierType(type)) {
        return 'Approve for courier first, or mark awaiting product.';
      }
      return 'Cannot start work from this status.';
    case 'completed':
      if (status === 'in_progress') return null;
      if (status === 'pending' && !isProductCourierType(type)) return null;
      if (status === 'awaiting_product') {
        return 'Mark in progress after the product is received.';
      }
      if (status === 'pending' && isProductCourierType(type)) {
        return 'Approve and receive the product before resolving.';
      }
      return 'Cannot resolve from this status.';
    case 'cancelled':
      return null;
    default:
      return 'Invalid status.';
  }
}

export function staffStatusesForRequest(
  request: Pick<DealerSupportRequest, 'type' | 'status'>,
): SupportRequestStatus[] {
  return SUPPORT_PIPELINE_STATUSES.filter(status => {
    if (status === 'draft' && request.status !== 'draft') return false;
    if (status === request.status) return true;
    return validateSupportStatusTransition(request, status) === null;
  });
}

export function supportStatusClass(status: SupportRequestStatus): string {
  if (status === 'completed') return 'service-request-status--done';
  if (status === 'in_progress') return 'service-request-status--active';
  if (status === 'awaiting_product') return 'service-request-status--awaiting';
  if (status === 'cancelled') return 'service-request-status--cancelled';
  if (status === 'draft') return 'service-request-status--draft';
  return 'service-request-status--pending';
}
