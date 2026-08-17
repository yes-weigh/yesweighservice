import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import type { KpiPeriod } from '../../types/invoices';

export type SalesMapPeriod = Exclude<KpiPeriod, 'lifetime'> | 'custom';

export const SALES_MAP_PERIOD_OPTIONS: Array<{ value: SalesMapPeriod; label: string }> = [
  { value: 'current_month', label: 'This month' },
  { value: 'previous_month', label: 'Previous month' },
  { value: 'financial_year', label: 'This FY' },
  { value: 'previous_financial_year', label: 'Previous FY' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 'custom', label: 'Custom' },
];

interface SalesMapPeriodSelectProps {
  value: SalesMapPeriod;
  rangeLabel: string;
  customFrom: string;
  customTo: string;
  onChange: (value: SalesMapPeriod) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
}

export const SalesMapPeriodSelect: React.FC<SalesMapPeriodSelectProps> = ({
  value,
  rangeLabel,
  customFrom,
  customTo,
  onChange,
  onCustomFromChange,
  onCustomToChange,
}) => {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isFiltered = value !== 'current_month';

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(window.innerWidth - 16, 240);
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      left: Math.max(8, rect.right - width),
      width,
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
      if ((target as Element).closest?.('.sales-map-period-popover')) return;
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

  const pick = (preset: SalesMapPeriod) => {
    onChange(preset);
    if (preset !== 'custom') setOpen(false);
  };

  const menu = open ? (
    <div
      className="sales-map-period-popover dealer-dash-range-select__menu dealer-dash-range-select__menu--portal panel glass"
      style={menuStyle}
      role="listbox"
      aria-label="Date range"
    >
      <ul className="sales-map-period-popover__list">
        {SALES_MAP_PERIOD_OPTIONS.map(option => {
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
      {value === 'custom' && (
        <div className="sales-map-period-popover__custom">
          <label className="dealer-dash-period__date">
            <span>From</span>
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={event => onCustomFromChange(event.target.value)}
            />
          </label>
          <label className="dealer-dash-period__date">
            <span>To</span>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={event => onCustomToChange(event.target.value)}
            />
          </label>
        </div>
      )}
      <p className="sales-map-period-popover__range">{rangeLabel}</p>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="sales-map__period">
      <button
        ref={triggerRef}
        type="button"
        className={[
          'catalog-header-filter-btn',
          open ? 'catalog-header-filter-btn--open' : '',
          isFiltered ? 'catalog-header-filter-btn--active' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter date range"
        title="Filters"
      >
        <SlidersHorizontal size={20} strokeWidth={2.25} />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
};
