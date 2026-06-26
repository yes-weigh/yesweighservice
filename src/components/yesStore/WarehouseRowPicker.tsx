import React from 'react';
import { ROW_NUMBERS, type RowNumber } from '../../types/yes-store';
import { WarehouseWizardShell } from './WarehouseWizardShell';

type WarehouseRowPickerProps = {
  rackId: string;
  onBack: () => void;
  onHome: () => void;
  onNext: (rowNumber: RowNumber) => void;
};

export const WarehouseRowPicker: React.FC<WarehouseRowPickerProps> = ({
  rackId,
  onBack,
  onHome,
  onNext,
}) => {
  return (
    <WarehouseWizardShell
      title="Select Row"
      onBack={onBack}
      onHome={onHome}
      context={{ rackId }}
    >
      <ul className="wh-radio-list">
        {ROW_NUMBERS.map(n => (
          <li key={n}>
            <button
              type="button"
              className="wh-radio-row"
              onClick={() => onNext(n)}
            >
              <span>Row {n}</span>
              <span className="wh-radio-dot" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </WarehouseWizardShell>
  );
};
