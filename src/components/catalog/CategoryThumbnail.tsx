interface CategoryThumbnailProps {
  src: string;
  className?: string;
  /**
   * `category` — tinted tile knock-out (blend + brighten) on catalogue category cards only.
   * `false` — plain image for products, spares, detail, orders, etc.
   */
  knockout?: 'category' | false;
}

/** Category tile vs product/spare image rendering. */
export const CategoryThumbnail: React.FC<CategoryThumbnailProps> = ({
  src,
  className = '',
  knockout = false,
}) => {
  const useKnockout = knockout === 'category';

  return (
    <img
      src={src}
      alt=""
      className={[
        'catalog-category-card__img',
        useKnockout ? 'catalog-category-card__img--blend' : '',
        className,
      ].filter(Boolean).join(' ')}
      loading="lazy"
      decoding="async"
    />
  );
};
