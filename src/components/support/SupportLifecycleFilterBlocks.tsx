import React from 'react';
import { BadgeCheck, Ban, CircleDot, LayoutGrid } from 'lucide-react';
import {
  SUPPORT_LIFECYCLE_FILTERS,
  type SupportLifecycleFilter,
} from '../../lib/supportRequestDisplay';

const LIFECYCLE_ICONS: Record<SupportLifecycleFilter, React.ReactNode> = {
  all: <LayoutGrid size={16} strokeWidth={2.2} />,
  open: <CircleDot size={16} strokeWidth={2.2} />,
  resolved: <BadgeCheck size={16} strokeWidth={2.2} />,
  cancelled: <Ban size={16} strokeWidth={2.2} />,
};

type Props = {
  value: SupportLifecycleFilter;
  counts: Record<SupportLifecycleFilter, number>;
  loading?: boolean;
  onChange: (next: SupportLifecycleFilter) => void;
};

export function SupportLifecycleFilterBlocks({
  value,
  counts,
  loading = false,
  onChange,
}: Props) {
  return (
    <div
      className="unified-so-stage-blocks support-lifecycle-blocks"
      role="tablist"
      aria-label="Filter by lifecycle"
    >
      {SUPPORT_LIFECYCLE_FILTERS.map(tab => {
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`unified-so-category-block unified-so-stage-block unified-so-stage-block--${tab.value}${
              active ? ' is-active' : ''
            }`}
            onClick={() => onChange(tab.value)}
            title={tab.label}
          >
            <span className="unified-so-category-block__icon" aria-hidden>
              <span className={`unified-so-stage-block__icon unified-so-stage-block__icon--${tab.value}`}>
                {LIFECYCLE_ICONS[tab.value]}
              </span>
            </span>
            <span className="unified-so-category-block__label">{tab.label}</span>
            <span className="unified-so-category-block__count">
              {loading ? '…' : (counts[tab.value] ?? 0).toLocaleString('en-IN')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
