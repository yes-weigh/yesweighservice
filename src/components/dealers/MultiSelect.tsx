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
  const triggerRef = useRef<HTMLDivElement>(null);

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
  }, [open, menuPortal, value]);

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

  const removeChip = (val: string, e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onChange(value.filter(v => v !== val));
  };

  const clearAll = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onChange([]);
  };

  const isInteractiveChild = (target: Element) =>
    Boolean(
      target.closest('.dealers-multiselect__chip-remove')
      || target.closest('.dealers-multiselect__clear'),
    );

  const handleTriggerMouseDown = (e: React.MouseEvent) => {
    if (isInteractiveChild(e.target as Element)) return;
    // Prevent parent <label> from forwarding the click to nested buttons.
    e.preventDefault();
  };

  const handleTriggerClick = (e: React.MouseEvent) => {
    if (disabled || isInteractiveChild(e.target as Element)) return;
    setOpen(v => !v);
  };

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
    <div
      className={`dealers-multiselect${value.length > 0 ? ' dealers-multiselect--has-value' : ''} ${className}`.trim()}
      ref={rootRef}
    >
      <div
        ref={triggerRef}
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        className="dealers-multiselect__trigger catalog-select"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-disabled={disabled}
        onMouseDown={handleTriggerMouseDown}
        onClick={handleTriggerClick}
        onKeyDown={e => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(v => !v);
          }
        }}
      >
        <span className="dealers-multiselect__value">
          {value.length === 0 ? (
            <span className="dealers-multiselect__placeholder">{placeholder}</span>
          ) : (
            <span className="dealers-multiselect__chips">
              {value.map(val => (
                <span key={val} className="dealers-multiselect__chip">
                  <span className="dealers-multiselect__chip-label">
                    {options.find(o => o.value === val)?.label ?? val}
                  </span>
                  {!disabled && (
                    <span
                      role="button"
                      tabIndex={-1}
                      className="dealers-multiselect__chip-remove"
                      aria-label={`Remove ${options.find(o => o.value === val)?.label ?? val}`}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => removeChip(val, e)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') removeChip(val, e);
                      }}
                    >
                      <X size={11} />
                    </span>
                  )}
                </span>
              ))}
            </span>
          )}
        </span>
        <div className="dealers-multiselect__controls">
          {value.length > 0 && !disabled && (
            <button
              type="button"
              className="dealers-multiselect__clear"
              aria-label="Clear all categories"
              onMouseDown={e => e.stopPropagation()}
              onClick={clearAll}
            >
              <X size={12} />
            </button>
          )}
          <span className="dealers-multiselect__toggle" aria-hidden="true">
            <ChevronDown size={14} className={open ? 'dealers-multiselect__chevron--open' : undefined} />
          </span>
        </div>
      </div>
      {menu && (menuPortal ? createPortal(menu, document.body) : menu)}
    </div>
  );
};
