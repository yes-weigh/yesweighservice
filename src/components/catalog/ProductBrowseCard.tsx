import React from 'react';
import { IndianRupee, Package } from 'lucide-react';
import { getCategoryTheme } from '../../lib/category-display';
import type { CatalogProduct } from '../../types/catalog';
import { CategoryThumbnail } from './CategoryThumbnail';
import { StockBadge } from './StockBadge';

export interface ProductBrowseCardProps {
  product: CatalogProduct;
  index: number;
  onSelect: () => void;
}

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const ProductBrowseCard: React.FC<ProductBrowseCardProps> = ({
  product,
  index,
  onSelect,
}) => {
  const theme = getCategoryTheme(index);
  const outOfStock = product.stockStatus === 'out_of_stock';

  const cardStyle = {
    '--cat-bg': theme.bg,
    '--cat-accent': theme.accent,
    '--cat-badge': theme.badge,
  } as React.CSSProperties;

  return (
    <button
      type="button"
      style={cardStyle}
      className={`catalog-product-card ${outOfStock ? 'catalog-product-card--unavailable' : ''}`}
      onClick={onSelect}
    >
      <div className="catalog-product-card__media">
        <StockBadge status={product.stockStatus} overlay variant="tile" />
        {product.imageUrl ? (
          <div className="catalog-product-card__visual" aria-hidden>
            <CategoryThumbnail src={product.imageUrl} />
          </div>
        ) : (
          <Package size={36} className="catalog-product-card__fallback" aria-hidden />
        )}
      </div>

      <div className="catalog-product-card__body">
        {product.sku && (
          <span className="catalog-product-card__sku">{product.sku}</span>
        )}
        <h3 className="catalog-product-card__title">{formatProductTitle(product.name)}</h3>
        <div className="catalog-product-card__price">
          <IndianRupee size={13} strokeWidth={2.5} aria-hidden />
          <span>{product.rate.toLocaleString('en-IN')}</span>
        </div>
      </div>
    </button>
  );
};
