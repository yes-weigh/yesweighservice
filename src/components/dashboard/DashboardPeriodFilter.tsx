import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarRange, ChevronDown } from 'lucide-react';
import {
  DASHBOARD_PERIOD_OPTIONS,
  dashboardPeriodOptionLabel,
  type DashboardPeriodPreset,
} from '../../lib/dashboardPeriod';

interface DashboardPeriodFilterProps {
  preset: DashboardPeriodPreset;
  customFrom: string;
  customTo: string;
  rangeLabel: string;
  onPresetChange: (preset: DashboardPeriodPreset) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
}

export const DashboardPeriodFilter: React.FC<DashboardPeriodFilterProps> = ({
  preset,
  customFrom,
  customTo,
  rangeLabel,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
}) => {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(window.innerWidth - 16, 260);
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      left: Math.max(8, rect.right - width),
      width,
      zIndex: 520,
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
      if ((target as Element).closest?.('.top-bar-period__menu')) return;
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

  const pick = (next: DashboardPeriodPreset) => {
    onPresetChange(next);
    if (next !== 'custom') setOpen(false);
  };

  const menu = open ? (
    <div
      className="top-bar-period__menu dealer-dash-range-select__menu dealer-dash-range-select__menu--portal panel glass"
      style={menuStyle}
      role="listbox"
      aria-label="Period"
    >
      <p className="top-bar-period__menu-label">Period</p>
      <ul className="top-bar-period__list">
        {DASHBOARD_PERIOD_OPTIONS.map(option => {
          const active = option.value === preset;
          return (
            <li key={option.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={`dealer-dash-range-select__option${active ? ' is-active' : ''}`}
                onClick={() => pick(option.value)}
              >
                {option.label}
              </button>
            </li>
          );
        })}
      </ul>
      {preset === 'custom' && (
        <div className="top-bar-period__custom">
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
      <p className="top-bar-period__range">{rangeLabel}</p>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={`top-bar-period${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="top-bar-period__trigger"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Period, ${dashboardPeriodOptionLabel(preset)}`}
        title="Period"
      >
        <CalendarRange size={16} aria-hidden />
        <span className="top-bar-period__value">{dashboardPeriodOptionLabel(preset)}</span>
        <ChevronDown size={14} className="top-bar-period__chevron" aria-hidden />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
};
