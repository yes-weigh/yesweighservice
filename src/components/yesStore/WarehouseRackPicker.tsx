import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { VALID_RACK_LETTERS } from '../../types/yes-store';
import { listRacks } from '../../lib/yesStore/data';
import { WarehouseWizardShell } from './WarehouseWizardShell';

type WarehouseRackPickerProps = {
  onBack: () => void;
  onHome: () => void;
  onNext: (rackId: string) => void;
};

export const WarehouseRackPicker: React.FC<WarehouseRackPickerProps> = ({ onBack, onHome, onNext }) => {
  const [rackIds, setRackIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void listRacks()
      .then(racks => {
        if (!active) return;
        const ids = racks.map(rack => rack.id.toLowerCase());
        setRackIds(ids.length ? ids : [...VALID_RACK_LETTERS]);
      })
      .catch(() => {
        if (active) setRackIds([...VALID_RACK_LETTERS]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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

      {loading ? (
        <div className="wh-grid wh-grid--rack">
          <div className="loader-ring mx-auto" />
        </div>
      ) : (
        <div className="wh-grid wh-grid--rack">
          {rackIds.map(letter => (
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
      )}
    </WarehouseWizardShell>
  );
};
