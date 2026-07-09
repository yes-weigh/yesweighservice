import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, IndianRupee, Link2, Minus, Package, ShoppingCart } from 'lucide-react';
import { getCategoryTheme } from '../../lib/category-display';
import { resolveAdjustedAuditDisplay } from '../../lib/catalogProductAudit/display';
import { formatAuditDate } from '../../lib/yesStore/format';
import { formatQtyDifference } from '../../lib/yesStore/inventoryAudit';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import type { CatalogProduct } from '../../types/catalog';
import { CategoryThumbnail } from './CategoryThumbnail';
import { StockBadge, StockQuantity } from './StockBadge';

export interface ProductBrowseCardProps {
  product: CatalogProduct;
  index: number;
  onSelect: () => void;
  enableCart?: boolean;
  showStockQuantity?: boolean;
  manageLabel?: string;
  onManage?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  linkedSpareCount?: number;
  warehouseLinked?: boolean;
  /** Open Non-Conformance count — staff/super_admin only. */
  openNcCount?: number;
  editable?: boolean;
  dragProps?: {
    draggable: boolean;
    onDragStart: React.DragEventHandler;
    onDragOver: React.DragEventHandler;
    onDragLeave: React.DragEventHandler;
    onDrop: React.DragEventHandler;
    onDragEnd: React.DragEventHandler;
  };
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
  showStockQuantity = false,
  manageLabel,
  onManage,
  linkedSpareCount,
  warehouseLinked = false,
  openNcCount,
  editable = false,
  dragProps,
}) => {
  const { addItem, isInCart } = useCart();
  const { flyToCart } = useCartFly();
  const [addedFlash, setAddedFlash] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const theme = getCategoryTheme(index);
  const outOfStock = product.stockStatus === 'out_of_stock';
  const inCart = isInCart(product.id);

  const auditDisplay = useMemo(() => {
    if (!showStockQuantity || !product.auditSnapshot) return null;
    return resolveAdjustedAuditDisplay({
      currentZohoQty: product.stock,
      snapshot: product.auditSnapshot,
      livePhysicalQty: null,
    });
  }, [showStockQuantity, product.auditSnapshot, product.stock]);

  const auditDiff = auditDisplay?.displayDifference ?? null;
  const auditDiffState =
    auditDiff == null ? null
      : auditDiff > 0 ? 'over'
        : auditDiff < 0 ? 'under'
          : 'match';
  const showAuditInfo = auditDisplay?.hasAuditSnapshot === true && auditDiff != null;

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
      {...(editable ? dragProps : {})}
      style={cardStyle}
      className={[
        'catalog-product-card',
        outOfStock ? 'catalog-product-card--unavailable' : '',
        inCart ? 'catalog-product-card--in-cart' : '',
        editable ? 'catalog-product-card--editable' : '',
        dragOver ? 'catalog-product-card--drag-over' : '',
      ].filter(Boolean).join(' ')}
      onDragOver={editable ? e => {
        e.preventDefault();
        setDragOver(true);
        dragProps?.onDragOver(e);
      } : undefined}
      onDragLeave={editable ? e => {
        setDragOver(false);
        dragProps?.onDragLeave(e);
      } : undefined}
      onDrop={editable ? e => {
        setDragOver(false);
        dragProps?.onDrop(e);
      } : undefined}
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
          <div className="catalog-product-card__price-row">
            <div className="catalog-product-card__price">
              <IndianRupee size={14} strokeWidth={2.5} aria-hidden />
              <span>{product.rate.toLocaleString('en-IN')}</span>
            </div>
            {showStockQuantity && (
              <StockQuantity
                stock={product.stock}
                unit={product.unit}
                status={product.stockStatus}
                compact
              />
            )}
          </div>

          {openNcCount != null && openNcCount > 0 && (
            <span className="catalog-product-card__nc-badge">
              NC {openNcCount}
            </span>
          )}

          {showAuditInfo && (
            <div className="catalog-product-card__audit">
              <p className="catalog-product-card__audit-heading">
                Stock difference (after last audit)
              </p>
              <div className="catalog-product-card__audit-row">
                <div
                  className={[
                    'catalog-product-card__audit-diff',
                    auditDiffState ? `catalog-product-card__audit-diff--${auditDiffState}` : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="catalog-product-card__audit-diff-icon" aria-hidden>
                    {auditDiffState === 'under'
                      ? <ArrowDown size={12} strokeWidth={2.75} />
                      : auditDiffState === 'over'
                        ? <ArrowUp size={12} strokeWidth={2.75} />
                        : <Minus size={12} strokeWidth={2.75} />}
                  </span>
                  <div className="catalog-product-card__audit-diff-copy">
                    <span className="catalog-product-card__audit-diff-value">
                      {`${formatQtyDifference(auditDiff!)} ${product.unit}`.trim()}
                    </span>
                    {auditDiffState === 'over' && (
                      <span className="catalog-product-card__audit-diff-note">(Found more)</span>
                    )}
                    {auditDiffState === 'under' && (
                      <span className="catalog-product-card__audit-diff-note">(Found less)</span>
                    )}
                  </div>
                </div>
                <div className="catalog-product-card__audit-date">
                  <span className="catalog-product-card__audit-date-label">Last audit</span>
                  <span className="catalog-product-card__audit-date-value">
                    {formatAuditDate(auditDisplay?.lastAuditedAt)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {linkedSpareCount !== undefined && (
            <span
              className={`catalog-product-card__spare-count ${linkedSpareCount === 0 ? 'catalog-product-card__spare-count--none' : ''}`}
            >
              <Link2 size={12} aria-hidden />
              {linkedSpareCount === 0
                ? 'No spares linked'
                : `${linkedSpareCount} spare${linkedSpareCount === 1 ? '' : 's'} linked`}
            </span>
          )}
          {warehouseLinked && (
            <span className="catalog-product-card__warehouse-link">
              <Link2 size={12} aria-hidden />
              Warehouse linked
            </span>
          )}
        </div>
      </button>

      {onManage && manageLabel && (
        <button
          type="button"
          className="catalog-product-card__manage-btn"
          onClick={onManage}
          aria-label={manageLabel}
          title={manageLabel}
        >
          <Link2 size={14} />
        </button>
      )}

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
