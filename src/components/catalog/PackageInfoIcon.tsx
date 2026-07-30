import React from 'react';

/** Cardboard box + blue shield check — marks package info stored for the product. */
export const PackageInfoIcon: React.FC<{
  className?: string;
  title?: string;
  size?: number;
  'aria-hidden'?: boolean | 'true' | 'false';
}> = ({ className, title = 'Package info available', size = 28, 'aria-hidden': ariaHidden }) => {
  const decorative = ariaHidden === true || ariaHidden === 'true';
  return (
    <picture>
      <source srcSet="/icons/package-info.webp" type="image/webp" />
      <img
        className={className}
        src="/icons/package-info.png"
        alt={decorative ? '' : title}
        width={size}
        height={Math.round(size * (89 / 112))}
        draggable={false}
        decoding="async"
        aria-hidden={decorative || undefined}
      />
    </picture>
  );
};
