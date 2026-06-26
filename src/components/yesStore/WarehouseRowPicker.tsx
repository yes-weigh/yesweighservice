import React, { useState } from 'react';
import { ROW_NUMBERS, type RowNumber } from '../../types/yes-store';
import { WarehouseWizardShell, WizardNextButton } from './WarehouseWizardShell';

type WarehouseRowPickerProps = {
  rackId: string;
  onBack: () => void;
  onNext: (rowNumber: RowNumber) => void;
};

export const WarehouseRowPicker: React.FC<WarehouseRowPickerProps> = ({
  rackId,
  onBack,
  onNext,
}) => {
  const [selected, setSelected] = useState<RowNumber | null>(null);

  return (
    <WarehouseWizardShell
      title="Select Row"
      onBack={onBack}
      context={{ rackId }}
      footer={
        <WizardNextButton
          disabled={selected == null}
          onClick={() => selected != null && onNext(selected)}
        />
      }
    >
      <ul className="wh-radio-list">
        {ROW_NUMBERS.map(n => (
          <li key={n}>
            <button
              type="button"
              className={`wh-radio-row ${selected === n ? 'is-selected' : ''}`}
              onClick={() => setSelected(n)}
            >
              <span>Row {n}</span>
              <span className={`wh-radio-dot ${selected === n ? 'is-on' : ''}`} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </WarehouseWizardShell>
  );
};
