import React from 'react';

/** Flat green shield + white circle check — marks GATC stamping available. */
export const StampingShieldIcon: React.FC<{
  className?: string;
  title?: string;
  size?: number;
  'aria-hidden'?: boolean | 'true' | 'false';
}> = ({ className, title = 'Stamping available', size = 22, 'aria-hidden': ariaHidden }) => {
  const decorative = ariaHidden === true || ariaHidden === 'true';
  return (
    <svg
      className={className}
      viewBox="0 0 64 72"
      width={size}
      height={Math.round(size * (72 / 64))}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
    >
      {!decorative && <title>{title}</title>}
      {/* Outer darker rim */}
      <path
        d="M32 2.5
           C36.5 6.2 44.5 8.2 52.5 9.2
           L54 9.5 L54 34.5
           C54 48.5 44.8 59.2 32 68.5
           C19.2 59.2 10 48.5 10 34.5
           L10 9.5 L11.5 9.2
           C19.5 8.2 27.5 6.2 32 2.5 Z"
        fill="#15803d"
      />
      {/* Inner face */}
      <path
        d="M32 6.2
           C35.8 9.4 42.8 11.1 49.8 12
           L51.2 12.2 L51.2 34.2
           C51.2 46.4 43.2 55.6 32 63.6
           C20.8 55.6 12.8 46.4 12.8 34.2
           L12.8 12.2 L14.2 12
           C21.2 11.1 28.2 9.4 32 6.2 Z"
        fill="#22c55e"
      />
      {/* White center disc */}
      <circle cx="32" cy="32" r="15.5" fill="#ffffff" />
      {/* Green check */}
      <path
        d="M23.2 32.4 L29.2 38.2 L41.4 25.2"
        fill="none"
        stroke="#22c55e"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
