import React, { useState } from 'react';
import { IndianRupee, Package, ShoppingCart } from 'lucide-react';
import { getCategoryTheme } from '../../lib/category-display';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import type { CatalogProduct } from '../../types/catalog';
import { CategoryThumbnail } from './CategoryThumbnail';
import { StockBadge } from './StockBadge';

export interface ProductBrowseCardProps {
  product: CatalogProduct;
  index: number;
  onSelect: () => void;
  enableCart?: boolean;
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
  enableCart = false,
}) => {
  const { addItem, isInCart } = useCart();
  const { flyToCart } = useCartFly();
  const [addedFlash, setAddedFlash] = useState(false);
  const theme = getCategoryTheme(index);
  const outOfStock = product.stockStatus === 'out_of_stock';
  const inCart = isInCart(product.id);

  const cardStyle = {
    '--cat-bg': theme.bg,
    '--cat-accent': theme.accent,
    '--cat-badge': theme.badge,
  } as React.CSSProperties;

  const handleAddToCart = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (outOfStock) return;
    if (addItem(product)) {
      flyToCart(event.currentTarget, { imageUrl: product.imageUrl });
      setAddedFlash(true);
      window.setTimeout(() => setAddedFlash(false), 1200);
    }
  };

  return (
    <article
      style={cardStyle}
      className={`catalog-product-card ${outOfStock ? 'catalog-product-card--unavailable' : ''} ${inCart ? 'catalog-product-card--in-cart' : ''}`}
    >
      <button type="button" className="catalog-product-card__main" onClick={onSelect}>
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
            <IndianRupee size={14} strokeWidth={2.5} aria-hidden />
            <span>{product.rate.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </button>

      {enableCart && (
        <button
          type="button"
          className={`catalog-product-card__cart-btn ${addedFlash ? 'catalog-product-card__cart-btn--added' : ''}`}
          onClick={handleAddToCart}
          disabled={outOfStock}
          aria-label={outOfStock ? 'Out of stock' : inCart ? 'Add another to cart' : 'Add to cart'}
          title={outOfStock ? 'Out of stock' : 'Add to cart'}
        >
          <ShoppingCart size={16} />
        </button>
      )}
    </article>
  );
};
