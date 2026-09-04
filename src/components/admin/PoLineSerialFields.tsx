import React, { useMemo } from 'react';
import { previewSerialRange } from '../../lib/serialNumberAllotment';
import { useProductSerialCursor } from '../../lib/productSerialCursor';

type PoLineSerialFieldsProps = {
  startNumber: string;
  endNumber: string;
  lineQty: number;
  disabled?: boolean;
  name: string;
  productId?: string | null;
  onChange: (next: { startNumber: string; endNumber: string }) => void;
};

export const PoLineSerialFields: React.FC<PoLineSerialFieldsProps> = ({
  startNumber,
  endNumber,
  lineQty,
  disabled,
  name,
  productId,
  onChange,
}) => {
  const preview = useMemo(
    () => previewSerialRange({ from: startNumber, to: endNumber, missingText: '' }),
    [startNumber, endNumber],
  );
  const cursor = useProductSerialCursor(productId);
  const hasInput = Boolean(startNumber.trim() || endNumber.trim());
  const qtyLabel = hasInput && !preview.error ? preview.count.toLocaleString('en-IN') : '—';
  const mismatch = hasInput && !preview.error && preview.count !== lineQty;

  return (
    <div className="po-edit-line__serials">
      <label className="po-edit-line__field">
        <span className="text-muted text-sm">Start number</span>
        <input
          className="input-field po-edit-line__serial-input"
          type="text"
          value={startNumber}
          disabled={disabled}
          placeholder={cursor?.nextSerial || 'e.g. YW2408001'}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Start serial for ${name}`}
          onChange={event => onChange({ startNumber: event.target.value, endNumber })}
        />
      </label>
      <label className="po-edit-line__field">
        <span className="text-muted text-sm">End number</span>
        <input
          className="input-field po-edit-line__serial-input"
          type="text"
          value={endNumber}
          disabled={disabled}
          placeholder="e.g. YW2408500"
          autoComplete="off"
          spellCheck={false}
          aria-label={`End serial for ${name}`}
          onChange={event => onChange({ startNumber, endNumber: event.target.value })}
        />
      </label>
      <div className="po-edit-line__field po-edit-line__serial-qty">
        <span className="text-muted text-sm">Qty</span>
        <strong className={preview.error && hasInput ? 'is-error' : undefined}>{qtyLabel}</strong>
      </div>
      {preview.error && hasInput ? (
        <p className="po-edit-line__serial-hint is-error">{preview.error}</p>
      ) : mismatch ? (
        <p className="po-edit-line__serial-hint">
          Range qty {preview.count.toLocaleString('en-IN')} does not match line qty {lineQty.toLocaleString('en-IN')}.
        </p>
      ) : cursor?.lastSerial ? (
        <p className="po-edit-line__serial-hint">
          Last allotted {cursor.lastSerial}
          {cursor.nextSerial ? ` · next ${cursor.nextSerial}` : ''}
        </p>
      ) : null}
    </div>
  );
};
