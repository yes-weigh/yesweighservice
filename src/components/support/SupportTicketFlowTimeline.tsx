import React, { useMemo } from 'react';
import {
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  Headphones,
  Hourglass,
  MessageCircle,
  Package,
  Search,
  Send,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { isSupportOpen } from '../../lib/supportStatus';
import {
  buildSupportTicketFlow,
  formatTicketFlowTimestamp,
  ticketFlowCurrentStatusLabel,
  type FlowStepTone,
  type TicketFlowStep,
} from '../../lib/supportTicketFlow';
import type { User } from '../../types';
import type { DealerSupportRequest } from '../../types/dealer-support';

interface SupportTicketFlowTimelineProps {
  request: DealerSupportRequest;
  user: User | null;
  onContactSupport?: () => void;
}

function StepIcon({ stepId }: { stepId: string }) {
  const size = 16;
  const strokeWidth = 2.25;

  switch (stepId) {
    case 'submitted':
      return <Send size={size} strokeWidth={strokeWidth} />;
    case 'under_review':
      return <Search size={size} strokeWidth={strokeWidth} />;
    case 'awaiting_product':
      return <ShieldCheck size={size} strokeWidth={strokeWidth} />;
    case 'in_transit':
      return <Package size={size} strokeWidth={strokeWidth} />;
    case 'in_workshop':
      return <Wrench size={size} strokeWidth={strokeWidth} />;
    case 'awaiting_dealer':
      return <Hourglass size={size} strokeWidth={strokeWidth} />;
    case 'resolved':
      return <CheckCircle2 size={size} strokeWidth={strokeWidth} />;
    case 'cancelled':
      return <XCircle size={size} strokeWidth={strokeWidth} />;
    default:
      return <Building2 size={size} strokeWidth={strokeWidth} />;
  }
}

function statusBadgeClass(status: TicketFlowStep['status'], tone: FlowStepTone): string {
  if (status === 'complete') return `support-ticket-flow__pill--tone-${tone}`;
  if (status === 'current') return 'support-ticket-flow__pill--current';
  if (status === 'skipped') return 'support-ticket-flow__pill--skipped';
  return 'support-ticket-flow__pill--pending';
}

function FlowStepItem({ step, isLast }: { step: TicketFlowStep; isLast: boolean }) {
  const timestamp = formatTicketFlowTimestamp(step.timestamp);
  const isActive = step.status === 'complete' || step.status === 'current';

  return (
    <li
      className={[
        'support-ticket-flow__step',
        `support-ticket-flow__step--${step.status}`,
        `support-ticket-flow__step--tone-${step.tone}`,
        isLast ? 'support-ticket-flow__step--last' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="support-ticket-flow__rail" aria-hidden>
        <span className="support-ticket-flow__icon">
          {step.status === 'complete' ? (
            <Check size={14} strokeWidth={3} />
          ) : (
            <StepIcon stepId={step.id} />
          )}
        </span>
        {!isLast && <span className="support-ticket-flow__line" />}
      </div>

      <div className="support-ticket-flow__content">
        <div className="support-ticket-flow__step-head">
          <span className="support-ticket-flow__step-num" aria-hidden>
            {step.stepNumber}
          </span>
          <h4 className="support-ticket-flow__step-title">{step.title}</h4>
        </div>
        <p className="support-ticket-flow__step-desc text-sm text-muted">{step.description}</p>
        {timestamp ? (
          <time className="support-ticket-flow__step-time text-sm" dateTime={step.timestamp ?? undefined}>
            {timestamp}
          </time>
        ) : step.status === 'current' ? (
          <span className="support-ticket-flow__step-time text-sm text-muted">Started recently</span>
        ) : null}
      </div>

      <span
        className={[
          'support-ticket-flow__pill',
          statusBadgeClass(step.status, step.tone),
          isActive ? '' : 'support-ticket-flow__pill--muted',
        ].filter(Boolean).join(' ')}
      >
        {step.statusLabel}
      </span>
    </li>
  );
}

export const SupportTicketFlowTimeline: React.FC<SupportTicketFlowTimelineProps> = ({
  request,
  user,
  onContactSupport,
}) => {
  const audience = isInternalOpsUser(user) ? 'staff' : 'dealer';
  const steps = useMemo(
    () => buildSupportTicketFlow(request, audience),
    [request, audience],
  );
  const currentStatus = useMemo(() => ticketFlowCurrentStatusLabel(steps), [steps]);
  const showContactFooter = audience === 'dealer' && isSupportOpen(request) && onContactSupport;

  return (
    <section className="support-ticket-flow" aria-label="Ticket progress">
      <header className="support-ticket-flow__progress-head">
        <div className="support-ticket-flow__progress-title">
          <BarChart3 size={18} aria-hidden />
          <h3>Ticket progress</h3>
        </div>
        <div className="support-ticket-flow__current">
          <span className="support-ticket-flow__current-label text-sm text-muted">Current status</span>
          <span className="support-ticket-flow__current-badge">{currentStatus}</span>
        </div>
      </header>

      <ol className="support-ticket-flow__timeline panel glass">
        {steps.map((step, index) => (
          <FlowStepItem
            key={step.id}
            step={step}
            isLast={index === steps.length - 1}
          />
        ))}
      </ol>

      {showContactFooter && (
        <footer className="support-ticket-flow__footer panel glass">
          <div className="support-ticket-flow__help">
            <span className="support-ticket-flow__help-icon" aria-hidden>
              <Headphones size={18} />
            </span>
            <div>
              <p className="support-ticket-flow__help-title">Need help?</p>
              <p className="support-ticket-flow__help-desc text-sm text-muted">
                Contact our support team for any assistance.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-outline support-ticket-flow__contact-btn"
            onClick={onContactSupport}
          >
            <MessageCircle size={16} aria-hidden />
            Contact support
          </button>
        </footer>
      )}
    </section>
  );
};
