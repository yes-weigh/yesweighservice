import React from 'react';
import { Info } from 'lucide-react';
import { DEALER_STATUS_LEGEND } from '../../lib/dealerStatus';
import { DealerStatusIndicator } from './DealerStatusIndicator';

export const DealerStatusLegend: React.FC = () => (
  <details className="dealers-status-legend panel glass">
    <summary className="dealers-status-legend__summary">
      <Info size={15} />
      <span>Status legend</span>
      <span className="dealers-status-legend__preview" aria-hidden>
        Active · Logged in / Not logged in
      </span>
    </summary>
    <p className="dealers-status-legend__hint">
      Stage colour · logged in vs not logged in
    </p>
    <div className="dealers-status-legend__items" role="note" aria-label="Dealer status legend">
      {DEALER_STATUS_LEGEND.map(item => (
        <div key={item.key} className="dealers-status-legend__item">
          <DealerStatusIndicator meta={item} />
        </div>
      ))}
    </div>
  </details>
);
