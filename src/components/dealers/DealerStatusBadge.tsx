import React from 'react';
import type { DealerStatusMeta } from '../../lib/dealerStatus';

interface DealerStatusBadgeProps {
  meta: Pick<DealerStatusMeta, 'symbol' | 'label' | 'badgeClass'>;
}

export const DealerStatusBadge: React.FC<DealerStatusBadgeProps> = ({ meta }) => (
  <span
    className={meta.badgeClass}
    title={meta.label}
    aria-label={meta.label}
  >
    <span className="dealers-status-badge__symbol" aria-hidden>{meta.symbol}</span>
  </span>
);
