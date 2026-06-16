import React from 'react';
import type { DealerStatusMeta } from '../../lib/dealerStatus';
import { DealerStatusIndicator } from './DealerStatusIndicator';

interface DealerStatusBadgeProps {
  meta: Pick<
    DealerStatusMeta,
    'symbol' | 'label' | 'badgeClass' | 'toneClass' | 'stageLabel' | 'loginLabel'
  >;
  compact?: boolean;
}

/** @deprecated Prefer DealerStatusIndicator — kept for legend/picker compatibility */
export const DealerStatusBadge: React.FC<DealerStatusBadgeProps> = ({ meta, compact }) => (
  <DealerStatusIndicator meta={meta} compact={compact} />
);
