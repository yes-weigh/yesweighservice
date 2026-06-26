import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { VALID_RACK_LETTERS } from '../../types/yes-store';
import { WarehouseWizardShell, WizardNextButton } from './WarehouseWizardShell';

type WarehouseRackPickerProps = {
  onBack: () => void;
  onNext: (rackId: string) => void;
};

export const WarehouseRackPicker: React.FC<WarehouseRackPickerProps> = ({ onBack, onNext }) => {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <WarehouseWizardShell
      title="Select Rack"
      onBack={onBack}
      footer={
        <WizardNextButton
          disabled={!selected}
          onClick={() => selected && onNext(selected)}
        />
      }
    >
      <div className="wh-callout">
        <Info size={18} aria-hidden />
        <span>Please select a rack to continue.</span>
      </div>

      <div className="wh-grid wh-grid--rack">
        {VALID_RACK_LETTERS.map(letter => (
          <button
            key={letter}
            type="button"
            className={`wh-grid-btn ${selected === letter ? 'is-selected' : ''}`}
            onClick={() => setSelected(letter)}
          >
            {letter.toUpperCase()}
          </button>
        ))}
      </div>
    </WarehouseWizardShell>
  );
};
