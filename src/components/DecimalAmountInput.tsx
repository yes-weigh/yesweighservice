import React, { useEffect, useState } from 'react';

export type DecimalAmountInputProps = {
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
  max?: number;
  /** Max digits after the decimal (default 2). Use 0 for integers. */
  decimals?: number;
  /** Allow an empty field; calls onChange(null) instead of restoring the previous value. */
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  id?: string;
};

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function formatAmount(value: number | null, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(roundTo(value, decimals));
}

function allowedText(raw: string, decimals: number): boolean {
  if (raw === '') return true;
  return decimals > 0
    ? new RegExp(`^\\d*\\.?\\d{0,${decimals}}$`).test(raw)
    : /^\d*$/.test(raw);
}

function parseAmount(
  raw: string,
  min: number,
  max: number | undefined,
  decimals: number,
): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '.') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  let next = roundTo(n, decimals);
  if (next < min) next = min;
  if (max != null && next > max) next = max;
  return next;
}

export type DecimalTextInputProps = {
  value: string;
  onChange: (next: string) => void;
  decimals?: number;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  id?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
};

/**
 * Decimal draft as a string (parent already keeps text). Selects on focus so
 * typing over 0 does not leave a leading zero.
 */
export const DecimalTextInput: React.FC<DecimalTextInputProps> = ({
  value,
  onChange,
  decimals = 2,
  disabled = false,
  className,
  placeholder,
  autoFocus,
  'aria-label': ariaLabel,
  id,
  onKeyDown,
}) => (
  <input
    id={id}
    type="text"
    inputMode={decimals > 0 ? 'decimal' : 'numeric'}
    enterKeyHint="done"
    autoComplete="off"
    className={className}
    value={value}
    placeholder={placeholder}
    autoFocus={autoFocus}
    disabled={disabled}
    aria-label={ariaLabel}
    onFocus={e => e.target.select()}
    onKeyDown={onKeyDown}
    onChange={e => {
      const next = e.target.value;
      if (allowedText(next, decimals)) onChange(next);
    }}
  />
);

/**
 * Text decimal field that keeps a draft string while typing (no stuck leading 0),
 * and commits live when the value is parseable.
 */
export const DecimalAmountInput: React.FC<DecimalAmountInputProps> = ({
  value,
  onChange,
  min = 0,
  max,
  decimals = 2,
  allowEmpty = false,
  disabled = false,
  className,
  placeholder,
  autoFocus,
  'aria-label': ariaLabel,
  id,
}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => formatAmount(value, decimals));

  useEffect(() => {
    if (!editing) setText(formatAmount(value, decimals));
  }, [value, decimals, editing]);

  const emit = (next: number | null) => {
    if (next === value) return;
    if (next == null && value == null) return;
    onChange(next);
  };

  const commit = (raw: string) => {
    const parsed = parseAmount(raw, min, max, decimals);
    if (parsed == null) {
      if (allowEmpty) {
        setText('');
        emit(null);
        return;
      }
      setText(formatAmount(value, decimals));
      return;
    }
    setText(formatAmount(parsed, decimals));
    emit(parsed);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      enterKeyHint="done"
      autoComplete="off"
      className={className}
      value={text}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={e => {
        setEditing(true);
        e.target.select();
      }}
      onBlur={() => {
        setEditing(false);
        commit(text);
      }}
      onChange={e => {
        const next = e.target.value;
        if (!allowedText(next, decimals)) return;
        setText(next);
        if (next.trim() === '') {
          if (allowEmpty) emit(null);
          return;
        }
        const parsed = parseAmount(next, min, max, decimals);
        if (parsed != null) emit(parsed);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(text);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};
