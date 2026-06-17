import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  IndianRupee,
  Link2,
  Package,
  RefreshCw,
  ShoppingCart,
  Tag,
} from 'lucide-react';
import {
  fetchCatalog,
  fetchCatalogProductDetail,
  fetchCatalogSpareLinks,
  formatCurrency,
  getCategorizedProducts,
  getUncategorizedProducts,
  hasCatalogCategory,
  saveCatalogProductSpareLinks,
  saveCatalogSpareProductLinks,
  uploadCatalogProductImage,
} from '../../lib/catalog';
import { getCategoryTheme } from '../../lib/category-display';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import { CategoryThumbnail } from './CategoryThumbnail';
import { RelatedCatalogItems } from './RelatedCatalogItems';
import { SpareLinkEditor } from './SpareLinkEditor';
import { StockBadge, StockQuantity } from './StockBadge';

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
  showStockQuantity?: boolean;
  showCartActions?: boolean;
  ordersPath?: string;
  showRelatedLinks?: boolean;
  manageSpareLinks?: boolean;
  canUploadImage?: boolean;
  productsBasePath?: string;
  sparesBasePath?: string;
}> = ({
  productId,
  backPath,
  backLabel = 'Back to products',
  preview = null,
  variant = 'app',
  showWarehouseStock = false,
  showStockQuantity = false,
  showCartActions = false,
  ordersPath = '/dealer/orders',
  showRelatedLinks = false,
  manageSpareLinks = false,
  canUploadImage = false,
  productsBasePath = '/dealer/products',
  sparesBasePath = '/dealer/spares',
}) => {
  const navigate = useNavigate();
  const { addItem, getQuantity } = useCart();
  const { flyToCart } = useCartFly();
  const [quantity, setQuantity] = useState(1);
  const [addedFlash, setAddedFlash] = useState(false);
  const [product, setProduct] = useState<CatalogProductDetail | CatalogProduct | null>(preview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relatedItems, setRelatedItems] = useState<CatalogProduct[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedKind, setRelatedKind] = useState<'spares' | 'products'>('spares');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPool, setEditorPool] = useState<CatalogProduct[]>([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

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

  const isGroupedProduct = product ? hasCatalogCategory(product) : false;
  const isSpareItem = product ? !hasCatalogCategory(product) : false;
  const showLinksSection = showRelatedLinks || manageSpareLinks;

  const loadRelatedLinks = useCallback(async () => {
    if (!product || !showLinksSection) return;
    setRelatedLoading(true);
    setLinkError(null);
    try {
      const response = isGroupedProduct
        ? await fetchCatalogSpareLinks({ productId: product.id })
        : await fetchCatalogSpareLinks({ spareId: product.id });
      setRelatedKind(response.kind);
      setRelatedItems(response.items);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not load related items.');
      setRelatedItems([]);
    } finally {
      setRelatedLoading(false);
    }
  }, [product, showLinksSection, isGroupedProduct]);

  useEffect(() => {
    void loadRelatedLinks();
  }, [loadRelatedLinks]);

  const openLinkEditor = async () => {
    if (!product) return;
    setLinkError(null);
    try {
      const catalog = await fetchCatalog();
      const pool = isGroupedProduct
        ? getUncategorizedProducts(catalog.items)
        : getCategorizedProducts(catalog.items);
      setEditorPool(pool);
      setEditorOpen(true);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not load catalog for mapping.');
    }
  };

  const handleSaveLinks = async (ids: string[]) => {
    if (!product) return;
    setEditorSaving(true);
    setLinkError(null);
    try {
      if (isGroupedProduct) {
        await saveCatalogProductSpareLinks(product.id, ids);
      } else {
        await saveCatalogSpareProductLinks(product.id, ids);
      }
      setEditorOpen(false);
      await loadRelatedLinks();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not save mapping.');
    } finally {
      setEditorSaving(false);
    }
  };

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

  const handleImagePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !product || !canUploadImage) return;

    setImageUploading(true);
    setImageError(null);
    try {
      const imageUrl = await uploadCatalogProductImage(product.id, file);
      const syncedAt = new Date().toISOString();
      setProduct(prev => (prev ? { ...prev, imageUrl, syncedAt } : prev));
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Could not upload image.');
    } finally {
      setImageUploading(false);
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
    showStockQuantity
      ? { label: 'Stock on hand', value: `${product.stock.toLocaleString('en-IN')} ${product.unit}` }
      : null,
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
            {canUploadImage && (
              <>
                <button
                  type="button"
                  className="product-detail-page__image-upload"
                  title="Capture or upload product photo"
                  aria-label="Capture or upload product photo"
                  disabled={imageUploading}
                  onClick={() => imageInputRef.current?.click()}
                >
                  {imageUploading
                    ? <RefreshCw size={18} className="spin-icon" aria-hidden />
                    : <Camera size={18} aria-hidden />}
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="product-detail-page__image-input"
                  aria-label="Product photo"
                  onChange={e => void handleImagePick(e)}
                />
              </>
            )}
          </div>
          {imageError && (
            <p className="product-detail-page__image-error text-sm">{imageError}</p>
          )}
        </section>

        <section className="product-detail-page__info">
          {product.categoryName && (
            <p className="product-detail-page__breadcrumb">
              <Tag size={13} aria-hidden />
              <span>{product.categoryName}</span>
              <ChevronRight size={14} aria-hidden />
              <span>{isSpareItem ? 'Spare' : 'Product'}</span>
            </p>
          )}

          {!product.categoryName && isSpareItem && (
            <p className="product-detail-page__breadcrumb">
              <Tag size={13} aria-hidden />
              <span>Spare part</span>
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
            {showStockQuantity && (
              <StockQuantity
                stock={product.stock}
                unit={product.unit}
                status={product.stockStatus}
              />
            )}
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

          {showLinksSection && (isGroupedProduct || isSpareItem) && (
            <>
              <RelatedCatalogItems
                items={relatedItems}
                title={relatedKind === 'spares' ? 'Compatible spares' : 'Compatible products'}
                emptyMessage={
                  relatedKind === 'spares'
                    ? 'No spares mapped yet for this product.'
                    : 'No products mapped yet for this spare.'
                }
                detailBasePath={relatedKind === 'spares' ? sparesBasePath : productsBasePath}
                loading={relatedLoading}
                showStockQuantity={showStockQuantity}
                headerAction={
                  manageSpareLinks ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void openLinkEditor()}
                    >
                      <Link2 size={15} />
                      {relatedKind === 'spares' ? 'Map spares' : 'Map products'}
                    </button>
                  ) : undefined
                }
              />
              {linkError && (
                <p className="related-catalog-section__error text-sm">{linkError}</p>
              )}
            </>
          )}
        </section>
      </div>

      {editorOpen && product && (
        <SpareLinkEditor
          mode={isGroupedProduct ? 'product' : 'spare'}
          itemName={product.name}
          pool={editorPool}
          selectedIds={relatedItems.map(item => item.id)}
          saving={editorSaving}
          onClose={() => setEditorOpen(false)}
          onSave={handleSaveLinks}
        />
      )}
    </div>
  );
};
