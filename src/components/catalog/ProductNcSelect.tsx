import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface ProductNcSelectOption {
  value: string;
  label: string;
}

export interface ProductNcSelectProps {
  value: string;
  options: ProductNcSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

export const ProductNcSelect: React.FC<ProductNcSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Select',
  disabled = false,
  'aria-label': ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedLabel = options.find(option => option.value === value)?.label ?? placeholder;

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 180);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    const gap = 6;
    const edge = 8;
    const optionH = 36;
    const menuPad = 12;
    const maxCap = Math.min(22 * 16, window.innerHeight * 0.7);
    const needed = Math.min(options.length * optionH + menuPad, maxCap);
    const spaceBelow = window.innerHeight - rect.bottom - gap - edge;
    const spaceAbove = rect.top - gap - edge;
    const openAbove = spaceBelow < needed && spaceAbove > spaceBelow;
    const available = Math.max(0, openAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.max(0, Math.min(maxCap, available || maxCap));
    setMenuStyle({
      position: 'fixed',
      top: openAbove ? 'auto' : rect.bottom + gap,
      bottom: openAbove ? window.innerHeight - rect.top + gap : 'auto',
      left: Math.max(edge, left),
      width,
      maxHeight,
      zIndex: 1400,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;

    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.product-nc-select__menu')) return;
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

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const menu = open ? (
    <ul
      className="product-nc-select__menu panel glass"
      style={menuStyle}
      role="listbox"
      aria-label={ariaLabel ?? 'Options'}
    >
      {options.map(option => {
        const isActive = option.value === value;
        return (
          <li key={option.value} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={isActive}
              className={`product-nc-select__option${isActive ? ' is-active' : ''}`}
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
      className={[
        'product-nc-select',
        open ? 'product-nc-select--open' : '',
        disabled ? 'product-nc-select--disabled' : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        ref={triggerRef}
        type="button"
        className="product-nc-select__trigger"
        onClick={() => {
          if (!disabled) setOpen(v => !v);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="product-nc-select__value">{selectedLabel}</span>
        <ChevronDown size={15} className="product-nc-select__chevron" aria-hidden />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
};
