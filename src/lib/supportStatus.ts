import type {
  DealerSupportRequest,
  SupportLifecycle,
  SupportOpenStage,
  SupportRequestType,
} from '../types/dealer-support';
import { SUPPORT_LIFECYCLE_LABELS, SUPPORT_OPEN_STAGE_LABELS } from '../types/dealer-support';

export const SUPPORT_OPEN_STAGES: SupportOpenStage[] = [
  'submitted',
  'under_review',
  'awaiting_dealer',
  'awaiting_product',
  'in_transit',
  'in_workshop',
];

export const COURIER_OPEN_STAGES: SupportOpenStage[] = [
  'awaiting_product',
  'in_transit',
  'in_workshop',
];

export function isProductCourierType(type: SupportRequestType): boolean {
  return type === 'service' || type === 'return';
}

export function isSupportDraft(request: Pick<DealerSupportRequest, 'lifecycle'>): boolean {
  return request.lifecycle === 'draft';
}

export function isSupportOpen(request: Pick<DealerSupportRequest, 'lifecycle'>): boolean {
  return request.lifecycle === 'open';
}

export function isSupportClosed(
  request: Pick<DealerSupportRequest, 'lifecycle'>,
): boolean {
  return request.lifecycle === 'resolved' || request.lifecycle === 'cancelled';
}

export function legacyStatusToLifecycle(
  status: string,
  assignedToUid?: string | null,
): { lifecycle: SupportLifecycle; openStage: SupportOpenStage | null } {
  switch (status) {
    case 'draft':
      return { lifecycle: 'draft', openStage: null };
    case 'pending':
      return {
        lifecycle: 'open',
        openStage: assignedToUid ? 'under_review' : 'submitted',
      };
    case 'awaiting_product':
      return { lifecycle: 'open', openStage: 'awaiting_product' };
    case 'in_progress':
      return { lifecycle: 'open', openStage: 'in_workshop' };
    case 'completed':
      return { lifecycle: 'resolved', openStage: null };
    case 'cancelled':
      return { lifecycle: 'cancelled', openStage: null };
    default:
      return { lifecycle: 'open', openStage: 'submitted' };
  }
}

export function dealerOpenStageLabel(stage: SupportOpenStage): string {
  const labels: Record<SupportOpenStage, string> = {
    submitted: 'Submitted — we will review shortly',
    under_review: 'Under review',
    awaiting_dealer: 'Awaiting your reply',
    awaiting_product: 'Ship product to YesOne',
    in_transit: 'On the way to YesOne',
    in_workshop: 'Being repaired / inspected',
  };
  return labels[stage];
}

export function staffOpenStageLabel(stage: SupportOpenStage): string {
  return SUPPORT_OPEN_STAGE_LABELS[stage];
}

export function supportDisplayLabel(
  request: Pick<DealerSupportRequest, 'lifecycle' | 'openStage'>,
  audience: 'staff' | 'dealer' = 'dealer',
): string {
  if (request.lifecycle === 'draft') return SUPPORT_LIFECYCLE_LABELS.draft;
  if (request.lifecycle === 'resolved') return SUPPORT_LIFECYCLE_LABELS.resolved;
  if (request.lifecycle === 'cancelled') return SUPPORT_LIFECYCLE_LABELS.cancelled;
  if (request.openStage) {
    return audience === 'staff'
      ? staffOpenStageLabel(request.openStage)
      : dealerOpenStageLabel(request.openStage);
  }
  return SUPPORT_LIFECYCLE_LABELS.open;
}

export function supportBadgeLabel(
  request: Pick<DealerSupportRequest, 'lifecycle' | 'openStage'>,
): string {
  if (request.lifecycle === 'open') return 'OPEN';
  return SUPPORT_LIFECYCLE_LABELS[request.lifecycle].toUpperCase();
}

export function validateOpenStageTransition(
  request: Pick<DealerSupportRequest, 'type' | 'lifecycle' | 'openStage'>,
  nextStage: SupportOpenStage,
): string | null {
  if (request.lifecycle !== 'open') {
    return 'Only open requests can change stage.';
  }
  if (request.openStage === nextStage) return null;

  const { type, openStage } = request;
  if (!openStage) return 'Invalid current stage.';

  const courierOnly: SupportOpenStage[] = ['awaiting_product', 'in_transit', 'in_workshop'];
  if (!isProductCourierType(type) && courierOnly.includes(nextStage)) {
    return 'Complaints do not use the product courier flow.';
  }

  switch (nextStage) {
    case 'submitted':
      return 'Cannot move back to submitted.';
    case 'under_review':
      if (openStage === 'awaiting_dealer' || openStage === 'submitted') return null;
      if (openStage === 'in_workshop') return null;
      return 'Cannot move to under review from this stage.';
    case 'awaiting_dealer':
      if (
        openStage === 'submitted'
        || openStage === 'under_review'
        || openStage === 'in_workshop'
      ) {
        return null;
      }
      return 'Cannot request dealer reply from this stage.';
    case 'awaiting_product':
      if (!isProductCourierType(type)) {
        return 'Only repair and replacement requests can await product shipment.';
      }
      if (openStage === 'under_review' || openStage === 'submitted') return null;
      return 'Approve for courier from review first.';
    case 'in_transit':
      if (!isProductCourierType(type)) return 'Complaints do not use courier transit.';
      if (openStage === 'awaiting_product') return null;
      return 'Dealer must ship the product first.';
    case 'in_workshop':
      if (!isProductCourierType(type)) {
        if (openStage === 'under_review' || openStage === 'awaiting_dealer') return null;
        return 'Cannot start workshop work from this stage.';
      }
      if (openStage === 'in_transit' || openStage === 'under_review') return null;
      return 'Mark product received before workshop work.';
    default:
      return 'Invalid stage.';
  }
}

export function validateLifecycleTransition(
  request: Pick<DealerSupportRequest, 'type' | 'lifecycle' | 'openStage'>,
  nextLifecycle: SupportLifecycle,
): string | null {
  if (request.lifecycle === nextLifecycle) return null;
  if (request.lifecycle === 'resolved' || request.lifecycle === 'cancelled') {
    return 'This request is already closed.';
  }
  if (request.lifecycle === 'draft') {
    return 'Drafts must be submitted through the wizard.';
  }

  if (nextLifecycle === 'cancelled') return null;

  if (nextLifecycle === 'resolved') {
    if (request.lifecycle !== 'open' || !request.openStage) {
      return 'Cannot resolve from this state.';
    }
    if (isProductCourierType(request.type)) {
      const allowed: SupportOpenStage[] = ['under_review', 'in_workshop', 'awaiting_dealer'];
      if (request.openStage === 'submitted') {
        return 'Review the request before resolving.';
      }
      if (!allowed.includes(request.openStage)) {
        return 'Complete courier and workshop steps before resolving.';
      }
    } else if (
      request.openStage !== 'under_review'
      && request.openStage !== 'awaiting_dealer'
      && request.openStage !== 'submitted'
    ) {
      return 'Cannot resolve from this stage.';
    }
    return null;
  }

  return 'Invalid lifecycle change.';
}

export function staffStagesForRequest(
  request: Pick<DealerSupportRequest, 'type' | 'lifecycle' | 'openStage'>,
): SupportOpenStage[] {
  if (request.lifecycle !== 'open' || !request.openStage) return [];
  return SUPPORT_OPEN_STAGES.filter(stage => {
    if (stage === request.openStage) return true;
    return validateOpenStageTransition(request, stage) === null;
  });
}

export function supportStatusClass(
  request: Pick<DealerSupportRequest, 'lifecycle' | 'openStage'>,
): string {
  if (request.lifecycle === 'resolved') return 'service-request-status--done';
  if (request.lifecycle === 'cancelled') return 'service-request-status--cancelled';
  if (request.lifecycle === 'draft') return 'service-request-status--draft';
  switch (request.openStage) {
    case 'in_workshop':
      return 'service-request-status--active';
    case 'awaiting_product':
    case 'in_transit':
      return 'service-request-status--awaiting';
    case 'awaiting_dealer':
      return 'service-request-status--awaiting-dealer';
    case 'under_review':
      return 'service-request-status--active';
    default:
      return 'service-request-status--pending';
  }
}

export function slaPausedForStage(stage: SupportOpenStage | null): boolean {
  return stage === 'awaiting_dealer'
    || stage === 'awaiting_product'
    || stage === 'in_transit';
}

const DEALER_CANCELLABLE_STAGES: SupportOpenStage[] = [
  'submitted',
  'under_review',
  'awaiting_dealer',
];

export function canDealerCancelSupportRequest(
  request: Pick<DealerSupportRequest, 'lifecycle' | 'openStage'>,
): boolean {
  return request.lifecycle === 'open'
    && request.openStage != null
    && DEALER_CANCELLABLE_STAGES.includes(request.openStage);
}

export type StaffQueueTab =
  | 'all'
  | 'new'
  | 'in_review'
  | 'waiting_on_dealer'
  | 'resolved'
  | 'cancelled';

export function staffQueueTabForRequest(
  request: DealerSupportRequest,
): StaffQueueTab | null {
  if (request.lifecycle === 'draft') return null;
  if (request.lifecycle === 'resolved') return 'resolved';
  if (request.lifecycle === 'cancelled') return 'cancelled';
  switch (request.openStage) {
    case 'submitted':
      return 'new';
    case 'under_review':
    case 'in_workshop':
      return 'in_review';
    case 'awaiting_dealer':
    case 'awaiting_product':
    case 'in_transit':
      return 'waiting_on_dealer';
    default:
      return 'new';
  }
}

export const STAFF_QUEUE_TABS: Array<{ value: StaffQueueTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'in_review', label: 'In review' },
  { value: 'waiting_on_dealer', label: 'Waiting on dealer' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function filterStaffQueueRequests(
  requests: DealerSupportRequest[],
  tab: StaffQueueTab,
): DealerSupportRequest[] {
  if (tab === 'all') return requests;
  return requests.filter(request => staffQueueTabForRequest(request) === tab);
}

export function countStaffQueueByTab(
  requests: DealerSupportRequest[],
): Record<StaffQueueTab, number> {
  const counts: Record<StaffQueueTab, number> = {
    all: requests.length,
    new: 0,
    in_review: 0,
    waiting_on_dealer: 0,
    resolved: 0,
    cancelled: 0,
  };
  for (const request of requests) {
    const tab = staffQueueTabForRequest(request);
    if (tab) counts[tab] += 1;
  }
  return counts;
}
