import React from 'react';
import { Info } from 'lucide-react';
import { DEALER_STATUS_LEGEND } from '../../lib/dealerStatus';
import { DealerStatusBadge } from './DealerStatusBadge';

export const DealerStatusLegend: React.FC = () => (
  <details className="dealers-status-legend panel glass">
    <summary className="dealers-status-legend__summary">
      <Info size={15} />
      <span>Status legend</span>
      <span className="dealers-status-legend__preview" aria-hidden>
        {DEALER_STATUS_LEGEND.map(item => item.symbol).join(' ')}
      </span>
    </summary>
    <p className="dealers-status-legend__hint">
      Stage symbol · signed in (filled) vs not signed in (hollow)
    </p>
    <div className="dealers-status-legend__items" role="note" aria-label="Dealer status legend">
      {DEALER_STATUS_LEGEND.map(item => (
        <div key={item.key} className="dealers-status-legend__item">
          <DealerStatusBadge meta={item} />
          <span className="dealers-status-legend__text">{item.label}</span>
        </div>
      ))}
    </div>
  </details>
);
