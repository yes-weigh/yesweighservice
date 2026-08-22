import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCanViewShipmentTracking } from '../../hooks/useCanViewShipmentTracking';
import { useDealerListedCatalogProducts } from '../../hooks/useDealerOrderStockGate';
import { useRaisedPoQtyByProductId } from '../../hooks/useRaisedPoQtyByProductId';
import { isDealerPortalUser } from '../../lib/dealerAccess';
import type { CatalogNavState } from '../../lib/catalogNav';
import type { CatalogProduct } from '../../types/catalog';
import { ProductBrowseCard } from './ProductBrowseCard';

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
  const { user } = useAuth();
  const [unlinkMode, setUnlinkMode] = useState(false);
  const listedItems = useDealerListedCatalogProducts(items);
  const dealerView = isDealerPortalUser(user);
  const raisedPoQtyByProductId = useRaisedPoQtyByProductId(useCanViewShipmentTracking());
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

  const openItem = (item: CatalogProduct) => {
    if (!canNavigate) return;
    navigate(`${detailBasePath}/${item.id}`, {
      state: getLinkState?.(item) ?? { preview: item },
    });
  };

  const body = loading ? (
    <p className="text-muted text-sm">Loading…</p>
  ) : listedItems.length === 0 ? (
    <p className="related-catalog__empty text-muted text-sm">{emptyMessage}</p>
  ) : (
    <div className="catalog-grid catalog-grid--tiles related-catalog__grid">
      {listedItems.map((item, idx) => (
        <ProductBrowseCard
          key={item.id}
          product={item}
          index={idx}
          onSelect={() => openItem(item)}
          enableCart={enableCart}
          isCartable={isCartable}
          showStockQuantity={showStockQuantity}
          dealerView={dealerView}
          raisedPoQty={raisedPoQtyByProductId.get(item.id)}
          manageLabel={showUnlinkButtons ? (unlinkingId === item.id ? 'Unlinking…' : 'Unlink') : undefined}
          onManage={
            showUnlinkButtons && onUnlink
              ? event => {
                  event.stopPropagation();
                  if (unlinkingId) return;
                  onUnlink(item);
                }
              : undefined
          }
        />
      ))}
    </div>
  );

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
      {body}
    </div>
  );
};
