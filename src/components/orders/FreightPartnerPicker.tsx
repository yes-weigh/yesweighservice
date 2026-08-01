import React from 'react';
import { FREIGHT_LINE_OPTIONS, type FreightLineSku } from '../../constants/freightLines';

export type FreightPartnerPickerProps = {
  selectedSku: string | null;
  amount: string;
  disabled?: boolean;
  onSelect: (sku: FreightLineSku) => void;
  onAmountChange: (amount: string) => void;
  onClear?: () => void;
  heading?: string;
  hint?: string;
};

/** Radio list of courier freight partners; amount shows for the selected partner. */
export const FreightPartnerPicker: React.FC<FreightPartnerPickerProps> = ({
  selectedSku,
  amount,
  disabled = false,
  onSelect,
  onAmountChange,
  onClear,
  heading = 'Choose logistics partner',
  hint = 'Optional — pick a courier partner and enter the freight amount (qty 1).',
}) => (
  <div className="freight-partner-picker">
    {hint ? <p className="text-muted text-sm freight-partner-picker__hint">{hint}</p> : null}
    <div
      className="freight-partner-picker__list"
      role="radiogroup"
      aria-label={heading}
    >
      <p className="freight-partner-picker__label">{heading}</p>
      {FREIGHT_LINE_OPTIONS.map(option => {
        const selected = selectedSku === option.sku;
        return (
          <div
            key={option.sku}
            className={`freight-partner-picker__row${selected ? ' is-selected' : ''}`}
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className="freight-partner-picker__main"
              disabled={disabled}
              onClick={() => onSelect(option.sku)}
            >
              <span
                className={`freight-partner-picker__radio${selected ? ' is-on' : ''}`}
                aria-hidden
              />
              <span className="freight-partner-picker__logo-wrap">
                <img
                  src={option.image}
                  alt=""
                  className="freight-partner-picker__logo"
                  loading="lazy"
                  decoding="async"
                />
              </span>
              <span className="freight-partner-picker__copy">
                <strong>{option.label}</strong>
                <span className="text-muted text-sm">{option.tagline}</span>
              </span>
            </button>
            {selected ? (
              <label className="freight-partner-picker__amount">
                <span className="text-muted text-sm">Amount (₹)</span>
                <input
                  type="number"
                  className="input-field"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={amount}
                  disabled={disabled}
                  autoFocus
                  onChange={e => onAmountChange(e.target.value)}
                />
              </label>
            ) : null}
          </div>
        );
      })}
    </div>
    {onClear && (selectedSku || amount) ? (
      <button
        type="button"
        className="btn btn-ghost btn-sm freight-partner-picker__clear"
        disabled={disabled}
        onClick={onClear}
      >
        Clear freight
      </button>
    ) : null}
  </div>
);
