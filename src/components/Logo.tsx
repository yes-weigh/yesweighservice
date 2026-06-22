import React from 'react';
import { BRAND_NAME } from '../constants/brand';

type LogoProps = {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
};

const heights = { sm: 36, md: 44, lg: 88 } as const;

export const Logo: React.FC<LogoProps> = ({ size = 'md', showText = false, className = '' }) => {
  const height = heights[size];

  return (
    <div className={`brand-logo-wrap ${className}`.trim()}>
      <img
        src="/logo.png"
        alt={BRAND_NAME}
        className="brand-logo"
        style={{ height }}
      />
      {showText && <span className="logo-text">{BRAND_NAME}</span>}
    </div>
  );
};
