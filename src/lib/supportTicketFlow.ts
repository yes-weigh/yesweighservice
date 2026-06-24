import { FIRM_NAME_SHORT } from '../constants/brand';
import type { DealerSupportRequest, SupportOpenStage, SupportRequestType } from '../types/dealer-support';
import {
  dealerOpenStageLabel,
  isProductCourierType,
  isSupportOpen,
  staffOpenStageLabel,
} from './supportStatus';
import { formatSupportDateTimeCompact } from './supportRequestDisplay';

export type TicketFlowStepStatus = 'complete' | 'current' | 'upcoming' | 'skipped';

export interface TicketFlowStep {
  id: string;
  title: string;
  description: string;
  status: TicketFlowStepStatus;
  timestamp: string | null;
}

function applicableStages(type: SupportRequestType): SupportOpenStage[] {
  if (isProductCourierType(type)) {
    return ['submitted', 'under_review', 'awaiting_product', 'in_transit', 'in_workshop'];
  }
  return ['submitted', 'under_review', 'awaiting_dealer'];
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

function stageTimestamp(stage: SupportOpenStage, request: DealerSupportRequest): string | null {
  switch (stage) {
    case 'submitted':
      return request.createdAt;
    case 'in_transit':
      return request.shippedAt;
    case 'in_workshop':
      return request.receivedAt;
    default:
      return null;
  }
}

export function buildSupportTicketFlow(
  request: DealerSupportRequest,
  audience: 'dealer' | 'staff' = 'dealer',
): TicketFlowStep[] {
  const stages = applicableStages(request.type);
  const currentStage = request.openStage;
  const currentIndex = currentStage ? stages.indexOf(currentStage) : -1;
  const isClosed = !isSupportOpen(request);

  const steps: TicketFlowStep[] = stages.map((stage, index) => {
    let status: TicketFlowStepStatus;
    if (isClosed) {
      status = index <= currentIndex ? 'complete' : 'skipped';
    } else if (index < currentIndex) {
      status = 'complete';
    } else if (index === currentIndex) {
      status = 'current';
    } else {
      status = 'upcoming';
    }

    const timestamp = stageTimestamp(stage, request)
      ?? (status === 'current' ? request.updatedAt : null);

    return {
      id: stage,
      title: audience === 'staff' ? staffOpenStageLabel(stage) : dealerOpenStageLabel(stage),
      description: stageDescription(stage, request.type, audience),
      status,
      timestamp,
    };
  });

  if (request.lifecycle === 'resolved') {
    steps.push({
      id: 'resolved',
      title: 'Resolved',
      description: request.resolutionSummary?.trim() || 'This request has been completed.',
      status: 'complete',
      timestamp: request.resolvedAt,
    });
  } else if (request.lifecycle === 'cancelled') {
    steps.push({
      id: 'cancelled',
      title: 'Cancelled',
      description: 'This request was closed without resolution.',
      status: 'complete',
      timestamp: request.resolvedAt ?? request.updatedAt,
    });
  }

  return steps;
}

export function formatTicketFlowTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const formatted = formatSupportDateTimeCompact(value);
  return formatted === '—' ? null : formatted;
}
