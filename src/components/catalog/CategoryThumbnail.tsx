interface CategoryThumbnailProps {
  src: string;
  className?: string;
  /** JPG knock-out blend — off for product grid cards. */
  blend?: boolean;
}

function isPngImageSrc(src: string): boolean {
  const path = src.split(/[?#]/)[0] ?? src;
  return /\.png$/i.test(path);
}

/** Catalog image — optional JPG knock-out via CSS blend; PNGs never blend. */
export const CategoryThumbnail: React.FC<CategoryThumbnailProps> = ({
  src,
  className = '',
  blend = true,
}) => {
  const useBlend = blend && !isPngImageSrc(src);

  return (
    <img
      src={src}
      alt=""
      className={[
        'catalog-category-card__img',
        useBlend ? 'catalog-category-card__img--blend' : '',
        className,
      ].filter(Boolean).join(' ')}
      loading="lazy"
      decoding="async"
    />
  );
};
