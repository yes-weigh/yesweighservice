import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface ThemeSelectOption {
  value: string;
  label: string;
  /** Optional muted secondary text (e.g. email). */
  hint?: string;
}

export interface ThemeSelectProps {
  value: string;
  options: ThemeSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Dense trigger for tight layouts (item cards). */
  compact?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export const ThemeSelect: React.FC<ThemeSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  compact = false,
  className = '',
  id,
  'aria-label': ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find(option => option.value === value);
  const selectedLabel = selected
    ? (selected.hint ? `${selected.label} · ${selected.hint}` : selected.label)
    : placeholder;

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, compact ? 160 : 200);
    const maxH = Math.min(280, window.innerHeight - 24);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < Math.min(maxH, 180) && spaceAbove > spaceBelow;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setMenuStyle({
      position: 'fixed',
      top: openUp ? undefined : rect.bottom + 6,
      bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
      left,
      width,
      maxHeight: openUp ? Math.min(maxH, spaceAbove) : Math.min(maxH, Math.max(spaceBelow, 120)),
      zIndex: 700,
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
      if ((target as Element).closest?.('.theme-select__menu')) return;
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
      className={[
        'theme-select__menu',
        'panel',
        'glass',
        compact ? 'theme-select__menu--compact' : '',
      ].filter(Boolean).join(' ')}
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
              className={`theme-select__option${isActive ? ' is-active' : ''}`}
              onClick={() => pick(option.value)}
            >
              <span className="theme-select__option-label">{option.label}</span>
              {option.hint ? (
                <span className="theme-select__option-hint">{option.hint}</span>
              ) : null}
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
        'theme-select',
        compact ? 'theme-select--compact' : '',
        open ? 'theme-select--open' : '',
        disabled ? 'theme-select--disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="theme-select__trigger"
        onClick={() => {
          if (!disabled) setOpen(v => !v);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className={`theme-select__value${!selected ? ' is-placeholder' : ''}`}>
          {selectedLabel}
        </span>
        <ChevronDown size={compact ? 14 : 16} className="theme-select__chevron" aria-hidden />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
};
