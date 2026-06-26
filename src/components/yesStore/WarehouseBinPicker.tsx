import React, { useState } from 'react';
import { BIN_NUMBERS, type BinNumber, type RowNumber } from '../../types/yes-store';
import { WarehouseWizardShell, WizardNextButton } from './WarehouseWizardShell';

type WarehouseBinPickerProps = {
  rackId: string;
  rowNumber: RowNumber;
  onBack: () => void;
  onNext: (binNumber: BinNumber) => void;
};

export const WarehouseBinPicker: React.FC<WarehouseBinPickerProps> = ({
  rackId,
  rowNumber,
  onBack,
  onNext,
}) => {
  const [selected, setSelected] = useState<BinNumber | null>(null);

  return (
    <WarehouseWizardShell
      title="Select Bin"
      onBack={onBack}
      context={{ rackId, rowNumber }}
      footer={
        <WizardNextButton
          disabled={selected == null}
          onClick={() => selected != null && onNext(selected)}
        />
      }
    >
      <div className="wh-grid wh-grid--bin">
        {BIN_NUMBERS.map(n => (
          <button
            key={n}
            type="button"
            className={`wh-grid-btn ${selected === n ? 'is-selected' : ''}`}
            onClick={() => setSelected(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </WarehouseWizardShell>
  );
};
