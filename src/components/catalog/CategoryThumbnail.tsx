interface CategoryThumbnailProps {
  src: string;
  className?: string;
}

/** Category image with CSS blend (no canvas — avoids Storage CORS console noise). */
export const CategoryThumbnail: React.FC<CategoryThumbnailProps> = ({
  src,
  className = '',
}) => (
  <img
    src={src}
    alt=""
    className={`catalog-category-card__img catalog-category-card__img--blend ${className}`.trim()}
    loading="lazy"
    decoding="async"
  />
);
