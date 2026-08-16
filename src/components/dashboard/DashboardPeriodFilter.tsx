import React from 'react';
import {
  DASHBOARD_PERIOD_OPTIONS,
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
}) => (
  <div className="dealer-dash-period">
    <div className="dealer-dash-period__row">
      <p className="dealer-dash-period__label" id="dealer-dash-period-label">
        Time frame
      </p>
      <div
        className="dealer-dash-period__options"
        role="tablist"
        aria-labelledby="dealer-dash-period-label"
      >
        {DASHBOARD_PERIOD_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={preset === option.value}
            className={`dealer-dash-period__option${preset === option.value ? ' is-active' : ''}`}
            onClick={() => onPresetChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
    {preset === 'custom' && (
      <div className="dealer-dash-period__custom">
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
    <p className="dealer-dash-period__range text-muted text-sm">{rangeLabel}</p>
  </div>
);
