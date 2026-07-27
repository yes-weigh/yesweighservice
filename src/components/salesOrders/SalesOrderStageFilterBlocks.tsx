import React from 'react';
import {
  BadgeCheck,
  ClipboardList,
  IndianRupee,
  ShieldCheck,
} from 'lucide-react';
import {
  YESONE_STAGE_FILTERS,
  yesOneStageLabelForAudience,
  type YesOneStageAudience,
  type YesOneStageFilter,
} from '../../lib/salesOrderWorkflow';

const STAGE_ICONS: Record<YesOneStageFilter, React.ReactNode> = {
  review: <ClipboardList size={16} strokeWidth={2.2} />,
  ready_for_payment: <IndianRupee size={16} strokeWidth={2.2} />,
  payment_submitted: <ShieldCheck size={16} strokeWidth={2.2} />,
  completed: <BadgeCheck size={16} strokeWidth={2.2} />,
};

export type SalesOrderStageCounts = Record<YesOneStageFilter, number>;

export const EMPTY_STAGE_COUNTS: SalesOrderStageCounts = {
  review: 0,
  ready_for_payment: 0,
  payment_submitted: 0,
  completed: 0,
};

type Props = {
  audience: YesOneStageAudience;
  value: YesOneStageFilter | 'all';
  counts: SalesOrderStageCounts;
  loading?: boolean;
  onChange: (next: YesOneStageFilter | 'all') => void;
};

export function SalesOrderStageFilterBlocks({
  audience,
  value,
  counts,
  loading = false,
  onChange,
}: Props) {
  return (
    <div className="unified-so-stage-blocks" role="tablist" aria-label="Order stage">
      {YESONE_STAGE_FILTERS.map(stage => {
        const active = value === stage;
        const label = yesOneStageLabelForAudience(stage, audience);
        return (
          <button
            key={stage}
            type="button"
            role="tab"
            aria-selected={active}
            className={`unified-so-category-block unified-so-stage-block unified-so-stage-block--${stage}${
              active ? ' is-active' : ''
            }`}
            onClick={() => onChange(active ? 'all' : stage)}
            title={label}
          >
            <span className="unified-so-category-block__icon" aria-hidden>
              <span className={`unified-so-stage-block__icon unified-so-stage-block__icon--${stage}`}>
                {STAGE_ICONS[stage]}
              </span>
            </span>
            <span className="unified-so-category-block__label">{label}</span>
            <span className="unified-so-category-block__count">
              {loading ? '…' : counts[stage].toLocaleString('en-IN')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
