import React from 'react';
import { useNavigate } from 'react-router-dom';
import { IndianRupee, Minus, Package, Plus, ShoppingCart } from 'lucide-react';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import type { CatalogProduct } from '../../types/catalog';
import type { CatalogNavState } from '../../lib/catalogNav';
import { CategoryThumbnail } from './CategoryThumbnail';
import { StockQuantity } from './StockBadge';

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function RelatedCatalogCartControls({
  item,
  enableCart,
}: {
  item: CatalogProduct;
  enableCart: boolean;
}) {
  const { addItem, getQuantity, setQuantity } = useCart();
  const { flyToCart } = useCartFly();

  if (!enableCart) return null;

  const outOfStock = item.stockStatus === 'out_of_stock';
  const cartQty = getQuantity(item.id);

  const handleAdd = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (outOfStock) return;
    if (addItem(item, 1)) {
      flyToCart(event.currentTarget, { imageUrl: item.imageUrl });
    }
  };

  const handleDecrease = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setQuantity(item.id, cartQty - 1);
  };

  const handleIncrease = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (outOfStock) return;
    if (cartQty === 0) {
      if (addItem(item, 1)) {
        flyToCart(event.currentTarget, { imageUrl: item.imageUrl });
      }
      return;
    }
    setQuantity(item.id, cartQty + 1);
  };

  if (outOfStock) {
    return (
      <div className="related-catalog__cart related-catalog__cart--disabled" aria-label="Out of stock">
        <span className="related-catalog__cart-unavailable text-sm">Out of stock</span>
      </div>
    );
  }

  if (cartQty === 0) {
    return (
      <div className="related-catalog__cart">
        <button
          type="button"
          className="related-catalog__add-cart"
          onClick={handleAdd}
          aria-label={`Add ${item.name} to cart`}
        >
          <ShoppingCart size={16} aria-hidden />
          <span>Add</span>
        </button>
      </div>
    );
  }

  return (
    <div className="related-catalog__cart" aria-label={`Quantity in cart: ${cartQty}`}>
      <div className="related-catalog__qty">
        <button
          type="button"
          className="related-catalog__qty-btn"
          onClick={handleDecrease}
          aria-label="Decrease quantity"
        >
          <Minus size={14} aria-hidden />
        </button>
        <span className="related-catalog__qty-value">{cartQty}</span>
        <button
          type="button"
          className="related-catalog__qty-btn"
          onClick={handleIncrease}
          aria-label="Increase quantity"
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export const RelatedCatalogItems: React.FC<{
  items: CatalogProduct[];
  title: string;
  emptyMessage: string;
  detailBasePath: string;
  loading?: boolean;
  headerAction?: React.ReactNode;
  showStockQuantity?: boolean;
  enableCart?: boolean;
  getLinkState?: (item: CatalogProduct) => CatalogNavState;
  /** Hide section heading when rendered inside product detail tabs. */
  embedded?: boolean;
}> = ({
  items,
  title,
  emptyMessage,
  detailBasePath,
  loading = false,
  headerAction,
  showStockQuantity = false,
  enableCart = false,
  getLinkState,
  embedded = false,
}) => {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className={`related-catalog ${embedded ? '' : 'product-detail-page__section'}`}>
        {!embedded && (
          <div className="related-catalog__header">
            <h2>{title}</h2>
            {headerAction}
          </div>
        )}
        <p className="text-muted text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className={`related-catalog ${embedded ? '' : 'product-detail-page__section'}`}>
      {!embedded && (
        <div className="related-catalog__header">
          <h2>{title}</h2>
          {headerAction}
        </div>
      )}
      {embedded && headerAction && (
        <div className="related-catalog__header related-catalog__header--embedded">
          {headerAction}
        </div>
      )}
      {items.length === 0 ? (
        <p className="related-catalog__empty text-muted text-sm">{emptyMessage}</p>
      ) : (
        <ul className="related-catalog__list">
          {items.map(item => (
            <li key={item.id}>
              <div className={`related-catalog__item ${enableCart ? 'related-catalog__item--cart' : ''}`}>
                <button
                  type="button"
                  className="related-catalog__main"
                  onClick={() =>
                    navigate(`${detailBasePath}/${item.id}`, {
                      state: getLinkState?.(item) ?? { preview: item },
                    })
                  }
                >
                  <div className="related-catalog__media">
                    {item.imageUrl ? (
                      <div className="related-catalog__visual" aria-hidden>
                        <CategoryThumbnail src={item.imageUrl} />
                      </div>
                    ) : (
                      <Package size={24} aria-hidden />
                    )}
                  </div>
                  <div className="related-catalog__info">
                    {item.sku && <span className="related-catalog__sku">{item.sku}</span>}
                    <span className="related-catalog__name">{formatProductTitle(item.name)}</span>
                    {item.categoryName && (
                      <span className="related-catalog__category text-muted text-sm">
                        {item.categoryName}
                      </span>
                    )}
                    {showStockQuantity && (
                      <StockQuantity
                        stock={item.stock}
                        unit={item.unit}
                        status={item.stockStatus}
                        compact
                      />
                    )}
                  </div>
                  <div className="related-catalog__price">
                    <IndianRupee size={13} strokeWidth={2.5} aria-hidden />
                    <span>{item.rate.toLocaleString('en-IN')}</span>
                  </div>
                </button>
                <RelatedCatalogCartControls item={item} enableCart={enableCart} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
