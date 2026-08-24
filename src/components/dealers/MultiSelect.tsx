import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
}

const OPTION_ROW_PX = 28;
const SEARCH_ROW_PX = 44;
const MENU_PAD_PX = 10;

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
  menuPortal?: boolean;
  disabled?: boolean;
  /** Compact trigger with a count; chips render below instead of inside the box. */
  variant?: 'chips' | 'summary';
  searchable?: boolean;
  searchPlaceholder?: string;
  /** How many options to show before the list scrolls. */
  visibleCount?: number;
  /** Close the menu after adding a value so fields below stay visible. */
  closeOnSelect?: boolean;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  className = '',
  menuPortal = false,
  disabled = false,
  variant = 'chips',
  searchable = false,
  searchPlaceholder = 'Search…',
  visibleCount = 7,
  closeOnSelect = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(opt => opt.label.toLowerCase().includes(q));
  }, [options, query]);

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const target = (searchable ? SEARCH_ROW_PX : 0)
      + visibleCount * OPTION_ROW_PX
      + MENU_PAD_PX;
    const openUp = spaceBelow < target && spaceAbove > spaceBelow;
    const available = openUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.min(target, Math.max(160, available));
    setMenuStyle({
      position: 'fixed',
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      left: rect.left,
      width: rect.width,
      maxHeight,
      zIndex: 1300,
    });
  };

  useLayoutEffect(() => {
    if (!open || !menuPortal) return;
    updateMenuPosition();
  }, [open, menuPortal, value, searchable, visibleCount, filteredOptions.length]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    if (searchable) {
      window.requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, searchable]);

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
      return;
    }
    onChange([...value, val]);
    if (closeOnSelect) setOpen(false);
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

  const chips = (
    <span className={`dealers-multiselect__chips${variant === 'summary' ? ' dealers-multiselect__chips--below' : ''}`}>
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
  );

  const menu = open ? (
    <div
      className={`dealers-multiselect__menu panel glass${menuPortal ? ' dealers-multiselect__menu--portal' : ''}${searchable ? ' dealers-multiselect__menu--search' : ''}`}
      style={menuPortal ? menuStyle : undefined}
    >
      {searchable ? (
        <label className="dealers-multiselect__search">
          <Search size={14} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Escape') setOpen(false);
            }}
          />
        </label>
      ) : null}
      <div className="dealers-multiselect__options">
        {filteredOptions.length === 0 ? (
          <p className="dealers-multiselect__empty">No matches</p>
        ) : (
          filteredOptions.map(opt => (
            <label key={opt.value} className="dealers-multiselect__option">
              <input
                type="checkbox"
                checked={value.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={`dealers-multiselect${value.length > 0 ? ' dealers-multiselect--has-value' : ''}${variant === 'summary' ? ' dealers-multiselect--summary' : ''} ${className}`.trim()}
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
          {variant === 'summary' ? (
            <span className={`dealers-multiselect__summary${value.length === 0 ? ' dealers-multiselect__summary--empty' : ''}`}>
              {value.length === 0
                ? placeholder
                : value.length === 1
                  ? (options.find(o => o.value === value[0])?.label ?? '1 selected')
                  : `${value.length} selected`}
            </span>
          ) : value.length === 0 ? (
            <span className="dealers-multiselect__placeholder">{placeholder}</span>
          ) : chips}
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
      {variant === 'summary' && value.length > 0 && !closeOnSelect ? chips : null}
      {menu && (menuPortal ? createPortal(menu, document.body) : menu)}
    </div>
  );
};
