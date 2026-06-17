import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

interface SalesRangeSelectProps {
  value: SalesRangePreset;
  onChange: (value: SalesRangePreset) => void;
}

export const SalesRangeSelect: React.FC<SalesRangeSelectProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedLabel =
    SALES_RANGE_OPTIONS.find(option => option.value === value)?.label ?? 'Select period';

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      zIndex: 500,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.dealer-dash-range-select__menu--portal')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReposition = () => updateMenuPosition();

    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  const pick = (preset: SalesRangePreset) => {
    onChange(preset);
    setOpen(false);
  };

  const menu = open ? (
    <ul
      className="dealer-dash-range-select__menu dealer-dash-range-select__menu--portal panel glass"
      style={menuStyle}
      role="listbox"
      aria-label="Sales period options"
    >
      {SALES_RANGE_OPTIONS.map(option => {
        const isActive = option.value === value;
        return (
          <li key={String(option.value)} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={isActive}
              className={`dealer-dash-range-select__option${isActive ? ' is-active' : ''}`}
              onClick={() => pick(option.value)}
            >
              {option.label}
            </button>
          </li>
        );
      })}
    </ul>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`dealer-dash-range-select${open ? ' dealer-dash-range-select--open' : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="dealer-dash-range-select__trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Sales date range"
      >
        <span className="dealer-dash-range-select__value">{selectedLabel}</span>
        <ChevronDown size={16} className="dealer-dash-range-select__chevron" aria-hidden />
      </button>

      {menu && createPortal(menu, document.body)}
    </div>
  );
};
