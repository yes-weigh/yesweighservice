import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  IndianRupee,
  Package,
  ShoppingCart,
  Tag,
} from 'lucide-react';
import { fetchCatalogProductDetail, formatCurrency } from '../../lib/catalog';
import { getCategoryTheme } from '../../lib/category-display';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import { CategoryThumbnail } from './CategoryThumbnail';
import { StockBadge } from './StockBadge';

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function themeIndexFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i) * (i + 1)) % 9973;
  }
  return hash;
}

export const ProductDetailView: React.FC<{
  productId: string;
  backPath: string;
  backLabel?: string;
  preview?: CatalogProduct | null;
  variant?: 'app' | 'public';
  showWarehouseStock?: boolean;
  showCartActions?: boolean;
  ordersPath?: string;
}> = ({
  productId,
  backPath,
  backLabel = 'Back to products',
  preview = null,
  variant = 'app',
  showWarehouseStock = false,
  showCartActions = false,
  ordersPath = '/dealer/orders',
}) => {
  const navigate = useNavigate();
  const { addItem, getQuantity } = useCart();
  const { flyToCart } = useCartFly();
  const [quantity, setQuantity] = useState(1);
  const [addedFlash, setAddedFlash] = useState(false);
  const [product, setProduct] = useState<CatalogProductDetail | CatalogProduct | null>(preview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const theme = useMemo(
    () => getCategoryTheme(themeIndexFromId(productId)),
    [productId],
  );

  const cardStyle = {
    '--cat-bg': theme.bg,
    '--cat-accent': theme.accent,
    '--cat-badge': theme.badge,
  } as React.CSSProperties;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void fetchCatalogProductDetail(productId)
      .then(detail => {
        if (!active) return;
        if (!detail.imageUrl && preview?.imageUrl) {
          detail.imageUrl = preview.imageUrl;
        }
        setProduct(detail);
      })
      .catch(err => {
        if (!active) return;
        if (preview) {
          setProduct(preview);
        } else {
          setError(err instanceof Error ? err.message : 'Could not load product.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [productId, preview]);

  const detail = product as CatalogProductDetail | null;
  const outOfStock = product?.stockStatus === 'out_of_stock';
  const cartQty = product ? getQuantity(product.id) : 0;

  const handleAddToCart = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!product || outOfStock) return;
    if (addItem(product, quantity)) {
      flyToCart(event.currentTarget, { imageUrl: product.imageUrl });
      setAddedFlash(true);
      window.setTimeout(() => setAddedFlash(false), 1500);
    }
  };

  if (error && !product) {
    return (
      <div className={`product-detail-page product-detail-page--${variant}`}>
        <button type="button" className="product-detail-page__back" onClick={() => navigate(backPath)}>
          <ArrowLeft size={18} />
          <span>{backLabel}</span>
        </button>
        <div className="product-detail-page__error panel glass">
          <Package size={40} />
          <h2>Product unavailable</h2>
          <p className="text-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className={`product-detail-page product-detail-page--${variant}`}>
        <div className="product-detail-page__loading">
          <div className="loader-ring" />
          <p className="text-muted">Loading product…</p>
        </div>
      </div>
    );
  }

  const specRows = [
    product.sku ? { label: 'SKU / Model', value: product.sku } : null,
    product.categoryName ? { label: 'Category', value: product.categoryName } : null,
    product.unit ? { label: 'Unit', value: product.unit } : null,
    detail?.hsn ? { label: 'HSN', value: detail.hsn } : null,
    detail?.taxName
      ? {
          label: 'Tax',
          value: `${detail.taxName}${detail.taxPercentage ? ` (${detail.taxPercentage}%)` : ''}`,
        }
      : null,
    detail?.preferredVendor ? { label: 'Vendor', value: detail.preferredVendor } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return (
    <div className={`product-detail-page product-detail-page--${variant}`} style={cardStyle}>
      <button
        type="button"
        className="product-detail-page__back"
        onClick={() => navigate(backPath)}
      >
        <ArrowLeft size={18} />
        <span>{backLabel}</span>
      </button>

      <div className="product-detail-page__layout">
        <section className="product-detail-page__gallery">
          <div className="product-detail-page__image-stage">
            <StockBadge status={product.stockStatus} overlay variant="tile" />
            {product.imageUrl ? (
              <CategoryThumbnail src={product.imageUrl} />
            ) : (
              <Package size={72} className="product-detail-page__placeholder" aria-hidden />
            )}
          </div>
        </section>

        <section className="product-detail-page__info">
          {product.categoryName && (
            <p className="product-detail-page__breadcrumb">
              <Tag size={13} aria-hidden />
              <span>{product.categoryName}</span>
              <ChevronRight size={14} aria-hidden />
              <span>Product</span>
            </p>
          )}

          <h1 className="product-detail-page__title">{formatProductTitle(product.name)}</h1>

          {product.sku && (
            <p className="product-detail-page__sku">Model: {product.sku}</p>
          )}

          <div className="product-detail-page__price-block">
            <div className="product-detail-page__price">
              <IndianRupee size={22} strokeWidth={2.5} aria-hidden />
              <span>{formatCurrency(product.rate).replace('₹', '').trim()}</span>
            </div>
            <p className="product-detail-page__price-note">Dealer price (excl. taxes where applicable)</p>
          </div>

          <div className="product-detail-page__availability">
            <StockBadge status={product.stockStatus} variant="tile" />
            {loading && (
              <span className="product-detail-page__loading-note">Updating stock…</span>
            )}
          </div>

          {showCartActions && (
            <div className="product-detail-page__cart">
              <div className="product-detail-page__qty" aria-label="Quantity">
                <button
                  type="button"
                  className="product-detail-page__qty-btn"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="product-detail-page__qty-value">{quantity}</span>
                <button
                  type="button"
                  className="product-detail-page__qty-btn"
                  onClick={() => setQuantity(q => q + 1)}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className={`btn btn-primary product-detail-page__add-cart ${addedFlash ? 'product-detail-page__add-cart--added' : ''}`}
                onClick={handleAddToCart}
                disabled={outOfStock}
              >
                <ShoppingCart size={18} />
                {addedFlash ? 'Added to cart' : outOfStock ? 'Out of stock' : 'Add to cart'}
              </button>
              {cartQty > 0 && (
                <button
                  type="button"
                  className="product-detail-page__view-cart"
                  onClick={() => navigate(ordersPath)}
                >
                  View cart ({cartQty})
                </button>
              )}
            </div>
          )}

          {detail?.description && (
            <div className="product-detail-page__section">
              <h2>About this product</h2>
              <p className="product-detail-page__description">{detail.description}</p>
            </div>
          )}

          {specRows.length > 0 && (
            <div className="product-detail-page__section">
              <h2>Product details</h2>
              <dl className="product-detail-page__specs">
                {specRows.map(row => (
                  <div key={row.label} className="product-detail-page__spec-row">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {showWarehouseStock && detail?.warehouses && detail.warehouses.length > 0 && (
            <div className="product-detail-page__section">
              <h2>Availability by warehouse</h2>
              <ul className="product-detail-page__warehouses">
                {detail.warehouses.map(w => (
                  <li key={w.warehouseId}>
                    <span>{w.warehouseName}</span>
                    <strong>
                      {w.stock} {product.unit}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
