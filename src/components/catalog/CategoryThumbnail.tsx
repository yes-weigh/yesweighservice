import React from 'react';
import { FastRemoteImage } from '../media/FastRemoteImage';
import type { FastImageSize } from '../../lib/fastImageCache';

interface CategoryThumbnailProps {
  src: string;
  className?: string;
  /**
   * `category` — tinted tile knock-out (blend + brighten) on catalogue category cards only.
   * `false` — plain image for products, spares, detail, orders, etc.
   */
  knockout?: 'category' | false;
  /** First-screen tiles — skip viewport delay. */
  priority?: boolean;
  size?: FastImageSize;
}

/** Category tile vs product/spare image rendering. */
export const CategoryThumbnail: React.FC<CategoryThumbnailProps> = ({
  src,
  className = '',
  knockout = false,
  priority = false,
  size = 'thumb',
}) => {
  const useKnockout = knockout === 'category';

  return (
    <FastRemoteImage
      src={src}
      alt=""
      className={[
        'catalog-category-card__img',
        useKnockout ? 'catalog-category-card__img--blend' : '',
        className,
      ].filter(Boolean).join(' ')}
      priority={priority}
      size={size}
    />
  );
};
