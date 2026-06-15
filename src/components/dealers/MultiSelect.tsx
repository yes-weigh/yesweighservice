import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const toggle = (val: string) => {
    if (value.includes(val)) {
      onChange(value.filter(v => v !== val));
    } else {
      onChange([...value, val]);
    }
  };

  const label =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? options.find(o => o.value === value[0])?.label ?? value[0]
        : `${value.length} selected`;

  return (
    <div className={`dealers-multiselect ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="dealers-multiselect__trigger catalog-select"
        onClick={() => setOpen(v => !v)}
      >
        <span className="dealers-multiselect__label">{label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="dealers-multiselect__menu panel glass">
          {options.map(opt => (
            <label key={opt.value} className="dealers-multiselect__option">
              <input
                type="checkbox"
                checked={value.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
      {value.length > 0 && (
        <button
          type="button"
          className="dealers-multiselect__clear"
          onClick={() => onChange([])}
          aria-label="Clear selection"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
};
