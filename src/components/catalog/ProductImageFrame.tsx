import { Package } from 'lucide-react';

type ProductImageFrameProps = {
  src: string | null | undefined;
  alt: string;
  variant?: 'card' | 'row' | 'modal';
};

export function ProductImageFrame({
  src,
  alt,
  variant = 'card',
}: ProductImageFrameProps) {
  const iconSize = variant === 'row' ? 22 : variant === 'modal' ? 56 : 40;

  return (
    <div className={`catalog-product-image catalog-product-image--${variant}`}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" />
      ) : (
        <Package size={iconSize} className="catalog-product-image__placeholder" aria-hidden />
      )}
    </div>
  );
}
