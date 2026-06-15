import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  menuPortal?: boolean;
  disabled?: boolean;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  className = '',
  menuPortal = false,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 500,
    });
  };

  useLayoutEffect(() => {
    if (!open || !menuPortal) return;
    updateMenuPosition();
  }, [open, menuPortal]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuPortal && (target as Element).closest?.('.dealers-multiselect__menu--portal')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuPortal]);

  useEffect(() => {
    if (!open || !menuPortal) return;

    const onReposition = () => updateMenuPosition();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, menuPortal]);

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

  const menu = open ? (
    <div
      className={`dealers-multiselect__menu panel glass${menuPortal ? ' dealers-multiselect__menu--portal' : ''}`}
      style={menuPortal ? menuStyle : undefined}
    >
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
  ) : null;

  return (
    <div className={`dealers-multiselect ${className}`.trim()} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="dealers-multiselect__trigger catalog-select"
        onClick={() => !disabled && setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
      >
        <span className="dealers-multiselect__label">{label}</span>
        <ChevronDown size={14} />
      </button>
      {menu && (menuPortal ? createPortal(menu, document.body) : menu)}
      {value.length > 0 && !disabled && (
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
