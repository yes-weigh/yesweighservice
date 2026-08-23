import { Package } from 'lucide-react';
import { FastRemoteImage } from '../media/FastRemoteImage';

type ProductImageFrameProps = {
  src: string | null | undefined;
  alt: string;
  variant?: 'card' | 'row' | 'modal';
  priority?: boolean;
};

export function ProductImageFrame({
  src,
  alt,
  variant = 'card',
  priority = false,
}: ProductImageFrameProps) {
  const iconSize = variant === 'row' ? 22 : variant === 'modal' ? 56 : 40;

  return (
    <div className={`catalog-product-image catalog-product-image--${variant}`}>
      {src ? (
        <FastRemoteImage
          src={src}
          alt={alt}
          priority={priority}
          size={variant === 'modal' ? 'detail' : 'thumb'}
        />
      ) : (
        <Package size={iconSize} className="catalog-product-image__placeholder" aria-hidden />
      )}
    </div>
  );
};
