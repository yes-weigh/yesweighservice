import React from 'react';
import {
  Container,
  Factory,
  FilePlus2,
  LayoutGrid,
  Ship,
} from 'lucide-react';
import {
  PURCHASE_ORDER_PIPELINE_LABELS,
  PURCHASE_ORDER_PIPELINE_STAGES,
  type PurchaseOrderPipelineStage,
} from '../../lib/admin-purchase-orders';

const STAGE_ICONS: Record<PurchaseOrderPipelineStage | 'all', React.ReactNode> = {
  new_po: <FilePlus2 size={16} strokeWidth={2.2} />,
  underproduction: <Factory size={16} strokeWidth={2.2} />,
  shipped: <Container size={16} strokeWidth={2.2} />,
  transit: <Ship size={16} strokeWidth={2.2} />,
  all: <LayoutGrid size={16} strokeWidth={2.2} />,
};

type Props = {
  value: PurchaseOrderPipelineStage | 'all';
  counts: Record<PurchaseOrderPipelineStage | 'all', number>;
  loading?: boolean;
  onChange: (next: PurchaseOrderPipelineStage | 'all') => void;
};

export function PurchaseOrderPipelineFilterBlocks({
  value,
  counts,
  loading = false,
  onChange,
}: Props) {
  return (
    <div
      className="unified-so-stage-blocks unified-so-stage-blocks--po-pipeline"
      role="tablist"
      aria-label="Purchase order pipeline"
    >
      {PURCHASE_ORDER_PIPELINE_STAGES.map(stage => {
        const active = value === stage;
        const label = PURCHASE_ORDER_PIPELINE_LABELS[stage];
        return (
          <button
            key={stage}
            type="button"
            role="tab"
            aria-selected={active}
            className={`unified-so-category-block unified-so-stage-block unified-so-stage-block--${stage}${
              active ? ' is-active' : ''
            }`}
            onClick={() => onChange(stage)}
            title={label}
          >
            <span className="unified-so-category-block__icon" aria-hidden>
              <span className={`unified-so-stage-block__icon unified-so-stage-block__icon--${stage}`}>
                {STAGE_ICONS[stage]}
              </span>
            </span>
            <span className="unified-so-category-block__label">{label}</span>
            <span className="unified-so-category-block__count">
              {loading ? '…' : (counts[stage] ?? 0).toLocaleString('en-IN')}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        role="tab"
        aria-selected={value === 'all'}
        className={`unified-so-category-block unified-so-stage-block unified-so-stage-block--all${
          value === 'all' ? ' is-active' : ''
        }`}
        onClick={() => onChange('all')}
        title="All purchase orders"
      >
        <span className="unified-so-category-block__icon" aria-hidden>
          <span className="unified-so-stage-block__icon unified-so-stage-block__icon--all">
            {STAGE_ICONS.all}
          </span>
        </span>
        <span className="unified-so-category-block__label">All</span>
        <span className="unified-so-category-block__count">
          {loading ? '…' : (counts.all ?? 0).toLocaleString('en-IN')}
        </span>
      </button>
    </div>
  );
}
