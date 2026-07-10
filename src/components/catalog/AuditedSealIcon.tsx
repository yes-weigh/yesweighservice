import React from 'react';

/** Compact inline seal for zero stock-difference (no network asset). */
export const AuditedSealIcon: React.FC<{
  className?: string;
  title?: string;
}> = ({ className, title = 'Audited' }) => (
  <svg
    className={className}
    viewBox="0 0 64 78"
    width="40"
    height="49"
    role="img"
    aria-label={title}
  >
    <title>{title}</title>
    {/* Outer green ring */}
    <circle cx="32" cy="30" r="22" fill="#1B5E46" />
    {/* Thin dark ring */}
    <circle cx="32" cy="30" r="18.5" fill="#0f172a" />
    {/* Inner pale face */}
    <circle cx="32" cy="30" r="16.5" fill="#E8F1F0" />
    {/* Checkmark */}
    <path
      d="M22.5 30.2 L28.8 36.4 L42 23.2"
      fill="none"
      stroke="#1B5E46"
      strokeWidth="4.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Ribbon tails */}
    <path
      d="M24 48 L18 66 L24.5 61.5 L28 68 Z"
      fill="#1B5E46"
    />
    <path
      d="M40 48 L46 66 L39.5 61.5 L36 68 Z"
      fill="#1B5E46"
    />
    {/* AUDITED label */}
    <text
      x="32"
      y="74"
      textAnchor="middle"
      fill="#1B5E46"
      fontFamily="Outfit, system-ui, sans-serif"
      fontSize="8"
      fontWeight="800"
      letterSpacing="0.08em"
    >
      AUDITED
    </text>
  </svg>
);
