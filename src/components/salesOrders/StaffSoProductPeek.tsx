import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { IndianRupee, Loader2, Package, ShoppingCart, X } from 'lucide-react';
import { RelatedCatalogItems } from '../catalog/RelatedCatalogItems';
import { ProductImageFrame } from '../catalog/ProductImageFrame';
import { StockBadge, StockQuantity } from '../catalog/StockBadge';
import { QuantityStepper } from '../QuantityStepper';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import {
  fetchCatalogProductDetail,
  fetchCatalogSpareLinks,
  formatCurrency,
  hasCatalogCategory,
  isCatalogSparePartProduct,
} from '../../lib/catalog';
import { catalogGridStockQty } from '../../lib/catalogProductAudit/display';
import type { CatalogCategory, CatalogProduct, CatalogProductDetail } from '../../types/catalog';

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function PeekCartControls({
  product,
  canCart,
}: {
  product: CatalogProduct;
  canCart: boolean;
}) {
  const { items, addItem, getQuantity, setQuantity } = useCart();
  const { flyToCart } = useCartFly();

  if (!canCart) {
    return (
      <p className="text-muted text-sm staff-so-product-peek__cart-note">
        New order needed
      </p>
    );
  }

  const cartQty = getQuantity(product.id);
  const primaryLine = items.find(line => line.productId === product.id && !line.gatcStampingPriceId)
    ?? items.find(line => line.productId === product.id);

  const handleAdd = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (addItem(product, 1)) {
      flyToCart(event.currentTarget, { imageUrl: product.imageUrl });
    }
  };

  if (cartQty === 0 || !primaryLine) {
    return (
      <button
        type="button"
        className="btn btn-primary staff-so-product-peek__add-btn"
        onClick={handleAdd}
      >
        <ShoppingCart size={16} aria-hidden />
        Add to cart
      </button>
    );
  }

  return (
    <div className="staff-so-product-peek__qty" aria-label={`Quantity in cart: ${cartQty}`}>
      <QuantityStepper
        value={primaryLine.quantity}
        onChange={next => {
          setQuantity(primaryLine.cartLineId, next);
        }}
        stopPropagation
      />
    </div>
  );
}

export const StaffSoProductPeek: React.FC<{
  product: CatalogProduct | null;
  categories: CatalogCategory[];
  showStockQuantity?: boolean;
  isCartable?: (product: CatalogProduct) => boolean;
  onClose: () => void;
}> = ({
  product,
  categories,
  showStockQuantity = true,
  isCartable,
  onClose,
}) => {
  const [detail, setDetail] = useState<CatalogProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [relatedItems, setRelatedItems] = useState<CatalogProduct[]>([]);
  const [relatedKind, setRelatedKind] = useState<'spares' | 'products'>('spares');
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState('');

  const display = detail ?? product;

  const isSpareItem = useMemo(
    () => (product ? isCatalogSparePartProduct(product, categories) : false),
    [product, categories],
  );
  const isCategorizedProduct = useMemo(
    () => Boolean(product && hasCatalogCategory(product) && !isSpareItem),
    [product, isSpareItem],
  );

  useEffect(() => {
    if (!product) {
      setDetail(null);
      setRelatedItems([]);
      setRelatedError('');
      return;
    }

    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    void fetchCatalogProductDetail(product.id)
      .then(next => {
        if (!cancelled) setDetail(next);
      })
      .catch(() => {
        /* list product is enough for carting */
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    setRelatedLoading(true);
    setRelatedError('');
    setRelatedItems([]);
    void fetchCatalogSpareLinks(
      isCategorizedProduct ? { productId: product.id } : { spareId: product.id },
    )
      .then(response => {
        if (cancelled) return;
        setRelatedKind(response.kind);
        setRelatedItems(response.items);
      })
      .catch(err => {
        if (cancelled) return;
        setRelatedError(err instanceof Error ? err.message : 'Could not load linked items.');
        setRelatedItems([]);
      })
      .finally(() => {
        if (!cancelled) setRelatedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [product, isCategorizedProduct]);

  useEffect(() => {
    if (!product) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [product, onClose]);

  if (!product || !display) return null;

  const gridStockQty = showStockQuantity ? catalogGridStockQty(display) : 0;
  const gridStockStatus = gridStockQty <= 0
    ? 'out_of_stock' as const
    : display.stockStatus === 'low_stock'
      ? 'low_stock' as const
      : 'in_stock' as const;
  const warehouses = detail?.warehouses?.filter(w => w.warehouseName && w.stock > 0) ?? [];
  const canCartMain = !isCartable || isCartable(display);
  const relatedTitle = relatedKind === 'spares' ? 'Linked spare parts' : 'Linked products';
  const relatedEmpty = relatedKind === 'spares'
    ? 'No spare parts linked to this item.'
    : 'No products linked to this spare.';

  return createPortal(
    <div
      className="catalog-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="catalog-modal panel glass staff-so-product-peek"
        role="dialog"
        aria-modal="true"
        aria-label={formatProductTitle(display.name)}
        onClick={event => event.stopPropagation()}
      >
        <div className="staff-so-product-peek__scroll">
          <div className="catalog-modal__hero">
            {display.imageUrl ? (
              <ProductImageFrame src={display.imageUrl} alt="" variant="card" />
            ) : (
              <span className="catalog-modal__placeholder" aria-hidden>
                <Package size={40} />
              </span>
            )}
          </div>

          <div className="catalog-modal__body">
            <div className="catalog-modal__meta">
              {display.sku ? <span className="catalog-modal__sku">{display.sku}</span> : null}
              {display.categoryName ? (
                <span className="text-muted text-sm">{display.categoryName}</span>
              ) : null}
              <h2 className="staff-so-product-peek__title">
                {formatProductTitle(display.name)}
              </h2>
              <div className="staff-so-product-peek__badges">
                <StockBadge status={display.stockStatus} variant="tile" />
                {showStockQuantity ? (
                  <StockQuantity
                    stock={gridStockQty}
                    unit={display.unit}
                    status={gridStockStatus}
                    compact
                  />
                ) : null}
                {detailLoading ? (
                  <span className="text-muted text-sm staff-so-product-peek__loading">
                    <Loader2 size={14} className="spin-icon" aria-hidden />
                    Refreshing…
                  </span>
                ) : null}
              </div>
              <div className="catalog-modal__price">
                <span>Price</span>
                <strong>
                  <IndianRupee size={18} strokeWidth={2.5} aria-hidden />
                  {display.rate.toLocaleString('en-IN')}
                </strong>
              </div>
              {display.description ? (
                <p className="catalog-modal__description">{display.description}</p>
              ) : null}
              <div className="catalog-modal__tax">
                {display.hsn ? <span>HSN {display.hsn}</span> : null}
                {display.taxName ? (
                  <span>
                    {display.taxName}
                    {display.taxPercentage ? ` (${display.taxPercentage}%)` : ''}
                  </span>
                ) : null}
                <span>{formatCurrency(display.rate)}</span>
              </div>
            </div>

            {warehouses.length > 0 ? (
              <div className="catalog-modal__warehouses">
                <h3>Warehouse stock</h3>
                <ul>
                  {warehouses.map(w => (
                    <li key={w.warehouseId}>
                      <span>{w.warehouseName}</span>
                      <strong>
                        {w.stock.toLocaleString('en-IN')}
                        {display.unit ? ` ${display.unit}` : ''}
                      </strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <PeekCartControls product={display} canCart={canCartMain} />

            <div className="staff-so-product-peek__related">
              {relatedError ? (
                <p className="text-muted text-sm" role="alert">{relatedError}</p>
              ) : null}
              <RelatedCatalogItems
                items={relatedItems}
                title={relatedTitle}
                emptyMessage={relatedEmpty}
                loading={relatedLoading}
                showStockQuantity={showStockQuantity}
                enableCart
                isCartable={isCartable}
                embedded
                disableNavigation
              />
            </div>
          </div>
        </div>

        <div className="staff-so-product-peek__footer">
          <button
            type="button"
            className="btn btn-secondary staff-so-product-peek__close-btn"
            onClick={onClose}
          >
            <X size={20} aria-hidden />
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
