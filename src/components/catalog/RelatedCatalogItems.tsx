import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IndianRupee, Link2Off, Package, ShoppingCart } from 'lucide-react';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import type { CatalogNavState } from '../../lib/catalogNav';
import type { CatalogProduct } from '../../types/catalog';
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

  if (!enableCart) {
    return (
      <div className="related-catalog__actions related-catalog__actions--muted">
        <span className="related-catalog__cart-unavailable">New order needed</span>
      </div>
    );
  }

  const cartQty = getQuantity(item.id);
  const primaryLine = items.find(line => line.productId === item.id && !line.gatcStampingPriceId)
    ?? items.find(line => line.productId === item.id);

  const handleAdd = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (addItem(item, 1)) {
      flyToCart(event.currentTarget, { imageUrl: item.imageUrl });
    }
  };

  if (cartQty === 0 || !primaryLine) {
    return (
      <div className="related-catalog__actions">
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
    <div className="related-catalog__actions" aria-label={`Quantity in cart: ${cartQty}`}>
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
  detailBasePath?: string;
  loading?: boolean;
  headerAction?: React.ReactNode;
  showStockQuantity?: boolean;
  enableCart?: boolean;
  isCartable?: (product: CatalogProduct) => boolean;
  getLinkState?: (item: CatalogProduct) => CatalogNavState;
  /** Hide section heading when rendered inside product detail tabs. */
  embedded?: boolean;
  /** When set, show Unlink on each tile (staff mapping). */
  onUnlink?: (item: CatalogProduct) => void;
  unlinkingId?: string | null;
  /** Keep tiles in-place (e.g. sales-order wizard) instead of navigating to detail. */
  disableNavigation?: boolean;
}> = ({
  items,
  title,
  emptyMessage,
  detailBasePath = '',
  loading = false,
  headerAction,
  showStockQuantity = false,
  enableCart = false,
  isCartable,
  getLinkState,
  embedded = false,
  onUnlink,
  unlinkingId = null,
  disableNavigation = false,
}) => {
  const navigate = useNavigate();
  const [unlinkMode, setUnlinkMode] = useState(false);
  const canNavigate = Boolean(detailBasePath) && !disableNavigation;
  const showUnlinkButtons = Boolean(onUnlink) && unlinkMode;

  const headerControls = (headerAction || onUnlink) ? (
    <div className="related-catalog__header-actions">
      {headerAction}
      {onUnlink ? (
        <label className="related-catalog__unlink-mode">
          <span className="related-catalog__unlink-mode-label">Unlink</span>
          <button
            type="button"
            role="switch"
            aria-checked={unlinkMode}
            className={`related-catalog__unlink-mode-switch${unlinkMode ? ' related-catalog__unlink-mode-switch--on' : ''}`}
            onClick={() => setUnlinkMode(prev => !prev)}
          >
            <span className="related-catalog__unlink-mode-knob" />
          </button>
        </label>
      ) : null}
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
            const itemCartable = !isCartable || isCartable(item);
            const mainBody = (
              <>
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
                  <div className="related-catalog__price">
                    <IndianRupee size={13} strokeWidth={2.5} aria-hidden />
                    <span>{item.rate.toLocaleString('en-IN')}</span>
                  </div>
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
              </>
            );
            return (
              <li key={item.id}>
                <div className={`related-catalog__item${enableCart ? ' related-catalog__item--cart' : ''}`}>
                  {canNavigate ? (
                    <button
                      type="button"
                      className="related-catalog__main"
                      onClick={() =>
                        navigate(`${detailBasePath}/${item.id}`, {
                          state: getLinkState?.(item) ?? { preview: item },
                        })
                      }
                    >
                      {mainBody}
                    </button>
                  ) : (
                    <div className="related-catalog__main related-catalog__main--static">
                      {mainBody}
                    </div>
                  )}
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
                  {enableCart ? (
                    <RelatedCatalogCartControls
                      item={item}
                      enableCart={itemCartable}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
