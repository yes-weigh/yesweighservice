import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IndianRupee, Link2Off, Package, ShoppingCart } from 'lucide-react';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import type { CatalogProduct } from '../../types/catalog';
import type { CatalogNavState } from '../../lib/catalogNav';
import { QuantityStepper } from '../QuantityStepper';
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
  const { items, addItem, getQuantity, setQuantity } = useCart();
  const { flyToCart } = useCartFly();

  if (!enableCart) return null;

  const outOfStock = item.stockStatus === 'out_of_stock';
  const cartQty = getQuantity(item.id);
  // Prefer without-stamping line for qty stepper when multiple stamp variants exist.
  const primaryLine = items.find(line => line.productId === item.id && !line.gatcStampingPriceId)
    ?? items.find(line => line.productId === item.id);

  const handleAdd = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (outOfStock) return;
    // Stampable items add without stamping; dealer configures in cart.
    if (addItem(item, 1)) {
      flyToCart(event.currentTarget, { imageUrl: item.imageUrl });
    }
  };

  if (outOfStock) {
    return (
      <div className="related-catalog__cart related-catalog__cart--disabled" aria-label="Out of stock">
        <span className="related-catalog__cart-unavailable text-sm">Out of stock</span>
      </div>
    );
  }

  if (cartQty === 0 || !primaryLine) {
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
      <QuantityStepper
        value={primaryLine.quantity}
        onChange={next => {
          setQuantity(primaryLine.cartLineId, next);
        }}
        className="related-catalog__qty"
        buttonClassName="related-catalog__qty-btn"
        inputClassName="related-catalog__qty-input"
        stopPropagation
      />
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
  /** When set, show Unlink on each tile (staff mapping). */
  onUnlink?: (item: CatalogProduct) => void;
  unlinkingId?: string | null;
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
  onUnlink,
  unlinkingId = null,
}) => {
  const navigate = useNavigate();
  const [unlinkMode, setUnlinkMode] = useState(false);
  const canUnlink = Boolean(onUnlink);
  const showUnlinkButtons = canUnlink && unlinkMode;

  const toggleUnlinkMode = () => setUnlinkMode(prev => !prev);

  const unlinkModeSwitch = canUnlink ? (
    <div className="related-catalog__unlink-mode">
      <button
        type="button"
        className="related-catalog__unlink-mode-label"
        id="related-catalog-unlink-mode-label"
        onClick={toggleUnlinkMode}
      >
        Unlink mode
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={unlinkMode}
        aria-labelledby="related-catalog-unlink-mode-label"
        className={[
          'related-catalog__unlink-mode-switch',
          unlinkMode ? 'related-catalog__unlink-mode-switch--on' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={toggleUnlinkMode}
      >
        <span className="related-catalog__unlink-mode-knob" />
      </button>
    </div>
  ) : null;

  const headerControls =
    headerAction || unlinkModeSwitch ? (
      <div className="related-catalog__header-actions">
        {headerAction}
        {unlinkModeSwitch}
      </div>
    ) : null;

  if (loading) {
    return (
      <div className={`related-catalog ${embedded ? '' : 'product-detail-page__section'}`}>
        {!embedded && (
          <div className="related-catalog__header">
            <h2>{title}</h2>
            {headerControls}
          </div>
        )}
        {embedded && headerControls && (
          <div className="related-catalog__header related-catalog__header--embedded">
            {headerControls}
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
          {headerControls}
        </div>
      )}
      {embedded && headerControls && (
        <div className="related-catalog__header related-catalog__header--embedded">
          {headerControls}
        </div>
      )}
      {items.length === 0 ? (
        <p className="related-catalog__empty text-muted text-sm">{emptyMessage}</p>
      ) : (
        <ul className="related-catalog__list">
          {items.map(item => {
            const unlinking = unlinkingId === item.id;
            return (
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
                          <CategoryThumbnail src={item.imageUrl} knockout={false} />
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
                  {showUnlinkButtons && onUnlink && (
                    <button
                      type="button"
                      className="related-catalog__unlink"
                      disabled={unlinking || Boolean(unlinkingId)}
                      onClick={() => onUnlink(item)}
                      aria-label={`Unlink ${item.name}`}
                    >
                      <Link2Off size={13} aria-hidden />
                      {unlinking ? 'Unlinking…' : 'Unlink'}
                    </button>
                  )}
                  <RelatedCatalogCartControls item={item} enableCart={enableCart} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
