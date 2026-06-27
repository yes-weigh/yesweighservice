import { FIRM_NAME_SHORT } from '../constants/brand';
import type { DealerSupportRequest, SupportOpenStage, SupportRequestType } from '../types/dealer-support';
import { isProductCourierType } from './supportStatus';
import { formatSupportDateTimeCompact } from './supportRequestDisplay';

export type TicketFlowStepStatus = 'complete' | 'current' | 'upcoming' | 'skipped';

export type FlowStepTone =
  | 'green'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'teal'
  | 'amber'
  | 'rose'
  | 'muted';

export interface TicketFlowStep {
  id: string;
  stepNumber: number;
  title: string;
  description: string;
  status: TicketFlowStepStatus;
  statusLabel: string;
  timestamp: string | null;
  tone: FlowStepTone;
}

function applicableStages(type: SupportRequestType): SupportOpenStage[] {
  if (isProductCourierType(type)) {
    return ['submitted', 'under_review', 'awaiting_product', 'in_transit', 'in_workshop'];
  }
  return ['submitted', 'under_review', 'awaiting_dealer'];
}

function stepTone(id: string): FlowStepTone {
  switch (id) {
    case 'submitted':
      return 'green';
    case 'under_review':
      return 'blue';
    case 'awaiting_product':
      return 'purple';
    case 'in_transit':
      return 'orange';
    case 'in_workshop':
      return 'teal';
    case 'awaiting_dealer':
      return 'amber';
    case 'resolved':
      return 'green';
    case 'cancelled':
      return 'muted';
    default:
      return 'muted';
  }
}

function stepStatusLabel(status: TicketFlowStepStatus): string {
  switch (status) {
    case 'complete':
      return 'Completed';
    case 'current':
      return 'In progress';
    case 'upcoming':
      return 'Pending';
    case 'skipped':
      return 'Skipped';
  }
}

function stepTitle(
  stage: SupportOpenStage | 'resolved' | 'cancelled',
  audience: 'dealer' | 'staff',
): string {
  if (stage === 'resolved') return audience === 'staff' ? 'Resolved' : 'Issue resolved';
  if (stage === 'cancelled') return 'Cancelled';

  if (audience === 'staff') {
    const staffTitles: Record<SupportOpenStage, string> = {
      submitted: 'Submitted',
      under_review: 'Under review',
      awaiting_dealer: 'Awaiting dealer reply',
      awaiting_product: 'Approved for courier',
      in_transit: 'In transit',
      in_workshop: 'In workshop',
    };
    return staffTitles[stage];
  }

  const dealerTitles: Record<SupportOpenStage, string> = {
    submitted: 'Submitted',
    under_review: 'Under review',
    awaiting_dealer: 'Awaiting your reply',
    awaiting_product: 'Approved for courier',
    in_transit: `Shipped to ${FIRM_NAME_SHORT}`,
    in_workshop: 'In workshop',
  };
  return dealerTitles[stage];
}

function stageDescription(
  stage: SupportOpenStage,
  type: SupportRequestType,
  audience: 'dealer' | 'staff',
): string {
  if (audience === 'staff') {
    const staffDescriptions: Record<SupportOpenStage, string> = {
      submitted: 'New request waiting in the queue.',
      under_review: 'Team is reviewing details and evidence.',
      awaiting_dealer: 'Waiting for the dealer to reply in chat.',
      awaiting_product: 'Approved for courier — waiting for dealer shipment.',
      in_transit: 'Product is on the way to the workshop.',
      in_workshop: 'Product received and under repair or inspection.',
    };
    return staffDescriptions[stage];
  }

  const dealerDescriptions: Record<SupportOpenStage, string> = {
    submitted: 'Your request was received successfully.',
    under_review: `${FIRM_NAME_SHORT} is reviewing your request.`,
    awaiting_dealer: 'Please reply in chat with any information we asked for.',
    awaiting_product: `Courier your product to ${FIRM_NAME_SHORT} when ready.`,
    in_transit: `Shipment is on the way to ${FIRM_NAME_SHORT}.`,
    in_workshop: 'Your product is being repaired or inspected.',
  };

  if (stage === 'awaiting_dealer' && isProductCourierType(type)) {
    return dealerDescriptions.awaiting_dealer;
  }

  return dealerDescriptions[stage];
}

function inferProgressIndex(
  request: DealerSupportRequest,
  stages: SupportOpenStage[],
): number {
  if (request.openStage) {
    return stages.indexOf(request.openStage);
  }

  if (request.lifecycle === 'resolved') {
    return stages.length - 1;
  }

  if (request.lifecycle === 'cancelled') {
    if (request.receivedAt && stages.includes('in_workshop')) {
      return stages.indexOf('in_workshop');
    }
    if (request.shippedAt && stages.includes('in_transit')) {
      return stages.indexOf('in_transit');
    }
    if (request.assignedAt && stages.includes('under_review')) {
      return stages.indexOf('under_review');
    }
    return 0;
  }

  return -1;
}

function computeStepStatus(
  index: number,
  progressIndex: number,
  lifecycle: DealerSupportRequest['lifecycle'],
): TicketFlowStepStatus {
  if (lifecycle === 'resolved') {
    return 'complete';
  }

  if (lifecycle === 'cancelled') {
    if (index <= progressIndex) return 'complete';
    return 'skipped';
  }

  if (progressIndex < 0) return 'upcoming';
  if (index < progressIndex) return 'complete';
  if (index === progressIndex) return 'current';
  return 'upcoming';
}

function stageTimestamp(
  stage: SupportOpenStage,
  request: DealerSupportRequest,
  status: TicketFlowStepStatus,
): string | null {
  switch (stage) {
    case 'submitted':
      return request.createdAt;
    case 'under_review':
      return request.assignedAt;
    case 'in_transit':
      return request.shippedAt;
    case 'in_workshop':
      return request.receivedAt;
    default:
      break;
  }

  if (status === 'complete' || status === 'current') {
    return request.updatedAt;
  }

  return null;
}

export function buildSupportTicketFlow(
  request: DealerSupportRequest,
  audience: 'dealer' | 'staff' = 'dealer',
): TicketFlowStep[] {
  const stages = applicableStages(request.type);
  const progressIndex = inferProgressIndex(request, stages);

  const steps: TicketFlowStep[] = stages.map((stage, index) => {
    const status = computeStepStatus(index, progressIndex, request.lifecycle);
    const timestamp = stageTimestamp(stage, request, status);

    return {
      id: stage,
      stepNumber: index + 1,
      title: stepTitle(stage, audience),
      description: stageDescription(stage, request.type, audience),
      status,
      statusLabel: stepStatusLabel(status),
      timestamp,
      tone: stepTone(stage),
    };
  });

  if (request.lifecycle === 'resolved') {
    steps.push({
      id: 'resolved',
      stepNumber: steps.length + 1,
      title: stepTitle('resolved', audience),
      description: request.resolutionSummary?.trim() || 'This request has been completed.',
      status: 'complete',
      statusLabel: stepStatusLabel('complete'),
      timestamp: request.resolvedAt,
      tone: stepTone('resolved'),
    });
  } else if (request.lifecycle === 'cancelled') {
    steps.push({
      id: 'cancelled',
      stepNumber: steps.length + 1,
      title: stepTitle('cancelled', audience),
      description: 'This request was closed without resolution.',
      status: 'complete',
      statusLabel: stepStatusLabel('complete'),
      timestamp: request.resolvedAt ?? request.updatedAt,
      tone: stepTone('cancelled'),
    });
  }

  return steps;
}

export function ticketFlowCurrentStatusLabel(steps: TicketFlowStep[]): string {
  const current = steps.find(step => step.status === 'current');
  if (current) return current.title;

  const resolved = steps.find(step => step.id === 'resolved');
  if (resolved) return resolved.title;

  const cancelled = steps.find(step => step.id === 'cancelled');
  if (cancelled) return cancelled.title;

  const lastComplete = [...steps].reverse().find(step => step.status === 'complete');
  return lastComplete?.title ?? 'Submitted';
}

export function formatTicketFlowTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const formatted = formatSupportDateTimeCompact(value);
  return formatted === '—' ? null : formatted;
}
