import React from 'react';
import type { ZohoDealer } from '../../types/dealers';
import { getDealerStatusMeta } from '../../lib/dealerStatus';
import { DealerStatusPicker } from './DealerStatusPicker';

interface DealerStatusCellProps {
  dealer: ZohoDealer;
  onStageChange: (stage: string | null) => void;
}

export const DealerStatusCell: React.FC<DealerStatusCellProps> = ({ dealer, onStageChange }) => {
  const meta = getDealerStatusMeta(dealer);
  const ariaLabel = `Change stage for ${dealer.contactName}: ${meta.label}`;

  return (
    <div className="dealers-status-cell">
      <DealerStatusPicker
        meta={meta}
        signedIn={dealer.signedIn}
        stage={dealer.dealerStage}
        onStageChange={onStageChange}
        ariaLabel={ariaLabel}
      />
    </div>
  );
};
