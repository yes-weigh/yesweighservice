import React from 'react';
import { Info } from 'lucide-react';
import { DEALER_STATUS_LEGEND } from '../../lib/dealerStatus';
import { DealerStatusBadge } from './DealerStatusBadge';

export const DealerStatusLegend: React.FC = () => (
  <div className="dealers-status-legend panel glass" role="note" aria-label="Dealer status legend">
    <div className="dealers-status-legend__title">
      <Info size={15} />
      <span>Stage symbol · signed in (filled) vs not signed in (hollow)</span>
    </div>
    <div className="dealers-status-legend__items">
      {DEALER_STATUS_LEGEND.map(item => (
        <div key={item.key} className="dealers-status-legend__item">
          <DealerStatusBadge meta={item} />
          <span className="dealers-status-legend__text">{item.label}</span>
        </div>
      ))}
    </div>
  </div>
);
