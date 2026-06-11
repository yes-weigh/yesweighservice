import React from 'react';

type LogoProps = {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
};

const heights = { sm: 32, md: 40, lg: 64 } as const;

export const Logo: React.FC<LogoProps> = ({ size = 'md', showText = false, className = '' }) => {
  const height = heights[size];

  return (
    <div className={`brand-logo-wrap ${className}`.trim()}>
      <img
        src="/logo.png"
        alt="YesWeigh"
        className="brand-logo"
        style={{ height }}
        width={height * 2.4}
      />
      {showText && <span className="logo-text">YESWEIGH</span>}
    </div>
  );
};
