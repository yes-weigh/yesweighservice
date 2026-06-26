import React from 'react';
import { BIN_NUMBERS, type BinNumber, type RowNumber } from '../../types/yes-store';
import { WarehouseWizardShell } from './WarehouseWizardShell';

type WarehouseBinPickerProps = {
  rackId: string;
  rowNumber: RowNumber;
  onBack: () => void;
  onHome: () => void;
  onNext: (binNumber: BinNumber) => void;
};

export const WarehouseBinPicker: React.FC<WarehouseBinPickerProps> = ({
  rackId,
  rowNumber,
  onBack,
  onHome,
  onNext,
}) => {
  return (
    <WarehouseWizardShell
      title="Select Bin"
      onBack={onBack}
      onHome={onHome}
      context={{ rackId, rowNumber }}
    >
      <div className="wh-grid wh-grid--bin">
        {BIN_NUMBERS.map(n => (
          <button
            key={n}
            type="button"
            className="wh-grid-btn"
            onClick={() => onNext(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </WarehouseWizardShell>
  );
};
