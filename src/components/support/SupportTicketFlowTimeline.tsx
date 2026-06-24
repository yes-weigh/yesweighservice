import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { isInternalOpsUser } from '../../lib/staffAccess';
import {
  buildSupportTicketFlow,
  formatTicketFlowTimestamp,
  type TicketFlowStep,
} from '../../lib/supportTicketFlow';
import { supportDisplayLabel } from '../../lib/supportStatus';
import type { User } from '../../types';
import type { DealerSupportRequest } from '../../types/dealer-support';
import { SUPPORT_TYPE_LABELS } from '../../types/dealer-support';

interface SupportTicketFlowTimelineProps {
  request: DealerSupportRequest;
  user: User | null;
}

function FlowStepItem({ step, isLast }: { step: TicketFlowStep; isLast: boolean }) {
  const timestamp = formatTicketFlowTimestamp(step.timestamp);

  return (
    <li
      className={[
        'support-ticket-flow__step',
        `support-ticket-flow__step--${step.status}`,
        isLast ? 'support-ticket-flow__step--last' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="support-ticket-flow__rail" aria-hidden>
        <span className="support-ticket-flow__dot">
          {step.status === 'complete' && <Check size={12} strokeWidth={3} />}
        </span>
        {!isLast && <span className="support-ticket-flow__line" />}
      </div>

      <div className="support-ticket-flow__content">
        <div className="support-ticket-flow__step-head">
          <h4 className="support-ticket-flow__step-title">{step.title}</h4>
          {step.status === 'current' && (
            <span className="support-ticket-flow__step-badge">Current</span>
          )}
        </div>
        <p className="support-ticket-flow__step-desc text-sm text-muted">{step.description}</p>
        {timestamp ? (
          <time className="support-ticket-flow__step-time text-sm" dateTime={step.timestamp ?? undefined}>
            {timestamp}
          </time>
        ) : step.status === 'current' ? (
          <span className="support-ticket-flow__step-time text-sm text-muted">In progress</span>
        ) : step.status === 'upcoming' ? (
          <span className="support-ticket-flow__step-time text-sm text-muted">Pending</span>
        ) : null}
      </div>
    </li>
  );
}

export const SupportTicketFlowTimeline: React.FC<SupportTicketFlowTimelineProps> = ({
  request,
  user,
}) => {
  const audience = isInternalOpsUser(user) ? 'staff' : 'dealer';
  const steps = useMemo(
    () => buildSupportTicketFlow(request, audience),
    [request, audience],
  );

  return (
    <section className="support-ticket-flow" aria-label="Ticket flow">
      <header className="support-ticket-flow__header panel glass">
        <div>
          <p className="support-ticket-flow__type text-sm text-muted">
            {SUPPORT_TYPE_LABELS[request.type]}
          </p>
          <h3 className="support-ticket-flow__status">
            {supportDisplayLabel(request, audience)}
          </h3>
        </div>
        <span className={`service-request-status support-ticket-flow__badge support-detail-summary__badge ${request.lifecycle === 'resolved' ? 'service-request-status--done' : request.lifecycle === 'cancelled' ? 'service-request-status--cancelled' : 'service-request-status--pending'}`}>
          {request.requestNumber}
        </span>
      </header>

      <ol className="support-ticket-flow__timeline">
        {steps.map((step, index) => (
          <FlowStepItem
            key={step.id}
            step={step}
            isLast={index === steps.length - 1}
          />
        ))}
      </ol>
    </section>
  );
};
