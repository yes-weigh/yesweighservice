import React from 'react';
import type { DealerStatusMeta } from '../../lib/dealerStatus';

interface DealerStatusIndicatorProps {
  meta: Pick<
    DealerStatusMeta,
    'toneClass' | 'stageLabel' | 'loginLabel' | 'label'
  >;
  compact?: boolean;
  className?: string;
}

export const DealerStatusIndicator: React.FC<DealerStatusIndicatorProps> = ({
  meta,
  compact = false,
  className = '',
}) => {
  if (compact) {
    return (
      <span
        className={`dealers-status-indicator dealers-status-indicator--compact ${meta.toneClass} ${className}`.trim()}
        title={meta.label}
        aria-label={meta.label}
      >
        <span className="dealers-status-indicator__ring" aria-hidden>
          <span className="dealers-status-indicator__dot" />
        </span>
      </span>
    );
  }

  return (
    <div
      className={`dealers-status-indicator ${meta.toneClass} ${className}`.trim()}
      title={meta.label}
      aria-label={meta.label}
    >
      <span className="dealers-status-indicator__ring" aria-hidden>
        <span className="dealers-status-indicator__dot" />
      </span>
      <div className="dealers-status-indicator__text">
        <span className="dealers-status-indicator__stage">{meta.stageLabel}</span>
        <span className="dealers-status-indicator__login">{meta.loginLabel}</span>
      </div>
    </div>
  );
};
