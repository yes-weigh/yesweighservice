import React, { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

export type QuantityStepperProps = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  /** Root class (defaults to quantity-stepper). Extra classes merge in. */
  className?: string;
  buttonClassName?: string;
  inputClassName?: string;
  'aria-label'?: string;
  /** Stop click/focus bubbling (e.g. inside clickable cards). */
  stopPropagation?: boolean;
};

function clamp(n: number, min: number, max?: number): number {
  let next = Math.floor(n);
  if (!Number.isFinite(next)) next = min;
  if (next < min) next = min;
  if (max != null && next > max) next = max;
  return next;
}

/**
 * +/- quantity control with a tappable center field that opens the
 * mobile numeric keyboard (PWA / Capacitor WebView).
 */
export const QuantityStepper: React.FC<QuantityStepperProps> = ({
  value,
  onChange,
  min = 1,
  max,
  disabled = false,
  className,
  buttonClassName,
  inputClassName,
  'aria-label': ariaLabel = 'Quantity',
  stopPropagation = false,
}) => {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    if (raw.trim() === '') {
      setText(String(value));
      return;
    }
    const next = clamp(Number(raw), min, max);
    setText(String(next));
    if (next !== value) onChange(next);
  };

  const bump = (delta: number) => {
    onChange(clamp(value + delta, min, max));
  };

  const guard = (event: React.SyntheticEvent) => {
    if (stopPropagation) event.stopPropagation();
  };

  return (
    <div
      className={['quantity-stepper', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      onClick={guard}
      onPointerDown={guard}
    >
      <button
        type="button"
        className={['quantity-stepper__btn', buttonClassName].filter(Boolean).join(' ')}
        onClick={e => {
          guard(e);
          bump(-1);
        }}
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
      >
        <Minus size={16} aria-hidden />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint="done"
        autoComplete="off"
        className={['quantity-stepper__input', inputClassName].filter(Boolean).join(' ')}
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={e => {
          const next = e.target.value;
          if (next === '' || /^\d+$/.test(next)) setText(next);
        }}
        onBlur={e => commit(e.target.value)}
        onFocus={e => {
          guard(e);
          e.target.select();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(text);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button
        type="button"
        className={['quantity-stepper__btn', buttonClassName].filter(Boolean).join(' ')}
        onClick={e => {
          guard(e);
          bump(1);
        }}
        disabled={disabled || (max != null && value >= max)}
        aria-label="Increase quantity"
      >
        <Plus size={16} aria-hidden />
      </button>
    </div>
  );
};
