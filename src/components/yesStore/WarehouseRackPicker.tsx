import React from 'react';
import { Info } from 'lucide-react';
import { VALID_RACK_LETTERS } from '../../types/yes-store';
import { WarehouseWizardShell } from './WarehouseWizardShell';

type WarehouseRackPickerProps = {
  onBack: () => void;
  onHome: () => void;
  onNext: (rackId: string) => void;
};

export const WarehouseRackPicker: React.FC<WarehouseRackPickerProps> = ({ onBack, onHome, onNext }) => {
  return (
    <WarehouseWizardShell
      title="Select Rack"
      onBack={onBack}
      onHome={onHome}
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
            className="wh-grid-btn"
            onClick={() => onNext(letter)}
          >
            {letter.toUpperCase()}
          </button>
        ))}
      </div>
    </WarehouseWizardShell>
  );
};
