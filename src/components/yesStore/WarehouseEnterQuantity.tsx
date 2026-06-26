import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { BinNumber, RowNumber } from '../../types/yes-store';
import { MAX_ITEM_PHOTOS } from '../../types/yes-store';
import { WarehouseWizardShell, WizardNextButton } from './WarehouseWizardShell';

type WarehouseEnterQuantityProps = {
  rackId: string;
  rowNumber: RowNumber;
  binNumber: BinNumber;
  quantity: number;
  onQuantityChange: (qty: number) => void;
  photoCount: number;
  onBack: () => void;
  onSubmit: () => void;
  saving?: boolean;
  error?: string;
  success?: boolean;
};

export const WarehouseEnterQuantity: React.FC<WarehouseEnterQuantityProps> = ({
  rackId,
  rowNumber,
  binNumber,
  quantity,
  onQuantityChange,
  photoCount,
  onBack,
  onSubmit,
  saving,
  error,
  success,
}) => (
  <WarehouseWizardShell
    title="Enter Quantity"
    onBack={onBack}
    context={{ rackId, rowNumber, binNumber }}
    footer={
      <WizardNextButton
        label={saving ? 'Submitting…' : 'Submit'}
        variant="success"
        disabled={saving || quantity < 1}
        onClick={onSubmit}
      />
    }
  >
    {error && <div className="wh-error">{error}</div>}

    <div className="wh-field">
      <label htmlFor="wh-qty">Enter total quantity</label>
      <input
        id="wh-qty"
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        className="wh-field__input"
        value={quantity}
        onChange={e => onQuantityChange(Math.max(1, Number(e.target.value) || 1))}
      />
    </div>

    <div className="wh-summary">
      <h3>Summary</h3>
      <dl>
        <div><dt>Rack</dt><dd>{rackId.toUpperCase()}</dd></div>
        <div><dt>Row</dt><dd>{rowNumber}</dd></div>
        <div><dt>Bin</dt><dd>{binNumber}</dd></div>
        <div><dt>Quantity</dt><dd>{quantity}</dd></div>
        <div><dt>Photos</dt><dd>{photoCount} / {MAX_ITEM_PHOTOS}</dd></div>
      </dl>
    </div>

    {success && (
      <p className="wh-success">
        <CheckCircle2 size={18} aria-hidden />
        Your data is secure and the audit is recorded successfully.
      </p>
    )}
  </WarehouseWizardShell>
);
