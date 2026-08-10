import React from 'react';

type Props = {
  size?: number;
  className?: string;
  /** Ignored — kept so the icon can stand in for Lucide icons. */
  strokeWidth?: number;
};

/**
 * E-way bill mark: truck badge adapted for dark UI.
 * Circle + cutouts use `currentColor` (card tone); truck body is light slate.
 */
export const EwayBillIcon: React.FC<Props> = ({ size = 22, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <circle cx="32" cy="32" r="32" fill="currentColor" />
    {/* Truck — light fill for contrast on dark cards */}
    <g fill="#f1f5f9">
      {/* Cargo box */}
      <rect x="8.5" y="18.5" width="30" height="24" rx="2.2" />
      {/* Cab + roof overhang */}
      <path d="M38.5 24.5h9.2c1.15 0 2.15.7 2.55 1.75l2.9 7.4c.15.4.25.85.25 1.3V42.5H38.5V24.5Z" />
      <rect x="38.5" y="22.5" width="11.5" height="2.4" rx="0.8" />
      {/* Bumper / nose */}
      <rect x="52.8" y="35.5" width="2.6" height="7" rx="0.7" />
      {/* Chassis rails */}
      <rect x="10" y="42.5" width="42" height="3" rx="1" />
      {/* Wheels */}
      <circle cx="19.5" cy="48" r="5.4" />
      <circle cx="45" cy="48" r="5.4" />
    </g>
    {/* Cutouts — punched through to the badge color */}
    <g fill="currentColor">
      <rect x="41" y="27.2" width="7.4" height="7.6" rx="1" />
      <circle cx="19.5" cy="48" r="2.4" />
      <circle cx="45" cy="48" r="2.4" />
      <text
        x="23.5"
        y="29.8"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        fontSize="7.4"
        fontWeight="700"
        letterSpacing="-0.03em"
      >
        e-way
      </text>
      <text
        x="23.5"
        y="38.2"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        fontSize="7.4"
        fontWeight="700"
        letterSpacing="-0.03em"
      >
        bill
      </text>
    </g>
  </svg>
);
