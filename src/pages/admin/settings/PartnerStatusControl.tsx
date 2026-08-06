import React from 'react';
import {
  LOGISTICS_PARTNER_STATUSES,
  LOGISTICS_PARTNER_STATUS_LABELS,
  type LogisticsPartnerStatus,
} from '../../../types/logistics-partner-status';

type Props = {
  status: LogisticsPartnerStatus;
  ariaLabel: string;
  disabled?: boolean;
  title?: string;
  onChange: (next: LogisticsPartnerStatus) => void;
};

/** Active / Inactive / Manual control used on Delivery Partners detail panels. */
export const PartnerStatusControl: React.FC<Props> = ({
  status,
  ariaLabel,
  disabled = false,
  title,
  onChange,
}) => (
  <div
    className={`settings-courier-rates__status-panel settings-logistics__partner-status-row settings-logistics__partner-status-row--${status}`}
  >
    <div className="settings-courier-rates__status-copy">
      <strong>Sales order status</strong>
      <em>
        <span className="settings-logistics__status-chip settings-logistics__status-chip--active">Active</span>
        {' '}
        quoted when rates exist
        {' · '}
        <span className="settings-logistics__status-chip settings-logistics__status-chip--manual">Manual</span>
        {' '}
        selectable, enter ₹ if needed
        {' · '}
        <span className="settings-logistics__status-chip settings-logistics__status-chip--inactive">Inactive</span>
        {' '}
        rules only (hidden on SO)
      </em>
    </div>
    <select
      className={`settings-logistics__partner-status-select settings-logistics__partner-status-select--${status}`}
      value={status}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      onChange={e => {
        onChange(e.target.value as LogisticsPartnerStatus);
      }}
    >
      {LOGISTICS_PARTNER_STATUSES.map(option => (
        <option key={option} value={option}>
          {LOGISTICS_PARTNER_STATUS_LABELS[option]}
        </option>
      ))}
    </select>
  </div>
);
